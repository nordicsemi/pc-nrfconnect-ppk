/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import '../__testUtils__/operationMocks';

import {
    setDeviceRunning,
    setPowerMode,
    updateRegulator,
} from '../../../actions/deviceActions';
import {
    clearFileLoadedAction,
    setDeviceRunningAction,
    setFileLoadedAction,
    setPowerModeAction,
} from '../../../slices/appSlice';
import {
    contextFor,
    createTestStore,
    openPpk,
    type TestStore,
} from '../__testUtils__/fakeApp';
import { untilAborted } from '../__testUtils__/http';
import { cancelPowerOnsOnPowerOff, controlQueue } from '../controlQueue';
import {
    defineOperation,
    type Operation,
    type OperationResult,
    runOperation,
} from '../operation';
import power from '../operations/power';
import setMode from '../operations/setMode';
import setVoltage from '../operations/setVoltage';
import status from '../operations/status';

// An operation whose calls finish when the test says so.
const gated = () => {
    const started: string[] = [];
    const finish: (() => void)[] = [];
    const operation = defineOperation({
        name: 'gated',
        description: '',
        annotation: 'control',
        input: {},
        rest: { method: 'POST', path: '/api/gated' },
        handler: () =>
            new Promise<OperationResult>(resolve => {
                started.push(`call ${started.length + 1}`);
                finish.push(() => resolve({ status: 'ok' }));
            }),
    });
    return { operation, started, finish };
};

let store: TestStore;
let unwatch: () => void;
const run = (operation: Operation, args: unknown = {}) =>
    runOperation(operation, args, contextFor(store));
// A call of a server that stops when `stop` aborts.
const runOn = (stop: AbortController, operation: Operation) =>
    runOperation(
        operation,
        {},
        {
            ...contextFor(store),
            stopSignal: stop.signal,
        },
    );
const flush = () => jest.advanceTimersByTimeAsync(0);

beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    store = createTestStore();
    openPpk(store);
    // As RemoteControlProvider does.
    unwatch = cancelPowerOnsOnPowerOff(store);
});

afterEach(async () => {
    unwatch();
    // Nothing may hold the queue into the next test.
    await jest.runOnlyPendingTimersAsync();
    expect(controlQueue.busyOp).toBeUndefined();
});

it('runs control calls one at a time', async () => {
    const { operation, started, finish } = gated();
    const first = run(operation);
    const second = run(operation);
    await flush();
    expect(started).toEqual(['call 1']);

    finish[0]();
    expect(await first).toEqual({ status: 'ok' });
    await flush();
    expect(started).toEqual(['call 1', 'call 2']);
    finish[1]();
    expect(await second).toEqual({ status: 'ok' });
});

it('lets status pass a busy queue and shows the busy call', async () => {
    const { operation, finish } = gated();
    const call = run(operation);
    await flush();
    expect(await run(status)).toMatchObject({
        busy_op: { name: 'gated', origin: 'MCP', since_ts_ms: Date.now() },
    });
    finish[0]();
    await call;
});

it('answers busy after 15 s of waiting, never running the call', async () => {
    const { operation, started, finish } = gated();
    // A handler that ignores its timeout holds the queue.
    const holding = run(operation);
    const waiting = run(operation);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(await waiting).toMatchObject({ status: 'error', error: 'busy' });

    finish[0]();
    await holding;
    await flush();
    expect(started).toEqual(['call 1']);
});

it('holds the queue after a timeout until the handler is done', async () => {
    const { operation, started, finish } = gated();
    const first = run(operation);
    await jest.advanceTimersByTimeAsync(9_000);
    const second = run(operation);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(await first).toMatchObject({ error: 'timeout' });
    await flush();
    expect(started).toEqual(['call 1']);

    finish[0]();
    await flush();
    expect(started).toEqual(['call 1', 'call 2']);
    finish[1]();
    expect(await second).toEqual({ status: 'ok' });
});

it('switches the power off past a stuck queue', async () => {
    const { operation, finish } = gated();
    const stuck = run(operation);
    await flush();
    expect(await run(power, { on: false })).toEqual({
        status: 'ok',
        output_on: false,
    });
    finish[0]();
    await stuck;
});

