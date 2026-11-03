/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

/* eslint-disable import/no-unresolved -- see mcpHandler.ts */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
/* eslint-enable import/no-unresolved */
import { type Server } from 'http';

import {
    initializeBody,
    json,
    MCP_HEADERS,
    request,
    startTestServer,
} from '../__testUtils__/http';
import { closeHttpServer } from '../httpServer';

const TOKEN = 'mcp-token';

let server: Server;
let port: number;
let client: Client;

beforeEach(async () => {
    ({ server, port } = await startTestServer({ token: TOKEN }));
    client = new Client({ name: 'test', version: '0' });
    await client.connect(
        new StreamableHTTPClientTransport(
            new URL(`http://127.0.0.1:${port}/mcp`),
            {
                requestInit: {
                    headers: { Authorization: `Bearer ${TOKEN}` },
                },
            },
        ),
    );
});

afterEach(async () => {
    await client.close();
    await closeHttpServer(server);
    jest.restoreAllMocks();
});

describe('MCP over HTTP with the SDK client', () => {
    it('initializes', () => {
        expect(client.getServerVersion()).toMatchObject({ name: 'ppk' });
        expect(client.getServerCapabilities()).toMatchObject({ tools: {} });
    });

    it('lists the MCP operations with annotations and a strict schema', async () => {
        const { tools } = await client.listTools();
        const names = tools.map(tool => tool.name);

        expect(names).toEqual([
            'status',
            'set_value',
            'query',
            'no_device',
            'boom',
        ]);
        expect(names).not.toContain('download'); // REST-only

        const status = tools.find(tool => tool.name === 'status');
        expect(status?.annotations).toEqual({
            readOnlyHint: true,
            openWorldHint: false,
        });
        const setValue = tools.find(tool => tool.name === 'set_value');
        expect(setValue?.annotations).toMatchObject({
            readOnlyHint: false,
            destructiveHint: false,
        });
        expect(setValue?.inputSchema).toMatchObject({
            type: 'object',
            properties: { mV: { type: 'integer' } },
            required: ['mV'],
            additionalProperties: false,
        });
    });

    it('calls status, returning the same JSON as REST', async () => {
        const result = await client.callTool({ name: 'status', arguments: {} });
        expect(result.isError).toBe(false);
        expect(result.structuredContent).toEqual({
            status: 'ok',
            device_selected: true,
            serial_number: 'E2BCADE3A438',
        });
        expect(result.content).toEqual([
            { type: 'text', text: JSON.stringify(result.structuredContent) },
        ]);

        const rest = await request(port, {
            path: '/api/status',
            headers: { authorization: `Bearer ${TOKEN}` },
        });
        expect(json(rest)).toEqual(result.structuredContent);
    });

    it.each([
        ['an unknown key', { mV: 1, extra: 1 }],
        ['a wrong type', { mV: 'x' }],
        ['a missing field', {}],
    ])(
        'returns invalid_argument in our shape for %s',
        async (_, args: Record<string, unknown>) => {
            const result = await client.callTool({
                name: 'set_value',
                arguments: args,
            });
            expect(result.isError).toBe(true);
            expect(result.structuredContent).toMatchObject({
                status: 'error',
                error: 'invalid_argument',
            });
        },
    );

    it('returns handler errors and exceptions as tool errors', async () => {
        const noDevice = await client.callTool({ name: 'no_device' });
        expect(noDevice.isError).toBe(true);
        expect(noDevice.structuredContent).toEqual({
            status: 'error',
            error: 'no_device',
            message: 'No PPK selected',
        });

        const boom = await client.callTool({ name: 'boom' });
        expect(boom.structuredContent).toMatchObject({ error: 'internal' });
    });

    it('rejects an unknown or REST-only tool', async () => {
        await expect(client.callTool({ name: 'download' })).rejects.toThrow(
            /Unknown tool/,
        );
    });
});

describe('MCP transport failures', () => {
    it('answers a JSON 500 when the transport throws and keeps serving', async () => {
        jest.spyOn(
            WebStandardStreamableHTTPServerTransport.prototype,
            'handleRequest',
        ).mockRejectedValueOnce(new Error('transport broke'));

        const response = await request(port, {
            method: 'POST',
            path: '/mcp',
            headers: { ...MCP_HEADERS, authorization: `Bearer ${TOKEN}` },
            body: initializeBody,
        });
        expect(response.status).toBe(500);
        expect(json(response)).toEqual({
            status: 'error',
            error: 'internal',
            message: 'transport broke',
        });

        const result = await client.callTool({ name: 'status' });
        expect(result.isError).toBe(false);
    });

    it('lets the SDK answer malformed JSON-RPC', async () => {
        const response = await request(port, {
            method: 'POST',
            path: '/mcp',
            headers: { ...MCP_HEADERS, authorization: `Bearer ${TOKEN}` },
            body: '{"jsonrpc":',
        });
        expect(response.status).toBe(400);
        expect(json(response)).toMatchObject({ error: { code: -32700 } });
    });
});
