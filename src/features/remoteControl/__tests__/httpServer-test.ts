/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

// eslint-disable-next-line import/no-unresolved -- see mcpHandler.ts
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Agent, request as httpRequest, type Server } from 'http';

import {
    initializeBody,
    json,
    JSON_HEADERS,
    MCP_HEADERS,
    request,
    startTestServer,
    streamedBodies,
    type TestRequest,
} from '../__testUtils__/http';
import { closeHttpServer, MAX_BODY_BYTES } from '../httpServer';

const TOKEN = 's3cret-token';

const waitUntil = async (condition: () => boolean, timeoutMs = 2000) => {
    const deadline = Date.now() + timeoutMs;
    while (!condition() && Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => {
            setTimeout(resolve, 10);
        });
    }
};

let servers: Server[] = [];
const start = async (options: Parameters<typeof startTestServer>[0] = {}) => {
    const { server, port } = await startTestServer(options);
    servers.push(server);
    return port;
};

afterEach(async () => {
    await Promise.all(servers.map(closeHttpServer));
    servers = [];
});

const statusRequest = (headers: TestRequest['headers'] = {}) => ({
    path: '/api/status',
    headers,
});
const mcpRequest = (headers: TestRequest['headers'] = {}) => ({
    method: 'POST',
    path: '/mcp',
    headers: { ...MCP_HEADERS, ...headers },
    body: initializeBody,
});

describe('bearer token', () => {
    it.each([
        ['REST', statusRequest],
        ['MCP', mcpRequest],
    ])('%s: rejects a missing or wrong token with 401', async (_, make) => {
        const port = await start({ token: TOKEN });

        const missing = await request(port, make());
        expect(missing.status).toBe(401);
        expect(missing.headers['www-authenticate']).toBe('Bearer');
        expect(json(missing)).toMatchObject({
            status: 'error',
            error: 'unauthorized',
        });

        const wrong = await request(
            port,
            make({ authorization: `Bearer ${TOKEN}x` }),
        );
        expect(wrong.status).toBe(401);

        const otherScheme = await request(
            port,
            make({ authorization: `Basic ${TOKEN}` }),
        );
        expect(otherScheme.status).toBe(401);
    });

    it.each([
        ['REST', statusRequest],
        ['MCP', mcpRequest],
    ])('%s: accepts the right token', async (_, make) => {
        const port = await start({ token: TOKEN });
        const response = await request(
            port,
            make({ authorization: `bearer ${TOKEN}` }),
        );
        expect(response.status).toBe(200);
    });

    it('needs no token when none is set', async () => {
        const port = await start();
        expect((await request(port, statusRequest())).status).toBe(200);
    });

    it('reads the token on every request', async () => {
        let token = 'old';
        const port = await start({ getToken: () => token });
        const auth = (value: string) => ({ authorization: `Bearer ${value}` });

        expect((await request(port, statusRequest(auth('old')))).status).toBe(
            200,
        );
        token = 'new';
        expect((await request(port, statusRequest(auth('old')))).status).toBe(
            401,
        );
        expect((await request(port, statusRequest(auth('new')))).status).toBe(
            200,
        );
    });
});

describe('Host and Origin guard on a loopback bind', () => {
    it.each([
        'evil.example',
        '127.0.0.1.evil.com',
        'localhost.evil.com',
        '127.0.0.1@evil.com',
    ])('rejects Host %s with 403 on REST and MCP', async host => {
        const port = await start();
        const withHost = { host: `${host}:${port}` };

        const rest = await request(port, statusRequest(withHost));
        expect(rest.status).toBe(403);
        expect(json(rest)).toMatchObject({ error: 'forbidden' });
        expect((await request(port, mcpRequest(withHost))).status).toBe(403);
    });

    it('rejects a request without Host', async () => {
        const port = await start();
        const response = await request(port, statusRequest({ host: null }));
        // Node itself answers 400 to HTTP/1.1 without Host (requireHostHeader);
        // checkHostOrigin's own check is pinned in httpGuards-test.
        expect(response.status).toBe(400);
    });

    it('checks Host before the token', async () => {
        const port = await start({ token: TOKEN });
        const response = await request(
            port,
            statusRequest({
                host: 'evil.example',
                authorization: `Bearer ${TOKEN}`,
            }),
        );
        expect(response.status).toBe(403);
    });

    it.each(['127.0.0.1', 'localhost', 'LOCALHOST', '[::1]', '127.0.0.5'])(
        'accepts Host %s',
        async host => {
            const port = await start();
            const withHost = { host: `${host}:${port}` };
            expect((await request(port, statusRequest(withHost))).status).toBe(
                200,
            );
            expect((await request(port, mcpRequest(withHost))).status).toBe(
                200,
            );
        },
    );

    it.each([
        'http://evil.example',
        'http://localhost.evil.com',
        'http://127.0.0.1.evil.com',
        'null',
        'https://localhost',
        'file://',
    ])('rejects Origin %s with 403 on REST and MCP', async origin => {
        const port = await start();
        expect((await request(port, statusRequest({ origin }))).status).toBe(
            403,
        );
        expect((await request(port, mcpRequest({ origin }))).status).toBe(403);
    });

    it.each(['http://localhost:3000', 'http://127.0.0.1', 'http://[::1]:1'])(
        'accepts Origin %s',
        async origin => {
            const port = await start();
            expect(
                (await request(port, statusRequest({ origin }))).status,
            ).toBe(200);
        },
    );
});

