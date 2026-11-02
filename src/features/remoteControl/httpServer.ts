/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import {
    createServer,
    type IncomingMessage,
    type Server,
    type ServerResponse,
} from 'http';

import { InvalidMaxMvError, parseMaxMv } from './clientVoltageLimit';
import {
    BodyTooLargeError,
    checkBearer,
    checkHostOrigin,
    isJsonContentType,
    readBody,
} from './httpGuards';
import { sendJson } from './httpResponse';
import { formatHostPort, type ListenAddress } from './listen';
import { handleMcpRequest } from './mcpHandler';
import { buildOpenApiDocument, OPENAPI_PATH } from './openapi';
import { type Operation, type ServerContext } from './operation';
import { handleRestRoute, matchRoute, type RestRoute } from './restHandler';

export const MCP_PATH = '/mcp';
export const REST_PREFIX = '/api';
export const MAX_BODY_BYTES = 1024 * 1024;

export interface ServedParts {
    mcp: boolean;
    rest: boolean;
}

export interface RequestHandlerOptions {
    // The address the server is bound to, for the Host check.
    bindHost: string;
    parts: ServedParts;
    // Read on every request, so a token change needs no restart.
    getToken: () => string;
    operations: readonly Operation[];
    getContext: () => ServerContext;
    instructions?: string;
}

const fail = (
    res: ServerResponse,
    status: number,
    error: string,
    message: string,
    headers?: Record<string, string>,
) => sendJson(res, status, { status: 'error', error, message }, headers);

type Reject = (
    status: number,
    error: string,
    message: string,
    headers?: Record<string, string>,
) => void;

type Target =
    | { kind: 'mcp' }
    | { kind: 'openapi' }
    | { kind: 'rest'; route: RestRoute };

// Resolves the target of a request or answers it with 404/405. MCP is
// stateless and has no SSE stream, so `/mcp` only takes POST.
const resolveTarget = (
    reject: Reject,
    method: string,
    pathname: string,
    { parts, operations }: RequestHandlerOptions,
): Target | undefined => {
    if (parts.mcp && pathname === MCP_PATH) {
        if (method === 'POST') return { kind: 'mcp' };
        reject(405, 'method_not_allowed', `${method} not allowed`, {
            Allow: 'POST',
        });
        return undefined;
    }
    if (parts.rest && pathname === OPENAPI_PATH) {
        if (method === 'GET') return { kind: 'openapi' };
        reject(405, 'method_not_allowed', `${method} not allowed`, {
            Allow: 'GET',
        });
        return undefined;
    }
    if (
        parts.rest &&
        (pathname === REST_PREFIX || pathname.startsWith(`${REST_PREFIX}/`))
    ) {
        const match = matchRoute(operations, method, pathname);
        if (match.found) return { kind: 'rest', route: match.route };
        if (match.allowed.length > 0) {
            reject(405, 'method_not_allowed', `${method} not allowed`, {
                Allow: match.allowed.join(', '),
            });
            return undefined;
        }
    }
    reject(404, 'not_found', `No endpoint at ${pathname}`);
    return undefined;
};

