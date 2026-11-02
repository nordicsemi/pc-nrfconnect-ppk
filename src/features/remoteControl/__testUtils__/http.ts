/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { type AppDispatch } from '@nordicsemiconductor/pc-nrfconnect-shared';
import { selectedDevice } from '@nordicsemiconductor/pc-nrfconnect-shared';
import {
    type Agent,
    type IncomingHttpHeaders,
    request as httpRequest,
} from 'http';
import { createServer as createNetServer } from 'net';
import { Readable } from 'stream';
import { z } from 'zod';

import { type RootState } from '../../../slices';
import {
    createRequestHandler,
    type RequestHandlerOptions,
    startHttpServer,
} from '../httpServer';
import {
    defineOperation,
    type Operation,
    operationError,
    type OperationResult,
    RawResponse,
} from '../operation';

export interface TestResponse {
    status: number;
    headers: IncomingHttpHeaders;
    body: string;
}

export interface TestRequest {
    method?: string;
    path: string;
    // `host: null` sends no Host header at all.
    headers?: Record<string, string | null>;
    body?: string;
    // Default: a fresh connection per request, closed afterwards.
    agent?: Agent;
}

// A plain HTTP request without keep-alive, with full control over Host.
export const request = (
    port: number,
    { method = 'GET', path, headers = {}, body, agent }: TestRequest,
) =>
    new Promise<TestResponse>((resolve, reject) => {
        const { host, ...rest } = headers;
        const sent = Object.fromEntries(
            Object.entries(rest).filter(
                (entry): entry is [string, string] => entry[1] !== null,
            ),
        );
        if (host !== null) sent.host = host ?? `127.0.0.1:${port}`;
        const req = httpRequest(
            {
                host: '127.0.0.1',
                port,
                method,
                path,
                headers: sent,
                agent: agent ?? false,
                setHost: false,
            },
            res => {
                const chunks: Buffer[] = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () =>
                    resolve({
                        status: res.statusCode ?? 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf8'),
                    }),
                );
            },
        );
        req.on('error', reject);
        req.end(body);
    });

export const json = (response: TestResponse) => JSON.parse(response.body);

export const JSON_HEADERS = { 'content-type': 'application/json' };

export const MCP_HEADERS = {
    ...JSON_HEADERS,
    accept: 'application/json, text/event-stream',
};

export const initializeBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
    },
});

export const testState = {
    device: { selectedDevice: { serialNumber: 'E2BCADE3A438' } },
} as unknown as RootState;

export const testContext = () => ({
    getState: () => testState,
    dispatch: jest.fn() as unknown as AppDispatch,
    subscribe: () => () => {},
});

// The bodies the `stream` operation handed out, newest last.
export const streamedBodies: Readable[] = [];

export const streamOperation = defineOperation({
    name: 'stream',
    description: 'REST-only body that streams until the client goes away',
    annotation: 'read',
    mcp: false,
    input: {},
    rest: { method: 'GET', path: '/api/stream' },
    handler: () => {
        // Pushed to by hand; read() has nothing more to fetch.
        const body = new Readable({ read: () => undefined });
        body.push('first chunk');
        streamedBodies.push(body);
        return new RawResponse('text/plain', body);
    },
});

// A minimal `status`: these tests are about the HTTP layer, not the app.
export const status = defineOperation({
    name: 'status',
    description: 'Whether a PPK2 is selected and its serial number.',
    annotation: 'read',
    input: {},
    rest: { method: 'GET', path: '/api/status' },
    queue: 'none',
    handler: (_args, { getState }) => {
        const device = selectedDevice(getState());
        return {
            status: 'ok',
            device_selected: device != null,
            serial_number: device?.serialNumber ?? null,
        };
    },
});

// Operations covering every shape of the registration interface.
export const testOperations: readonly Operation[] = [
    status,
    defineOperation({
        name: 'set_value',
        description: 'Takes a number and an optional flag',
        annotation: 'control',
        input: { mV: z.number().int(), flag: z.boolean().optional() },
        rest: { method: 'POST', path: '/api/value' },
        handler: args => ({ status: 'ok', ...args }),
    }),
    defineOperation({
        name: 'query',
        description: 'Echoes typed query arguments',
        annotation: 'read',
        input: {
            n: z.number().optional(),
            b: z.boolean().optional(),
            positive: z
                .number()
                .refine(value => value > 0)
                .optional(),
            int: z.number().pipe(z.number().int()).optional(),
        },
        rest: { method: 'GET', path: '/api/query' },
        handler: args => ({ status: 'ok', ...args }),
    }),
    defineOperation({
        name: 'no_device',
        description: 'Always fails with no_device',
        annotation: 'read',
        input: {},
        rest: { method: 'GET', path: '/api/no-device' },
        handler: () => operationError('no_device', 'No PPK selected'),
    }),
    defineOperation({
        name: 'boom',
        description: 'Throws',
        annotation: 'control',
        input: {},
        rest: { method: 'POST', path: '/api/boom' },
        handler: () => {
            throw new Error('kaput');
        },
    }),
    defineOperation({
        name: 'download',
        description: 'REST-only raw file download',
        annotation: 'read',
        mcp: false,
        responseContentType: 'text/plain',
        input: { name: z.string().regex(/^[\w-]+(\.\w+)?$/) },
        rest: { method: 'GET', path: '/api/files/:name' },
        handler: ({ name }) =>
            new RawResponse('text/plain', Buffer.from(`file ${name}`)),
    }),
    streamOperation,
];

export const startTestServer = async (
    options: Partial<RequestHandlerOptions> & { token?: string } = {},
) => {
    const server = await startHttpServer(
        { host: '127.0.0.1', port: 0 },
        createRequestHandler({
            bindHost: '127.0.0.1',
            parts: { mcp: true, rest: true },
            getToken: () => options.token ?? '',
            operations: testOperations,
            getContext: testContext,
            ...options,
        }),
    );
    const { port } = server.address() as { port: number };
    return { server, port };
};

// Resolves to whether a fresh server can bind the port right now.
export const canBind = (port: number) =>
    new Promise<boolean>(resolve => {
        const probe = createNetServer();
        probe.once('error', () => resolve(false));
        probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });

// A port that was free a moment ago.
export const freePort = () =>
    new Promise<number>(resolve => {
        const probe = createNetServer();
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address() as { port: number };
            probe.close(() => resolve(port));
        });
    });

// An operation whose handler runs until its signal aborts; `signals` has
// the signal of every call, oldest first.
export const untilAborted = (name = 'until_aborted') => {
    const signals: AbortSignal[] = [];
    const operation = defineOperation({
        name,
        description: 'Runs until aborted',
        annotation: 'control',
        input: {},
        rest: { method: 'POST', path: `/api/${name}` },
        handler: (_args, { signal }) =>
            new Promise<OperationResult>(resolve => {
                signals.push(signal);
                signal.addEventListener('abort', () =>
                    resolve({ status: 'ok' }),
                );
            }),
    });
    return { operation, signals };
};