// The handler gets the bind address as `bindHost`; the test server itself
// stays on 127.0.0.1 so nothing is reachable from the network.
describe('Host and Origin guard on a non-loopback bind', () => {
    it('rejects a DNS name in Host without a token', async () => {
        const port = await start({ bindHost: '0.0.0.0' });
        const response = await request(
            port,
            statusRequest({ host: `evil.example:${port}` }),
        );
        expect(response.status).toBe(403);
    });

    it.each(['192.168.1.10:8098', '[fe80::1]:8098', '10.0.0.1'])(
        'accepts the IP literal Host %s without a token',
        async host => {
            const port = await start({ bindHost: '0.0.0.0' });
            expect((await request(port, statusRequest({ host }))).status).toBe(
                200,
            );
        },
    );

    it('accepts any Host with a token', async () => {
        const port = await start({ bindHost: '0.0.0.0', token: TOKEN });
        const response = await request(
            port,
            statusRequest({
                host: 'ppk.lab.example:8098',
                authorization: `Bearer ${TOKEN}`,
            }),
        );
        expect(response.status).toBe(200);
    });

    it('still rejects a foreign Origin with a token', async () => {
        const port = await start({ bindHost: '0.0.0.0', token: TOKEN });
        const response = await request(
            port,
            statusRequest({
                origin: 'http://evil.example',
                authorization: `Bearer ${TOKEN}`,
            }),
        );
        expect(response.status).toBe(403);
    });
});

