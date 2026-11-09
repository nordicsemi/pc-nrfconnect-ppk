/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import '../__testUtils__/operationMocks';

import {
    currentPane,
    logger,
    setCurrentPane,
} from '@nordicsemiconductor/pc-nrfconnect-shared';

import { samplingStop } from '../../../actions/deviceActions';
import { startSamplingSession } from '../../../actions/samplingSessionActions';
import { type RootState } from '../../../slices';
import {
    samplingStartAction,
    samplingStoppedAction,
    setSavePending,
} from '../../../slices/appSlice';
import {
    updateDuration,
    updateDurationUnit,
} from '../../../slices/dataLoggerSlice';
import { Panes } from '../../../utils/panes';
import {
    contextFor,
    createTestStore,
    fakeData,
    openPpk,
    recordData,
    resetFakeData,
    type TestStore,
} from '../__testUtils__/fakeApp';
import { runOperation } from '../operation';
import sampling from '../operations/sampling';
import status from '../operations/status';
import { sessionOrigin, setApiSession } from '../sessionOrigin';

jest.mock('../../../actions/samplingSessionActions', () => ({
    startSamplingSession: jest.fn(),
}));

type Dispatch = (action: unknown) => unknown;

let store: TestStore;
const run = (args: unknown) => runOperation(sampling, args, contextFor(store));
const appState = () => store.getState().app;
const startMock = startSamplingSession as unknown as jest.Mock;

// startSamplingSession as with a PPK: a new session in `folder`.
let sessions = 0;
const startsSessions = (
    during: (dispatch: Dispatch) => void = () => {},
    wait: () => Promise<unknown> = () => Promise.resolve(),
) =>
    startMock.mockImplementation(() => async (dispatch: Dispatch) => {
        await wait();
        sessions += 1;
        fakeData.folder = `/sessions/api-${sessions}`;
        fakeData.bytes = 0;
        dispatch(samplingStartAction());
        during(dispatch);
        return { ok: true, freeSpace: 1e9 };
    });

// Samples arrive: data, unsaved.
const samplesArrive = () => {
    fakeData.bytes = 600;
    store.dispatch(setSavePending(true));
};

const stopAndRecordInUi = () => {
    store.dispatch(samplingStoppedAction());
    recordData({ folder: '/sessions/ui', lastUs: 1000 });
    store.dispatch(setSavePending(true));
};

beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    resetFakeData();
    setApiSession(undefined);
    store = createTestStore();
    openPpk(store);
    startsSessions();
});

