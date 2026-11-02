/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import '../__testUtils__/operationMocks';

/* eslint-disable import/no-unresolved -- see mcpHandler.ts */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
/* eslint-enable import/no-unresolved */
import { type Server } from 'http';
import { z } from 'zod';

import { calcStats } from '../../../components/Chart/data/dataAccumulator';
import { DataManager } from '../../../globals';
import {
    createTestStore,
    openPpk,
    recordData,
    resetFakeData,
    serverContextFor,
    type TestStore,
} from '../__testUtils__/fakeApp';
import {
    initializeBody,
    json,
    JSON_HEADERS,
    MCP_HEADERS,
    request,
    startTestServer,
} from '../__testUtils__/http';
import { closeHttpServer } from '../httpServer';
import instructions from '../instructions';
import {
    defineOperation,
    type ErrorCode,
    errorHttpStatus,
    operationError,
} from '../operation';
import operations from '../operations';

jest.mock('../../../components/Chart/data/dataAccumulator', () => ({
    calcStats: jest.fn(),
}));

// Answers the error code it is given.
const failing = defineOperation({
    name: 'fail',
    description: '',
    annotation: 'read',
    input: { code: z.string() },
    rest: { method: 'POST', path: '/api/fail' },
    queue: 'none',
    handler: ({ code }) => operationError(code as ErrorCode, `failed: ${code}`),
});

let store: TestStore;
let server: Server;
let port: number;
let client: Client;

beforeEach(async () => {
    resetFakeData();
    store = createTestStore();
    ({ server, port } = await startTestServer({
        operations: [...operations, failing],
        getContext: () => serverContextFor(store),
        instructions,
    }));
    client = new Client({ name: 'test', version: '0' });
    await client.connect(
        new StreamableHTTPClientTransport(
            new URL(`http://127.0.0.1:${port}/mcp`),
        ),
    );
});

afterEach(async () => {
    await client.close();
    await closeHttpServer(server);
});

const rest = async (method: string, path: string, body?: unknown) => {
    const response = await request(port, {
        method,
        path,
        headers: body === undefined ? {} : JSON_HEADERS,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: json(response) };
};

it('sends the instructions on initialize', () => {
    expect(client.getInstructions()).toBe(instructions);
    expect(instructions).toMatch(/back-powered/);
});

it('lists the tools in order, without the REST-only download', async () => {
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name)).toEqual([
        'status',
        'list_devices',
        'set_voltage',
        'power',
        'set_mode',
        'set_sample_rate',
        'sampling',
        'stats',
        'trace',
        'export_csv',
        'fail',
    ]);
    expect(
        tools.find(tool => tool.name === 'power')?.annotations,
    ).toMatchObject({ destructiveHint: true });
});

it('answers status with the same JSON on MCP and REST', async () => {
    openPpk(store);
    const mcp = await client.callTool({ name: 'status', arguments: {} });
    const { status, body } = await rest('GET', '/api/status');
    expect(status).toBe(200);
    expect(mcp.structuredContent).toEqual(body);
    expect(body).toMatchObject({ status: 'ok', device_selected: true });
});

it.each(Object.entries(errorHttpStatus))(
    'maps %s to HTTP %d, and MCP to the same structured error',
    async (code, httpStatus) => {
        const expected = {
            status: 'error',
            error: code,
            message: `failed: ${code}`,
        };
        expect(await rest('POST', '/api/fail', { code })).toEqual({
            status: httpStatus,
            body: expected,
        });
        const mcp = await client.callTool({
            name: 'fail',
            arguments: { code },
        });
        expect(mcp.isError).toBe(true);
        expect(mcp.structuredContent).toEqual(expected);
    },
);

it('answers no_device with 503 over REST', async () => {
    expect(await rest('POST', '/api/voltage', { mV: 3000 })).toMatchObject({
        status: 503,
        body: { error: 'no_device' },
    });
});

it('takes the stats window from the query', async () => {
    DataManager().setSamplesPerSecond(1000);
    recordData({ lastUs: 9_999_000 });
    (calcStats as jest.Mock).mockImplementation(onComplete =>
        onComplete(10, 20, 2_000_000),
    );
    const { status, body } = await rest('GET', '/api/stats?last_s=2');
    expect(status).toBe(200);
    expect(body).toMatchObject({ avg_uA: 10, duration_ms: 2000 });
    expect((calcStats as jest.Mock).mock.calls[0].slice(1, 3)).toEqual([
        7_999_000, 9_999_000,
    ]);
});

describe('max_mV in the URL', () => {
    const range = (max: number) => ({ min: 800, max });

    it('limits the REST client: status, set_voltage and power', async () => {
        openPpk(store);
        expect(await rest('GET', '/api/status?max_mV=3500')).toMatchObject({
            status: 200,
            body: { voltage_range_mV: range(3500) },
        });
        expect(
            await rest('POST', '/api/voltage?max_mV=3500', { mV: 3501 }),
        ).toMatchObject({
            status: 400,
            body: { error: 'out_of_range', voltage_range_mV: range(3500) },
        });
        expect(
            await rest('POST', '/api/power?max_mV=2999', { on: true }),
        ).toMatchObject({ status: 400, body: { error: 'out_of_range' } });
        expect(await rest('GET', '/api/status')).toMatchObject({
            body: { voltage_range_mV: range(5000), output_on: false },
        });
    });

    it('is no argument of a GET operation, beside its own', async () => {
        DataManager().setSamplesPerSecond(1000);
        recordData({ lastUs: 9_999_000 });
        (calcStats as jest.Mock).mockImplementation(onComplete =>
            onComplete(10, 20, 2_000_000),
        );
        expect(
            await rest('GET', '/api/stats?max_mV=3500&last_s=2'),
        ).toMatchObject({ status: 200, body: { status: 'ok', avg_uA: 10 } });
    });

    it('limits the MCP client', async () => {
        openPpk(store);
        const limited = new Client({ name: 'limited', version: '0' });
        await limited.connect(
            new StreamableHTTPClientTransport(
                new URL(`http://127.0.0.1:${port}/mcp?max_mV=3000`),
            ),
        );
        try {
            const answer = await limited.callTool({
                name: 'set_voltage',
                arguments: { mV: 3001 },
            });
            expect(answer.structuredContent).toMatchObject({
                error: 'out_of_range',
                voltage_range_mV: range(3000),
            });
            const state = await limited.callTool({
                name: 'status',
                arguments: {},
            });
            expect(state.structuredContent).toMatchObject({
                voltage_range_mV: range(3000),
            });
        } finally {
            await limited.close();
        }
    });

    it.each([
        '0',
        '-1',
        '3000.5',
        '1e3',
        'abc',
        'NaN',
        '',
        '99999999999999999999',
        '3000&max_mV=3000',
    ])('rejects max_mV=%s with 400 on MCP and REST', async value => {
        const expected = {
            status: 400,
            body: {
                status: 'error',
                error: 'invalid_argument',
                message: expect.stringMatching(/^max_mV /),
            },
        };
        expect(await rest('GET', `/api/status?max_mV=${value}`)).toEqual(
            expected,
        );
        expect(
            await rest('POST', `/api/voltage?max_mV=${value}`, { mV: 3000 }),
        ).toEqual(expected);
        const mcp = await request(port, {
            method: 'POST',
            path: `/mcp?max_mV=${value}`,
            headers: MCP_HEADERS,
            body: initializeBody,
        });
        expect({ status: mcp.status, body: json(mcp) }).toEqual(expected);
    });
});
