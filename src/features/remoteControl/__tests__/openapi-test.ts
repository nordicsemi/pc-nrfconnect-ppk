/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import '../__testUtils__/operationMocks';

import { type Server } from 'http';

import { version } from '../../../../package.json';
import {
    json,
    request,
    startTestServer,
    testOperations,
} from '../__testUtils__/http';
import { closeHttpServer } from '../httpServer';
import { buildOpenApiDocument } from '../openapi';
import realOperations from '../operations';

/* eslint-disable @typescript-eslint/no-explicit-any */
const build = (hasToken = false, operations = testOperations): any =>
    buildOpenApiDocument(operations, {
        serverUrl: 'http://127.0.0.1:8098',
        hasToken,
    });

const MAX_MV_REF = { $ref: '#/components/parameters/max_mV' };

describe('buildOpenApiDocument', () => {
    it('takes max_mV as a shared query parameter on every operation', () => {
        const doc = build(false, realOperations);
        expect(doc.components.parameters.max_mV).toMatchObject({
            name: 'max_mV',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1 },
        });
        const operations = Object.values<any>(doc.paths).flatMap(item =>
            Object.values<any>(item),
        );
        expect(operations).toHaveLength(realOperations.length + 1);
        operations.forEach(op =>
            expect(op.parameters).toContainEqual(MAX_MV_REF),
        );
    });

    it('describes the API as OpenAPI 3.1 with the app version', () => {
        const doc = build();
        expect(doc.openapi).toBe('3.1.0');
        expect(doc.info).toEqual({
            title: 'Power Profiler remote control',
            version,
        });
        expect(doc.servers).toEqual([{ url: 'http://127.0.0.1:8098' }]);
        expect(() => JSON.parse(JSON.stringify(doc))).not.toThrow();
    });

    it('lists every registered operation once, with method and path', () => {
        const doc = build(false, realOperations);
        const found = Object.entries<any>(doc.paths).flatMap(([path, item]) =>
            Object.entries<any>(item).map(([method, op]) => ({
                method: method.toUpperCase(),
                path,
                id: op.operationId,
            })),
        );
        const expected = [
            ...realOperations.map(operation => ({
                method: operation.rest.method,
                path: operation.rest.path.replace(/:(\w+)/g, '{$1}'),
                id: operation.name,
            })),
            { method: 'GET', path: '/api/openapi.json', id: 'get_openapi' },
        ];
        expect(found).toHaveLength(expected.length);
        expect(found).toEqual(expect.arrayContaining(expected));
        expect(new Set(found.map(f => f.id)).size).toBe(found.length);
    });

    it('turns GET arguments into query parameters', () => {
        const { parameters: all } = build().paths['/api/query'].get;
        expect(all.at(-1)).toEqual(MAX_MV_REF);
        const parameters = all.slice(0, -1);
        expect(parameters.map((p: any) => [p.name, p.in, p.required])).toEqual([
            ['n', 'query', false],
            ['b', 'query', false],
            ['positive', 'query', false],
            ['int', 'query', false],
        ]);
        expect(parameters[0].schema).toMatchObject({ type: 'number' });
        expect(parameters[1].schema).toMatchObject({ type: 'boolean' });
        expect(build().paths['/api/query'].get.requestBody).toBeUndefined();
    });

    it('describes GET /api/trace with its window and the required points', () => {
        const op = build(false, realOperations).paths['/api/trace'].get;
        expect(op.operationId).toBe('trace');
        expect(op.description).toMatch(/t0_ms \+ i \* dt_ms/);
        expect(op.description).toMatch(/digital_changes/);
        const byName = Object.fromEntries(
            op.parameters
                .filter((p: any) => p.name)
                .map((p: any) => [p.name, p]),
        );
        expect(Object.keys(byName)).toEqual([
            'last_s',
            'from_ts_ms',
            'to_ts_ms',
            'points',
        ]);
        expect(byName.points).toMatchObject({
            in: 'query',
            required: true,
            schema: { type: 'integer', minimum: 1 },
        });
    });

    it('turns POST arguments into a strict JSON body', () => {
        const post = build().paths['/api/value'].post;
        expect(post.parameters).toEqual([MAX_MV_REF]);
        expect(post.requestBody).toEqual({
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            mV: { type: 'integer' },
                            flag: { type: 'boolean' },
                        },
                        required: ['mV'],
                        additionalProperties: false,
                    },
                },
            },
        });
    });

    it('converts :name path parameters to {name}', () => {
        const doc = build();
        expect(doc.paths['/api/files/:name']).toBeUndefined();
        const { get } = doc.paths['/api/files/{name}'];
        expect(get.parameters).toEqual([
            expect.objectContaining({
                name: 'name',
                in: 'path',
                required: true,
            }),
            MAX_MV_REF,
        ]);
        expect(get.responses[200].content).toHaveProperty('text/plain');
        expect(get.responses[404]).toBeDefined();
    });

    it('references the shared Error schema for the mapped statuses', () => {
        const doc = build();
        const { responses } = doc.paths['/api/value'].post;
        [400, 403, 409, 500, 503, 504].forEach(code => {
            expect(responses[code].content['application/json'].schema).toEqual({
                $ref: '#/components/schemas/Error',
            });
        });
        expect(responses[401]).toBeUndefined();
        expect(responses[404]).toBeUndefined();
        expect(doc.components.schemas.Error.required).toEqual([
            'status',
            'error',
            'message',
        ]);
    });

    it('declares bearerAuth only when a token is set', () => {
        const without = build(false);
        expect(without.security).toBeUndefined();
        expect(without.components.securitySchemes).toBeUndefined();
        expect(without.paths['/api/status'].get.responses[401]).toBeUndefined();

        const withToken = build(true);
        expect(withToken.security).toEqual([{ bearerAuth: [] }]);
        expect(withToken.components.securitySchemes.bearerAuth).toEqual({
            type: 'http',
            scheme: 'bearer',
        });
        expect(withToken.paths['/api/status'].get.responses[401]).toBeDefined();
    });
});

