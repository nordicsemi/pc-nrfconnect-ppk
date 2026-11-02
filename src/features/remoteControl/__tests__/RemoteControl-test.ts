/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { Agent, request as httpRequest } from 'http';
import { createServer as createNetServer, type Server } from 'net';

import { type RemoteControlConfig } from '../../../utils/persistentStore';
import {
    canBind,
    freePort,
    initializeBody,
    JSON_HEADERS,
    MCP_HEADERS,
    request,
    testContext,
    testOperations,
    untilAborted,
} from '../__testUtils__/http';
import { controlQueue } from '../controlQueue';
import { defineOperation } from '../operation';
import RemoteControl, { type RemoteControlStatus } from '../RemoteControl';

jest.mock('@nordicsemiconductor/pc-nrfconnect-shared', () => ({
    ...jest.requireActual('@nordicsemiconductor/pc-nrfconnect-shared'),
    logger: { info: jest.fn(), error: jest.fn() },
}));

const disabled: RemoteControlConfig = {
    mcpEnabled: false,
    mcpListen: '127.0.0.1:0',
    restEnabled: false,
    restListen: '127.0.0.1:0',
    token: '',
};

let statuses: RemoteControlStatus[];
let remoteControl: RemoteControl;
const blockers: Server[] = [];

const create = (allowPortZero = true) =>
    new RemoteControl({
        getContext: testContext,
        onStatus: status => statuses.push(status),
        operations: testOperations,
        allowPortZero,
    });

const lastStatus = () => statuses[statuses.length - 1];

const portOf = (status: RemoteControlStatus['mcp']) => {
    if (status.state !== 'running') {
        throw new Error(`not running: ${JSON.stringify(status)}`);
    }
    return Number(new URL(status.url).port);
};

const mcpCall = (port: number) =>
    request(port, {
        method: 'POST',
        path: '/mcp',
        headers: MCP_HEADERS,
        body: initializeBody,
    });

beforeEach(() => {
    statuses = [];
    remoteControl = create();
});

afterEach(async () => {
    await remoteControl.stop();
    await Promise.all(
        blockers.splice(0).map(
            blocker =>
                new Promise(resolve => {
                    blocker.close(resolve);
                }),
        ),
    );
});

describe('listeners', () => {
    it('serves MCP and REST from one server when the listen is the same', async () => {
        await remoteControl.apply({
            ...disabled,
            mcpEnabled: true,
            restEnabled: true,
        });

        expect(remoteControl.serverCount).toBe(1);
        const { mcp, rest } = lastStatus();
        const port = portOf(mcp);
        expect(portOf(rest)).toBe(port);
        expect(mcp).toEqual({
            state: 'running',
            url: `http://127.0.0.1:${port}/mcp`,
        });
        expect(rest).toEqual({
            state: 'running',
            url: `http://127.0.0.1:${port}/api`,
        });
        expect((await mcpCall(port)).status).toBe(200);
        expect((await request(port, { path: '/api/status' })).status).toBe(200);
    });

    it('treats localhost and 127.0.0.1 as the same listen', async () => {
        const port = await freePort();
        await remoteControl.apply({
            ...disabled,
            mcpEnabled: true,
            mcpListen: `localhost:${port}`,
            restEnabled: true,
            restListen: `127.0.0.1:${port}`,
        });
        expect(remoteControl.serverCount).toBe(1);
        expect(lastStatus().mcp).toEqual({
            state: 'running',
            url: `http://127.0.0.1:${port}/mcp`,
        });
    });

    it('runs two servers for different listens, each serving its part only', async () => {
        const restPort = await freePort();
        await remoteControl.apply({
            ...disabled,
            mcpEnabled: true,
            restEnabled: true,
            restListen: `127.0.0.1:${restPort}`,
        });

        expect(remoteControl.serverCount).toBe(2);
        const mcpPort = portOf(lastStatus().mcp);
        expect(portOf(lastStatus().rest)).toBe(restPort);
        expect(mcpPort).not.toBe(restPort);

        expect((await mcpCall(mcpPort)).status).toBe(200);
        expect((await request(mcpPort, { path: '/api/status' })).status).toBe(
            404,
        );
        expect((await request(restPort, { path: '/api/status' })).status).toBe(
            200,
        );
        expect((await mcpCall(restPort)).status).toBe(404);
    });

    it('serves nothing when both parts are disabled', async () => {
        await remoteControl.apply(disabled);
        expect(remoteControl.serverCount).toBe(0);
        expect(lastStatus()).toEqual({
            mcp: { state: 'stopped' },
            rest: { state: 'stopped' },
        });
    });
});

