/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { MCP_PATH } from './httpServer';
import {
    formatHostPort,
    isLoopbackIp,
    type ListenAddress,
    parseListen,
} from './listen';
import { OPENAPI_PATH } from './openapi';

const tryParse = (listen: string): ListenAddress | Error => {
    try {
        return parseListen(listen);
    } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
    }
};

// The address a client connects to for a listen address: a wildcard bind
// is reached through loopback. Null if the listen address is invalid.
const clientHostPort = (listen: string) => {
    const address = tryParse(listen);
    if (address instanceof Error) return null;

    const wildcards: Record<string, string> = {
        '0.0.0.0': '127.0.0.1',
        '::': '::1',
    };
    return formatHostPort({
        host: wildcards[address.host] ?? address.host,
        port: address.port,
    });
};

// The `.mcp.json` snippet for Claude Code, or null for an invalid listen
// address.
export const mcpJsonSnippet = (listen: string, token: string) => {
    const hostPort = clientHostPort(listen);
    if (hostPort == null) return null;

    return JSON.stringify(
        {
            mcpServers: {
                ppk: {
                    type: 'http',
                    url: `http://${hostPort}${MCP_PATH}`,
                    ...(token && {
                        headers: { Authorization: `Bearer ${token}` },
                    }),
                },
            },
        },
        null,
        2,
    );
};

// Where a client downloads the OpenAPI document, or null for an invalid
// listen address.
export const openApiUrl = (restListen: string) => {
    const hostPort = clientHostPort(restListen);
    return hostPort == null ? null : `http://${hostPort}${OPENAPI_PATH}`;
};

// True if the listen address is valid and reachable from other machines.
export const isExposed = (listen: string) => {
    const address = tryParse(listen);
    return !(address instanceof Error) && !isLoopbackIp(address.host);
};

// Error message for an invalid listen address, undefined for a valid one.
export const listenError = (listen: string) => {
    const address = tryParse(listen);
    return address instanceof Error ? address.message : undefined;
};
