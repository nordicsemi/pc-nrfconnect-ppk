/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { logger } from '@nordicsemiconductor/pc-nrfconnect-shared';
import { type Server } from 'http';

import { type RemoteControlConfig } from '../../utils/persistentStore';
import {
    closeHttpServer,
    createRequestHandler,
    MCP_PATH,
    REST_PREFIX,
    type ServedParts,
    startHttpServer,
} from './httpServer';
import { formatHostPort, type ListenAddress, parseListen } from './listen';
import { type Operation, type ServerContext } from './operation';

export type PartStatus =
    | { state: 'stopped' }
    | { state: 'running'; url: string }
    | { state: 'error'; message: string };

export interface RemoteControlStatus {
    mcp: PartStatus;
    rest: PartStatus;
}

type Part = keyof ServedParts;
const PARTS: readonly Part[] = ['mcp', 'rest'];
const PATHS: Record<Part, string> = { mcp: MCP_PATH, rest: REST_PREFIX };

// One listen address, serving MCP, REST or both.
interface Listener {
    key: string;
    address: ListenAddress;
    parts: ServedParts;
    server?: Server;
    // Aborted when the server closes, see ServerContext.stopSignal.
    stopped?: AbortController;
    error?: string;
}

// Closes the server and cancels the calls it is serving or queueing.
const close = ({ server, stopped }: Listener) => {
    stopped?.abort();
    return server && closeHttpServer(server);
};

const sameParts = (a: ServedParts, b: ServedParts) =>
    a.mcp === b.mcp && a.rest === b.rest;

export interface RemoteControlOptions {
    getContext: () => ServerContext;
    onStatus: (status: RemoteControlStatus) => void;
    operations: readonly Operation[];
    instructions?: string;
    // Accept port 0 (ephemeral) in listen addresses; for tests only.
    allowPortZero?: boolean;
}

// Runs the HTTP listeners of the remote control API. MCP and REST with the
// same listen address share one server; different addresses get one each.
//
// `apply` calls are serialised and coalesced (the latest config wins). Only
// listeners whose address or set of parts changed are restarted; the token is
// read on every request, so changing it restarts nothing. Errors never
// escape: they end up in the status of the affected parts.
//
// Closing a listener (stop, stopNow or a config change) also cancels the
// calls it serves: queued ones never run, running ones are aborted.
export default class RemoteControl {
    #listeners: Listener[] = [];
    #partErrors: Partial<Record<Part, string>> = {};
    #token = '';
    #pending?: RemoteControlConfig;
    #draining?: Promise<void>;
    #generation = 0;

    constructor(private readonly options: RemoteControlOptions) {}

    apply(config: RemoteControlConfig): Promise<void> {
        this.#token = config.token;
        this.#pending = config;
        if (!this.#draining) this.#draining = this.#drain();
        return this.#draining;
    }

    // Stops all listeners and waits until they are closed.
    async stop() {
        await this.apply({
            mcpEnabled: false,
            mcpListen: '',
            restEnabled: false,
            restListen: '',
            token: this.#token,
        });
    }

    // Synchronously stops listening, for `pagehide`, when there is no time to
    // wait. Idempotent. A reconcile in flight drops what it starts.
    stopNow() {
        this.#generation += 1;
        this.#pending = undefined;
        const running = this.#listeners;
        this.#listeners = [];
        this.#partErrors = {};
        running.forEach(close);
        this.#publishStatus();
    }

    // Number of listening HTTP servers.
    get serverCount() {
        return this.#listeners.filter(listener => listener.server).length;
    }

    async #drain() {
        try {
            while (this.#pending) {
                const config = this.#pending;
                this.#pending = undefined;
                // eslint-disable-next-line no-await-in-loop
                await this.#reconcile(config);
            }
        } finally {
            this.#draining = undefined;
        }
    }

    #wanted(config: RemoteControlConfig) {
        const wanted = new Map<string, Listener>();
        const partErrors: Partial<Record<Part, string>> = {};
        PARTS.forEach(part => {
            if (!config[`${part}Enabled`]) return;
            try {
                const address = parseListen(config[`${part}Listen`], {
                    allowPortZero: this.options.allowPortZero,
                });
                const key = formatHostPort(address);
                const listener = wanted.get(key) ?? {
                    key,
                    address,
                    parts: { mcp: false, rest: false },
                };
                listener.parts[part] = true;
                wanted.set(key, listener);
            } catch (error) {
                partErrors[part] = (error as Error).message;
            }
        });
        return { wanted, partErrors };
    }

    async #reconcile(config: RemoteControlConfig) {
        const generation = this.#generation;
        const { wanted, partErrors } = this.#wanted(config);
        this.#partErrors = partErrors;

        // A listener that failed to start is retried on every apply.
        const keep = (listener: Listener) => {
            const next = wanted.get(listener.key);
            return (
                listener.server !== undefined &&
                next !== undefined &&
                sameParts(next.parts, listener.parts)
            );
        };
        const obsolete = this.#listeners.filter(l => !keep(l));
        this.#listeners = this.#listeners.filter(keep);
        await Promise.all(obsolete.map(close));

        const kept = new Set(this.#listeners.map(l => l.key));
        const started = await Promise.all(
            [...wanted.values()]
                .filter(listener => !kept.has(listener.key))
                .map(listener => this.#start(listener)),
        );

        if (generation !== this.#generation) {
            // stopNow() ran meanwhile: nothing of this round may keep running.
            started.forEach(close);
            return;
        }
        this.#listeners.push(...started);
        this.#publishStatus();
    }

    async #start(listener: Listener): Promise<Listener> {
        const stopped = new AbortController();
        const handler = createRequestHandler({
            bindHost: listener.address.host,
            parts: listener.parts,
            getToken: () => this.#token,
            operations: this.options.operations,
            getContext: () => ({
                ...this.options.getContext(),
                stopSignal: stopped.signal,
            }),
            instructions: this.options.instructions,
        });
        try {
            const server = await startHttpServer(listener.address, handler);
            const { port } = server.address() as { port: number };
            const address = { ...listener.address, port };
            logger.info(
                `Remote control listening on http://${formatHostPort(address)}`,
            );
            return { ...listener, address, server, stopped };
        } catch (error) {
            const message = (error as Error).message;
            logger.error(`Remote control: ${message}`);
            return { ...listener, error: message };
        }
    }

    #partStatus(part: Part): PartStatus {
        const error = this.#partErrors[part];
        if (error) return { state: 'error', message: error };

        const listener = this.#listeners.find(l => l.parts[part]);
        if (!listener) return { state: 'stopped' };
        if (listener.error) return { state: 'error', message: listener.error };
        return {
            state: 'running',
            url: `http://${formatHostPort(listener.address)}${PATHS[part]}`,
        };
    }

    #publishStatus() {
        this.options.onStatus({
            mcp: this.#partStatus('mcp'),
            rest: this.#partStatus('rest'),
        });
    }
}