describe('errors', () => {
    it('reports a port in use as an error and keeps the other part running', async () => {
        const blocker = createNetServer();
        blockers.push(blocker);
        await new Promise<void>(resolve => {
            blocker.listen(0, '127.0.0.1', resolve);
        });
        const { port } = blocker.address() as { port: number };

        await expect(
            remoteControl.apply({
                ...disabled,
                mcpEnabled: true,
                mcpListen: `127.0.0.1:${port}`,
                restEnabled: true,
            }),
        ).resolves.toBeUndefined();

        expect(lastStatus().mcp).toEqual({
            state: 'error',
            message: `127.0.0.1:${port} is already in use`,
        });
        expect(lastStatus().rest.state).toBe('running');
        expect(remoteControl.serverCount).toBe(1);
    });

    it('retries a listener that failed to start on the next apply', async () => {
        const blocker = createNetServer();
        await new Promise<void>(resolve => {
            blocker.listen(0, '127.0.0.1', resolve);
        });
        const { port } = blocker.address() as { port: number };
        const config = {
            ...disabled,
            mcpEnabled: true,
            mcpListen: `127.0.0.1:${port}`,
        };
        await remoteControl.apply(config);
        expect(lastStatus().mcp.state).toBe('error');

        await new Promise(resolve => {
            blocker.close(resolve);
        });
        // Any apply, here a token change, tries the failed listener again.
        await remoteControl.apply({ ...config, token: 'new' });

        expect(lastStatus().mcp).toEqual({
            state: 'running',
            url: `http://127.0.0.1:${port}/mcp`,
        });
    });

    it('reports an invalid listen address as an error', async () => {
        await remoteControl.apply({
            ...disabled,
            restEnabled: true,
            restListen: 'example.com:8098',
        });
        expect(lastStatus().rest).toMatchObject({ state: 'error' });
        expect(remoteControl.serverCount).toBe(0);
    });

    it('rejects port 0 from user settings', async () => {
        remoteControl = create(false);
        await remoteControl.apply({
            ...disabled,
            mcpEnabled: true,
            mcpListen: '127.0.0.1:0',
        });
        expect(lastStatus().mcp).toMatchObject({
            state: 'error',
            message: expect.stringMatching(/Invalid port/),
        });
    });
});

describe('restarts', () => {
    it('restarts only the listener whose config changed', async () => {
        const config = {
            ...disabled,
            mcpEnabled: true,
            restEnabled: true,
            restListen: `127.0.0.1:${await freePort()}`,
        };
        await remoteControl.apply(config);
        const mcpUrl = lastStatus().mcp;

        const restPort = await freePort();
        await remoteControl.apply({
            ...config,
            restListen: `127.0.0.1:${restPort}`,
        });

        // MCP is on an ephemeral port: a restart would most likely move it.
        expect(lastStatus().mcp).toEqual(mcpUrl);
        expect(portOf(lastStatus().rest)).toBe(restPort);
        expect(remoteControl.serverCount).toBe(2);
    });

    it('does not restart on a token change, but enforces the new token', async () => {
        await remoteControl.apply({ ...disabled, restEnabled: true });
        const before = lastStatus();
        const port = portOf(before.rest);

        await remoteControl.apply({
            ...disabled,
            restEnabled: true,
            token: 'new',
        });
        expect(lastStatus()).toEqual(before);
        expect((await request(port, { path: '/api/status' })).status).toBe(401);
        expect(
            (
                await request(port, {
                    path: '/api/status',
                    headers: { authorization: 'Bearer new' },
                })
            ).status,
        ).toBe(200);
    });

    it('restarts a listener whose set of parts changed', async () => {
        await remoteControl.apply({ ...disabled, mcpEnabled: true });
        const port = portOf(lastStatus().mcp);
        expect((await request(port, { path: '/api/status' })).status).toBe(404);

        const shared = `127.0.0.1:${await freePort()}`;
        await remoteControl.apply({
            ...disabled,
            mcpEnabled: true,
            mcpListen: shared,
            restEnabled: true,
            restListen: shared,
        });
        const sharedPort = portOf(lastStatus().rest);
        expect(
            (await request(sharedPort, { path: '/api/status' })).status,
        ).toBe(200);
        expect(remoteControl.serverCount).toBe(1);
    });

    it('coalesces queued configs, the latest wins', async () => {
        const port = await freePort();
        remoteControl.apply({ ...disabled, mcpEnabled: true });
        remoteControl.apply({ ...disabled, restEnabled: true });
        await remoteControl.apply({
            ...disabled,
            restEnabled: true,
            restListen: `127.0.0.1:${port}`,
        });

        expect(remoteControl.serverCount).toBe(1);
        expect(lastStatus().mcp).toEqual({ state: 'stopped' });
        expect(portOf(lastStatus().rest)).toBe(port);
    });
});