it('cancels queued calls that would switch the power on', async () => {
    const { operation, finish } = gated();
    const stuck = run(operation);
    const powerOn = run(power, { on: true });
    const ampere = run(setMode, { mode: 'ampere' });
    const voltage = run(setVoltage, { mV: 2000 });
    await flush();

    expect(await run(power, { on: false })).toMatchObject({ status: 'ok' });
    expect(await powerOn).toMatchObject({ error: 'cancelled' });
    expect(await ampere).toMatchObject({ error: 'cancelled' });
    expect(setDeviceRunning).toHaveBeenCalledTimes(1);
    expect(setDeviceRunning).toHaveBeenCalledWith(false);
    expect(setPowerMode).not.toHaveBeenCalled();

    finish[0]();
    expect(await voltage).toMatchObject({ status: 'ok', voltage_mV: 2000 });
    expect(updateRegulator).toHaveBeenCalledTimes(1);
    await stuck;
});

it('cancels nothing with a refused power off', async () => {
    const { operation, finish } = gated();
    const stuck = run(operation);
    const powerOn = run(power, { on: true });
    await flush();

    store.dispatch(setFileLoadedAction('/data/old.ppk2'));
    expect(await run(power, { on: false })).toMatchObject({
        error: 'file_loaded',
    });
    store.dispatch(clearFileLoadedAction());

    finish[0]();
    expect(await powerOn).toMatchObject({ status: 'ok', output_on: true });
    expect(setDeviceRunning).toHaveBeenCalledTimes(1);
    expect(setDeviceRunning).toHaveBeenCalledWith(true);
    await stuck;
});

it('keeps the power off when it was switched off during set_mode(ampere)', async () => {
    (setPowerMode as jest.Mock).mockImplementationOnce(
        () => async (dispatch: (action: unknown) => void) => {
            dispatch(setPowerModeAction({ isSmuMode: false }));
            await run(power, { on: false }); // skips the queue
            await dispatch(setDeviceRunning(true));
        },
    );
    expect(await run(setMode, { mode: 'ampere' })).toEqual({
        status: 'error',
        error: 'cancelled',
        message: 'The DUT power was switched off meanwhile; it stays off',
        mode: 'ampere',
        output_on: false,
    });
    expect(store.getState().app.app.deviceRunning).toBe(false);
});

it('cancels queued power-ons when the DUT power goes off in the UI', async () => {
    store.dispatch(setDeviceRunningAction({ isRunning: true }));
    const { operation, finish } = gated();
    const stuck = run(operation);
    const powerOn = run(power, { on: true });
    await flush();

    // The human switches the power output off (or to source mode).
    store.dispatch(setDeviceRunningAction({ isRunning: false }));

    expect(await powerOn).toMatchObject({ error: 'cancelled' });
    finish[0]();
    await stuck;
    expect(setDeviceRunning).not.toHaveBeenCalled();
    expect(store.getState().app.app.deviceRunning).toBe(false);
});

it('cancels a power-on whose power off came after it left the queue', async () => {
    const holder = await controlQueue.acquire(
        { name: 'holder', origin: 'MCP' },
        { waitMs: 15_000, powersOn: false },
    );
    if (typeof holder === 'string') throw new Error(holder);
    const powerOn = run(power, { on: true });
    await flush();

    // The queue hands the slot over; a power off follows before the call
    // gets it.
    holder.release();
    controlQueue.powerOff();

    expect(await powerOn).toMatchObject({ error: 'cancelled' });
    expect(setDeviceRunning).not.toHaveBeenCalled();
});

it('answers ok to set_mode(source), which switches the power off itself', async () => {
    openPpk(store, { mode: 'ampere' });

    expect(await run(setMode, { mode: 'source' })).toEqual({
        status: 'ok',
        mode: 'source',
        output_on: false,
        changed: true,
    });
});

describe('when the server stops', () => {
    it('does not run a call of a stopped server', async () => {
        const { operation, started } = gated();
        const stop = new AbortController();
        stop.abort();
        expect(await runOn(stop, operation)).toMatchObject({
            error: 'cancelled',
            message: 'Cancelled: the server was stopped',
        });
        await flush();
        expect(started).toEqual([]);
    });

    it('cancels its queued calls, which never run', async () => {
        const { operation, started, finish } = gated();
        const stop = new AbortController();
        const stuck = run(operation);
        const queued = runOn(stop, operation);
        await flush();

        stop.abort();
        expect(await queued).toMatchObject({
            error: 'cancelled',
            message: 'Cancelled: the server was stopped',
        });
        finish[0]();
        await stuck;
        await flush();
        expect(started).toEqual(['call 1']);
    });

    it('aborts its running call', async () => {
        const { operation, signals } = untilAborted();
        const stop = new AbortController();
        const running = runOn(stop, operation);
        await flush();
        expect(signals[0].aborted).toBe(false);

        stop.abort();
        expect(signals[0].aborted).toBe(true);
        expect(await running).toMatchObject({
            error: 'cancelled',
            message: 'Cancelled: the server was stopped',
        });
    });
});