describe('GET /api/openapi.json', () => {
    const TOKEN = 's3cret-token';
    let servers: Server[] = [];
    const start = async (
        options: Parameters<typeof startTestServer>[0] = {},
    ) => {
        const { server, port } = await startTestServer(options);
        servers.push(server);
        return port;
    };
    afterEach(async () => {
        await Promise.all(servers.map(closeHttpServer));
        servers = [];
    });

    it('serves the document for the request Host', async () => {
        const port = await start();
        const response = await request(port, { path: '/api/openapi.json' });
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toMatch(/application\/json/);
        const doc = json(response);
        expect(doc.openapi).toBe('3.1.0');
        expect(doc.servers).toEqual([{ url: `http://127.0.0.1:${port}` }]);
        expect(doc.paths['/api/openapi.json'].get.operationId).toBe(
            'get_openapi',
        );
        expect(doc.paths['/api/value']).toBeDefined();
    });

    it('rejects a foreign Host with 403', async () => {
        const port = await start();
        const response = await request(port, {
            path: '/api/openapi.json',
            headers: { host: 'evil.example' },
        });
        expect(response.status).toBe(403);
    });

    it('needs the token when one is set', async () => {
        const port = await start({ token: TOKEN });
        const missing = await request(port, { path: '/api/openapi.json' });
        expect(missing.status).toBe(401);

        const ok = await request(port, {
            path: '/api/openapi.json',
            headers: { authorization: `Bearer ${TOKEN}` },
        });
        expect(ok.status).toBe(200);
        expect(json(ok).security).toEqual([{ bearerAuth: [] }]);
    });

    it('is read-only and REST-only', async () => {
        const port = await start();
        const post = await request(port, {
            method: 'POST',
            path: '/api/openapi.json',
            headers: { 'content-type': 'application/json' },
            body: '{}',
        });
        expect(post.status).toBe(405);
        expect(post.headers.allow).toBe('GET');

        const restOff = await start({ parts: { mcp: true, rest: false } });
        expect(
            (await request(restOff, { path: '/api/openapi.json' })).status,
        ).toBe(404);
    });
});