describe('stopping frees the port', () => {
    // An idle keep-alive connection, which server.close() alone would wait for.
    const openKeepAlive = async (port: number) => {
        const agent = new Agent({ keepAlive: true });
        await new Promise<void>((resolve, reject) => {
            httpRequest(
                {
                    host: '127.0.0.1',
                    port,
                    path: '/api/status',
                    agent,
                },
                res => {
                    res.resume();
                    res.on('end', resolve);
                },
            )
                .on('error', reject)
                .end();
        });
        return agent;
    };

    it('stop() releases the port despite a keep-alive connection', async () => {
        const port = await freePort();
        await remoteControl.apply({
            ...disabled,
            restEnabled: true,
            restListen: `127.0.0.1:${port}`,
        });
        const agent = await openKeepAlive(port);

        await remoteControl.stop();

        expect(await canBind(port)).toBe(true);
        expect(remoteControl.serverCount).toBe(0);
        expect(lastStatus().rest).toEqual({ state: 'stopped' });
        agent.destroy();
    });

    it('stop() does not wait for a request in flight', async () => {
        const hang = defineOperation({
            name: 'hang',
            description: 'Never answers',
            annotation: 'read',
            input: {},
            rest: { method: 'GET', path: '/api/hang' },
            // Not queued: it would hold the queue for the later tests.
            queue: 'none',
            handler: () => new Promise<never>(() => {}),
        });
        remoteControl = new RemoteControl({
            getContext: testContext,
            onStatus: status => statuses.push(status),
            operations: [hang],
        });
        const port = await freePort();
        await remoteControl.apply({
            ...disabled,
            restEnabled: true,
            restListen: `127.0.0.1:${port}`,
        });
        const inFlight = request(port, { path: '/api/hang' }).catch(
            error => error,
        );
        await new Promise(resolve => {
            setTimeout(resolve, 50);
        });

        await remoteControl.stop();

        expect(await canBind(port)).toBe(true);
        // The connection is dropped (an Error from Node's realm).
        await expect(inFlight).resolves.toHaveProperty('code', 'ECONNRESET');
    });

    it('stopNow() releases the port synchronously and is idempotent', async () => {
        const port = await freePort();
        await remoteControl.apply({
            ...disabled,
            mcpEnabled: true,
            mcpListen: `127.0.0.1:${port}`,
        });
        const agent = await openKeepAlive(port);

        remoteControl.stopNow();
        remoteControl.stopNow();

        expect(await canBind(port)).toBe(true);
        expect(lastStatus().mcp).toEqual({ state: 'stopped' });
        agent.destroy();
    });

    it('stopNow() during a pending apply leaves nothing running', async () => {
        const port = await freePort();
        const pending = remoteControl.apply({
            ...disabled,
            restEnabled: true,
            restListen: `127.0.0.1:${port}`,
        });
        remoteControl.stopNow();
        await pending;

        expect(remoteControl.serverCount).toBe(0);
        expect(await canBind(port)).toBe(true);
    });

    it('a config change frees the old port', async () => {
        const oldPort = await freePort();
        await remoteControl.apply({
            ...disabled,
            restEnabled: true,
            restListen: `127.0.0.1:${oldPort}`,
        });
        await remoteControl.apply({ ...disabled, restEnabled: true });

        expect(await canBind(oldPort)).toBe(true);
    });
});

describe('stopping cancels the calls of the server', () => {
    const until = async (condition: () => boolean) => {
        while (!condition()) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise(resolve => {
                setTimeout(resolve, 10);
            });
        }
    };

    it.each([
        ['stop()', () => remoteControl.stop()],
        ['stopNow()', () => remoteControl.stopNow()],
        ['disabling its part', () => remoteControl.apply(disabled)],
    ])(
        '%s aborts the running call and drops the queued one',
        async (_, stop) => {
            const { operation: running, signals } = untilAborted('running');
            let queuedRan = false;
            const queued = defineOperation({
                name: 'queued',
                description: 'Waits for the running one',
                annotation: 'control',
                input: {},
                rest: { method: 'POST', path: '/api/queued' },
                handler: () => {
                    queuedRan = true;
                    return { status: 'ok' };
                },
            });
            remoteControl = new RemoteControl({
                getContext: testContext,
                onStatus: status => statuses.push(status),
                operations: [running, queued],
            });
            const port = await freePort();
            await remoteControl.apply({
                ...disabled,
                restEnabled: true,
                restListen: `127.0.0.1:${port}`,
            });
            const post = (path: string) =>
                request(port, {
                    method: 'POST',
                    path,
                    headers: JSON_HEADERS,
                    body: '{}',
                }).catch(error => error);
            const calls = [post('/api/running')];
            await until(() => signals.length === 1);
            calls.push(post('/api/queued'));
            await until(() => controlQueue.waitingCount === 1);

            await stop();

            expect(signals[0].aborted).toBe(true);
            await Promise.all(calls);
            await until(() => controlQueue.busyOp === undefined);
            expect(queuedRan).toBe(false);
        },
    );
});