describe('sampling start', () => {
    it('starts and claims the session for the API', async () => {
        expect(await run({ start: true })).toEqual({
            status: 'ok',
            sampling: true,
            sample_rate_hz: 100_000,
            duration_s: null,
            discarded_unsaved: false,
        });
        samplesArrive();
        expect(sessionOrigin()).toBe('api');
        expect(logger.info).toHaveBeenCalledWith('[MCP] Sampling start');
    });

    it('answers already_running while sampling', async () => {
        store.dispatch(samplingStartAction());
        expect(await run({ start: true })).toMatchObject({
            error: 'already_running',
        });
        expect(startMock).not.toHaveBeenCalled();
    });

    it('answers unsaved_data for unsaved data recorded in the app', async () => {
        stopAndRecordInUi();
        store.dispatch(setCurrentPane(Panes.SCOPE));
        const before = appState();
        expect(await run({ start: true, duration_s: 60 })).toMatchObject({
            status: 'error',
            error: 'unsaved_data',
        });
        expect(startMock).not.toHaveBeenCalled();
        // Neither the pane nor the duration changed.
        expect(appState()).toEqual(before);
        expect(currentPane(store.getState())).toBe(Panes.SCOPE);
    });

    it('starts over unsaved data the API recorded', async () => {
        await run({ start: true });
        samplesArrive();
        await run({ start: false });

        expect(await run({ start: true })).toMatchObject({
            status: 'ok',
            discarded_unsaved: true,
        });
        expect(startMock).toHaveBeenCalledTimes(2);
    });

    it('discards unsaved data of the app with discard_unsaved', async () => {
        stopAndRecordInUi();
        expect(await run({ start: true, discard_unsaved: true })).toMatchObject(
            { status: 'ok', discarded_unsaved: true },
        );
        expect(logger.info).toHaveBeenCalledWith(
            '[MCP] Sampling start, discarding unsaved data recorded in the app',
        );
    });

    it('starts when save is pending but there are no data', async () => {
        store.dispatch(setSavePending(true));
        recordData({ folder: '/sessions/ui', lastUs: 0 });
        fakeData.bytes = 0;
        expect(await run({ start: true })).toMatchObject({ status: 'ok' });
    });

    it('starts when the data are saved', async () => {
        recordData({ folder: '/sessions/ui', lastUs: 1000 });
        expect(await run({ start: true })).toMatchObject({ status: 'ok' });
    });

    it('protects a session started in the app after one of the API', async () => {
        await run({ start: true });
        samplesArrive();
        await run({ start: false });
        stopAndRecordInUi();
        expect(await run({ start: true })).toMatchObject({
            error: 'unsaved_data',
        });
    });

    it('claims nothing when a second session starts meanwhile', async () => {
        startsSessions(dispatch => {
            // The human presses Start while the API start is under way.
            fakeData.folder = '/sessions/ui-meanwhile';
            dispatch(samplingStartAction());
        });
        expect(await run({ start: true })).toMatchObject({ status: 'ok' });
        samplesArrive();
        expect(sessionOrigin()).toBe('ui');

        startsSessions();
        await run({ start: false });
        expect(await run({ start: true })).toMatchObject({
            error: 'unsaved_data',
        });
    });

    it.each([Panes.SCOPE, 'About'])(
        'switches from the %s pane to the Data Logger before starting',
        async pane => {
            store.dispatch(setCurrentPane(pane));
            startMock.mockImplementationOnce(
                () => (_: Dispatch, getState: () => RootState) => {
                    expect(currentPane(getState())).toBe(Panes.DATA_LOGGER);
                    return Promise.resolve({ ok: true });
                },
            );
            expect(await run({ start: true })).toMatchObject({ status: 'ok' });
        },
    );

    it.each([
        [60, 1, 'm'],
        [7200, 2, 'h'],
        [90, 90, 's'],
        [86400, 1, 'd'],
    ])('sets "Sample for" to %d s as %d %s', async (seconds, value, unit) => {
        expect(await run({ start: true, duration_s: seconds })).toMatchObject({
            duration_s: seconds,
        });
        expect(appState().dataLogger).toMatchObject({
            duration: value,
            durationUnit: unit,
        });
        expect(await runOperation(status, {}, contextFor(store))).toMatchObject(
            { duration_s: seconds },
        );
        expect(logger.info).toHaveBeenCalledWith(
            `[MCP] Sample for ${seconds} s`,
        );
    });

    it('sets an unlimited duration for null', async () => {
        store.dispatch(updateDuration(5));
        store.dispatch(updateDurationUnit('m'));
        expect(await run({ start: true, duration_s: null })).toMatchObject({
            duration_s: null,
        });
        expect(appState().dataLogger.durationUnit).toBe('inf');
    });

    it('leaves "Sample for" alone without duration_s', async () => {
        store.dispatch(updateDuration(5));
        store.dispatch(updateDurationUnit('m'));
        expect(await run({ start: true })).toMatchObject({ duration_s: 300 });
        expect(appState().dataLogger).toMatchObject({
            duration: 5,
            durationUnit: 'm',
        });
    });

    it('rejects a duration the app cannot show', async () => {
        const before = appState();
        expect(await run({ start: true, duration_s: 3601 })).toMatchObject({
            error: 'out_of_range',
        });
        expect(appState()).toEqual(before);
        expect(startMock).not.toHaveBeenCalled();
    });

    it.each([
        ['temp_disk_missing', 'The folder is gone'],
        ['disk_full', 'Disk is full'],
    ])('passes on %s', async (error, message) => {
        startMock.mockImplementation(
            () => () => Promise.resolve({ ok: false, error, message }),
        );
        expect(await run({ start: true })).toEqual({
            status: 'error',
            error,
            message,
            discarded_unsaved: false,
        });
        expect(sessionOrigin()).toBeNull();
    });

    it('tells that unsaved data were discarded also when the start fails', async () => {
        stopAndRecordInUi();
        startMock.mockImplementation(
            () => () =>
                Promise.resolve({
                    ok: false,
                    error: 'disk_full',
                    message: 'Disk is full',
                }),
        );
        expect(await run({ start: true, discard_unsaved: true })).toEqual({
            status: 'error',
            error: 'disk_full',
            message: 'Disk is full',
            discarded_unsaved: true,
        });
    });

    it('claims a start that finishes after its timeout, holding the queue', async () => {
        jest.useFakeTimers();
        let finish = () => {};
        startsSessions(
            undefined,
            () =>
                new Promise<void>(resolve => {
                    finish = resolve;
                }),
        );
        const answer = run({ start: true });
        await jest.advanceTimersByTimeAsync(30_000);
        expect(await answer).toMatchObject({ error: 'timeout' });
        expect(await runOperation(status, {}, contextFor(store))).toMatchObject(
            { busy_op: { name: 'sampling', origin: 'MCP' } },
        );

        finish();
        await jest.advanceTimersByTimeAsync(0);
        samplesArrive();
        expect(sessionOrigin()).toBe('api');
        expect(await runOperation(status, {}, contextFor(store))).toMatchObject(
            { busy_op: null },
        );
    });
});

describe('sampling stop', () => {
    it('stops when sampling', async () => {
        store.dispatch(samplingStartAction());
        expect(await run({ start: false })).toEqual({
            status: 'ok',
            was_running: true,
        });
        expect(samplingStop).toHaveBeenCalledTimes(1);
        expect(logger.info).toHaveBeenCalledWith('[MCP] Sampling stop');
    });

    it('is ok when not sampling', async () => {
        expect(await run({ start: false })).toEqual({
            status: 'ok',
            was_running: false,
        });
        expect(samplingStop).not.toHaveBeenCalled();
    });

    it.each([{ duration_s: 5 }, { discard_unsaved: true }])(
        'rejects start options %p',
        async options => {
            expect(await run({ start: false, ...options })).toMatchObject({
                error: 'invalid_argument',
            });
        },
    );
});