describe('POST bodies', () => {
    const post = (
        path: string,
        headers: Record<string, string>,
        body = '{}',
    ) => ({
        method: 'POST',
        path,
        headers,
        body,
    });

    it.each([
        ['text/plain', { 'content-type': 'text/plain' }],
        ['form', { 'content-type': 'application/x-www-form-urlencoded' }],
        ['no content type', {}],
    ])('rejects %s with 415 on REST and MCP', async (_, headers) => {
        const port = await start();
        const rest = await request(port, post('/api/value', headers));
        expect(rest.status).toBe(415);
        expect(json(rest)).toMatchObject({ error: 'unsupported_media_type' });

        const mcp = await request(
            port,
            post(
                '/mcp',
                { ...headers, accept: MCP_HEADERS.accept },
                initializeBody,
            ),
        );
        expect(mcp.status).toBe(415);
    });

    it('accepts application/json with parameters', async () => {
        const port = await start();
        const response = await request(
            port,
            post(
                '/api/value',
                { 'content-type': 'Application/JSON; charset=utf-8' },
                '{"mV":3000}',
            ),
        );
        expect(response.status).toBe(200);
        expect(json(response)).toEqual({ status: 'ok', mV: 3000 });
    });

    it('rejects invalid JSON with 400', async () => {
        const port = await start();
        const response = await request(
            port,
            post('/api/value', JSON_HEADERS, '{"mV":'),
        );
        expect(response.status).toBe(400);
        expect(json(response)).toMatchObject({ error: 'invalid_json' });
    });

    it.each([
        ['a non-object body', '[1]'],
        ['an unknown key', '{"mV":1,"extra":true}'],
        ['a wrong type', '{"mV":"3000"}'],
        ['a missing field', '{}'],
    ])('rejects %s with 400 invalid_argument', async (_, body) => {
        const port = await start();
        const response = await request(
            port,
            post('/api/value', JSON_HEADERS, body),
        );
        expect(response.status).toBe(400);
        expect(json(response)).toMatchObject({
            status: 'error',
            error: 'invalid_argument',
        });
    });

    it('answers 413 with Connection: close for a declared large body', async () => {
        const port = await start();
        const response = await request(port, {
            method: 'POST',
            path: '/api/value',
            headers: {
                ...JSON_HEADERS,
                'content-length': String(2 * MAX_BODY_BYTES),
            },
            body: '{',
        });
        expect(response.status).toBe(413);
        expect(response.headers.connection).toBe('close');
        expect(json(response)).toMatchObject({ error: 'payload_too_large' });
    });

    it('stops reading a chunked body over the limit with 413', async () => {
        const port = await start();
        const chunk = Buffer.alloc(64 * 1024, 0x20);
        const intended = 4 * MAX_BODY_BYTES;
        const { status, sentAtResponse } = await new Promise<{
            status: number;
            sentAtResponse: number;
        }>((resolve, reject) => {
            let sent = 0;
            let answered = false;
            const req = httpRequest(
                {
                    host: '127.0.0.1',
                    port,
                    method: 'POST',
                    path: '/api/value',
                    headers: JSON_HEADERS,
                    agent: false,
                },
                res => {
                    answered = true;
                    res.resume();
                    resolve({
                        status: res.statusCode ?? 0,
                        sentAtResponse: sent,
                    });
                },
            );
            req.on('error', error => {
                // The server closes while the client still writes.
                const { code } = error as NodeJS.ErrnoException;
                if (code !== 'EPIPE' && code !== 'ECONNRESET') reject(error);
            });
            // Writes at the pace the server reads, until it answers.
            const writeMore = () => {
                while (!answered && sent < intended) {
                    sent += chunk.length;
                    if (!req.write(chunk)) {
                        req.once('drain', writeMore);
                        return;
                    }
                }
                if (!answered) req.end();
            };
            writeMore();
        });
        expect(status).toBe(413);
        // The server answered long before the client could send it all.
        expect(sentAtResponse).toBeLessThan(intended);
    });
});

describe('max_mV', () => {
    it('is checked after the token', async () => {
        const port = await start({ token: TOKEN });
        const response = await request(port, {
            path: '/api/status?max_mV=0',
        });
        expect(response.status).toBe(401);
        const authorized = await request(port, {
            path: '/api/status?max_mV=0',
            headers: { authorization: `Bearer ${TOKEN}` },
        });
        expect(authorized.status).toBe(400);
    });
});

describe('routing', () => {
    it('answers 404 for REST when only MCP is served', async () => {
        const port = await start({ parts: { mcp: true, rest: false } });
        const response = await request(port, statusRequest());
        expect(response.status).toBe(404);
        expect(json(response)).toMatchObject({ error: 'not_found' });
        expect((await request(port, mcpRequest())).status).toBe(200);
    });

    it('answers 404 for MCP when only REST is served', async () => {
        const port = await start({ parts: { mcp: false, rest: true } });
        expect((await request(port, mcpRequest())).status).toBe(404);
        expect((await request(port, statusRequest())).status).toBe(200);
    });

    it.each(['/api/nope', '/api', '/other', '/mcp/x'])(
        'answers 404 for %s',
        async path => {
            const port = await start();
            expect((await request(port, { path })).status).toBe(404);
        },
    );

    it('handles an absolute-form request target', async () => {
        const handleRequest = jest.spyOn(
            WebStandardStreamableHTTPServerTransport.prototype,
            'handleRequest',
        );
        const port = await start();
        const absolute = `http://127.0.0.1:${port}`;
        const mcp = await request(port, {
            ...mcpRequest(),
            path: `${absolute}/mcp?x=1`,
        });
        expect(mcp.status).toBe(200);
        // The SDK gets the parsed path, not `http://localhost` + the target.
        expect(handleRequest.mock.calls[0][0].url).toBe(
            'http://localhost/mcp?x=1',
        );
        handleRequest.mockRestore();
        expect(json(mcp)).toMatchObject({
            result: { serverInfo: { name: 'ppk' } },
        });

        const rest = await request(port, { path: `${absolute}/api/query?n=1` });
        expect(json(rest)).toEqual({ status: 'ok', n: 1 });
    });

    it('answers 405 with Allow for a wrong method', async () => {
        const port = await start();
        const rest = await request(port, {
            method: 'POST',
            path: '/api/status',
            headers: JSON_HEADERS,
            body: '{}',
        });
        expect(rest.status).toBe(405);
        expect(rest.headers.allow).toBe('GET');

        const mcp = await request(port, { path: '/mcp' });
        expect(mcp.status).toBe(405);
        expect(mcp.headers.allow).toBe('POST');
    });

    it('converts GET query values by the schema', async () => {
        const port = await start();
        const ok = await request(port, { path: '/api/query?n=5.5&b=true' });
        expect(json(ok)).toEqual({ status: 'ok', n: 5.5, b: true });

        const refined = await request(port, {
            path: '/api/query?positive=5&int=3',
        });
        expect(json(refined)).toEqual({ status: 'ok', positive: 5, int: 3 });
        const notPositive = await request(port, {
            path: '/api/query?positive=-1',
        });
        expect(notPositive.status).toBe(400);

        const bad = await request(port, { path: '/api/query?n=abc' });
        expect(bad.status).toBe(400);
        const unknown = await request(port, { path: '/api/query?x=1' });
        expect(unknown.status).toBe(400);
    });

    it('maps an operation error to its HTTP status', async () => {
        const port = await start();
        const response = await request(port, { path: '/api/no-device' });
        expect(response.status).toBe(503);
        expect(json(response)).toEqual({
            status: 'error',
            error: 'no_device',
            message: 'No PPK selected',
        });
    });

    it('answers 500 when a handler throws and keeps serving', async () => {
        const port = await start();
        const response = await request(port, {
            method: 'POST',
            path: '/api/boom',
            headers: JSON_HEADERS,
            body: '{}',
        });
        expect(response.status).toBe(500);
        expect(json(response)).toEqual({
            status: 'error',
            error: 'internal',
            message: 'kaput',
        });
        expect((await request(port, statusRequest())).status).toBe(200);
    });
});