const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
    options: RequestHandlerOptions,
) => {
    const token = options.getToken();

    // An answer given before the body is read leaves it unread; closing the
    // connection keeps Node from reading and discarding it to reuse the
    // connection (e.g. a large body from an unauthenticated client).
    const hasBody =
        req.headers['transfer-encoding'] !== undefined ||
        Number(req.headers['content-length'] ?? 0) > 0;
    const reject: Reject = (status, error, message, headers = {}) =>
        fail(
            res,
            status,
            error,
            message,
            hasBody ? { ...headers, Connection: 'close' } : headers,
        );

    const rejection = checkHostOrigin(options.bindHost, req.headers, !!token);
    if (rejection) {
        reject(403, 'forbidden', rejection);
        return;
    }

    if (!checkBearer(token, req.headers.authorization)) {
        reject(401, 'unauthorized', 'Missing or wrong bearer token', {
            'WWW-Authenticate': 'Bearer',
        });
        return;
    }

    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');
    const target = resolveTarget(reject, method, url.pathname, options);
    if (!target) return;

    let maxMv: number | undefined;
    try {
        maxMv = parseMaxMv(url.searchParams);
    } catch (error) {
        if (!(error instanceof InvalidMaxMvError)) throw error;
        reject(400, 'invalid_argument', error.message);
        return;
    }

    let body = '';
    if (method === 'POST') {
        if (!isJsonContentType(req.headers['content-type'])) {
            reject(
                415,
                'unsupported_media_type',
                'POST bodies must be application/json',
            );
            return;
        }
        try {
            body = await readBody(req, MAX_BODY_BYTES);
        } catch (error) {
            if (!(error instanceof BodyTooLargeError)) throw error;
            fail(res, 413, 'payload_too_large', error.message, {
                Connection: 'close',
            });
            return;
        }
    }

    if (target.kind === 'mcp') {
        await handleMcpRequest(req, res, `${url.pathname}${url.search}`, body, {
            operations: options.operations,
            context: { ...options.getContext(), maxMv },
            instructions: options.instructions,
        });
        return;
    }

    if (target.kind === 'openapi') {
        const { host } = req.headers;
        sendJson(
            res,
            200,
            buildOpenApiDocument(options.operations, {
                serverUrl: host ? `http://${host}` : '/',
                hasToken: !!token,
            }),
        );
        return;
    }

    let parsed: unknown;
    if (method === 'POST') {
        try {
            parsed = body.trim() === '' ? {} : JSON.parse(body);
        } catch {
            fail(res, 400, 'invalid_json', 'The body is not valid JSON');
            return;
        }
    }
    await handleRestRoute(res, target.route, url.searchParams, parsed, {
        ...options.getContext(),
        maxMv,
    });
};

// The request listener: Host/Origin guard, then bearer token, then routing,
// then the client's max_mV. A disabled part answers 404. Never rejects: any failure becomes a JSON 500.
export const createRequestHandler =
    (options: RequestHandlerOptions) =>
    (req: IncomingMessage, res: ServerResponse) => {
        handle(req, res, options).catch(error => {
            if (res.headersSent) {
                if (!res.writableEnded) res.destroy();
                return;
            }
            fail(
                res,
                500,
                'internal',
                error instanceof Error ? error.message : String(error),
            );
        });
    };

const listenErrorMessage = (address: ListenAddress, error: unknown) => {
    const hostPort = formatHostPort(address);
    switch ((error as NodeJS.ErrnoException).code) {
        case 'EADDRINUSE':
            return `${hostPort} is already in use`;
        case 'EACCES':
            return `No permission to listen on ${hostPort}`;
        case 'EADDRNOTAVAIL':
            return `${address.host} is not an address of this computer`;
        default:
            return `Cannot listen on ${hostPort}: ${
                error instanceof Error ? error.message : String(error)
            }`;
    }
};

// Starts listening; rejects with a user-readable message on failure.
export const startHttpServer = (
    address: ListenAddress,
    listener: ReturnType<typeof createRequestHandler>,
) =>
    new Promise<Server>((resolve, reject) => {
        const server = createServer(listener);
        const onError = (error: unknown) => {
            reject(new Error(listenErrorMessage(address, error)));
        };
        server.once('error', onError);
        server.listen(address.port, address.host, () => {
            server.off('error', onError);
            // A running server must never throw an unhandled 'error' event.
            server.on('error', () => {});
            resolve(server);
        });
    });

// Stops listening and drops open connections, so the port is free again.
// The listening socket is released synchronously; the promise resolves when
// the server has fully closed.
export const closeHttpServer = (server: Server) =>
    new Promise<void>(resolve => {
        server.close(() => resolve());
        server.closeAllConnections();
    });