describe('Connection: close for an unread body', () => {
    const keepAlive = () => new Agent({ keepAlive: true });

    it.each([
        ['401', { token: TOKEN }, '/api/value', {}],
        ['403', {}, '/api/value', { host: 'evil.example' }],
        ['404', {}, '/api/nope', {}],
        ['405', {}, '/api/status', {}],
        ['415', {}, '/api/value', { 'content-type': 'text/plain' }],
    ])(
        '%s with a body closes the connection',
        async (_, options, path, headers) => {
            const port = await start(options);
            const agent = keepAlive();
            const response = await request(port, {
                method: 'POST',
                path,
                headers: { ...JSON_HEADERS, ...headers },
                body: '{"mV":1}',
                agent,
            });
            agent.destroy();
            expect(response.headers.connection).toBe('close');
        },
    );

    it('a rejection without a body keeps the connection', async () => {
        const port = await start({ token: TOKEN });
        const agent = keepAlive();
        const response = await request(port, { ...statusRequest(), agent });
        agent.destroy();
        expect(response.status).toBe(401);
        expect(response.headers.connection).toBe('keep-alive');
    });
});

describe('REST-only raw routes', () => {
    it('passes the path parameter and sends the raw body', async () => {
        const port = await start();
        const response = await request(port, { path: '/api/files/a.csv' });
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('text/plain');
        expect(response.body).toBe('file a.csv');
    });

    it('validates the path parameter', async () => {
        const port = await start();
        const response = await request(port, {
            path: '/api/files/..%2Fetc',
        });
        expect(response.status).toBe(400);
    });

    it('destroys a streamed body when the client goes away', async () => {
        const port = await start();
        await new Promise<void>((resolve, reject) => {
            const req = httpRequest(
                { host: '127.0.0.1', port, path: '/api/stream', agent: false },
                res =>
                    res.once('data', () => {
                        req.destroy();
                        resolve();
                    }),
            );
            req.on('error', reject);
            req.end();
        });
        const body = streamedBodies[streamedBodies.length - 1];
        await waitUntil(() => body.destroyed);
        expect(body.destroyed).toBe(true);
    });

    it('is behind the same Host and token checks', async () => {
        const port = await start({ token: TOKEN });
        const path = '/api/files/a.csv';
        expect((await request(port, { path })).status).toBe(401);
        expect(
            (
                await request(port, {
                    path,
                    headers: {
                        host: 'evil.example',
                        authorization: `Bearer ${TOKEN}`,
                    },
                })
            ).status,
        ).toBe(403);
    });
});
