/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import '../__testUtils__/operationMocks';

import { calcStats } from '../../../components/Chart/data/dataAccumulator';
import { DataManager } from '../../../globals';
import {
    contextFor,
    createTestStore,
    fakeData,
    openPpk,
    recordData,
    resetFakeData,
    START_MS,
    type TestStore,
} from '../__testUtils__/fakeApp';
import { selection } from '../__testUtils__/fakeSamples';
import { runOperation } from '../operation';
import power from '../operations/power';
import stats from '../operations/stats';

jest.mock('../../../components/Chart/data/dataAccumulator', () => ({
    calcStats: jest.fn(),
}));

type OnComplete = (average: number, max: number, delta: number) => void;
const calcStatsMock = calcStats as jest.Mock;

let store: TestStore;
const run = (args: unknown) => runOperation(stats, args, contextFor(store));

// calcStats answering right away with these values.
const statsAre = (average: number, max: number, delta: number) =>
    calcStatsMock.mockImplementation((onComplete: OnComplete) =>
        onComplete(average, max, delta),
    );
const windowPassed = () => calcStatsMock.mock.calls[0].slice(1, 3);

beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    resetFakeData();
    store = createTestStore();
    statsAre(100, 250, 2_000_000);
});

describe.each([
    [1000, 9_999_000],
    [1, 9_000_000],
])('the window at %d Hz', (rate, lastUs) => {
    const periodUs = 1e6 / rate;
    beforeEach(() => {
        DataManager().setSamplesPerSecond(rate);
        recordData({ lastUs });
    });

    it('turns epoch ms into whole samples within the window', async () => {
        const result = await run({
            from_ts_ms: START_MS + 2000 + periodUs / 2500,
            to_ts_ms: START_MS + 5000 + periodUs / 2500,
        });
        const begin = 2_000_000 + periodUs;
        expect(windowPassed()).toEqual([begin, 5_000_000]);
        expect(result).toMatchObject({
            from_ts_ms: START_MS + begin / 1000,
            to_ts_ms: START_MS + 5000,
            session_start_ts_ms: START_MS,
        });
    });

    it('selects the window in the chart', async () => {
        await run({ last_s: 2.5 });
        expect(selection(store.getState())).toEqual({
            begin: windowPassed()[0],
            end: lastUs,
        });
    });

    it('takes the last seconds', async () => {
        await run({ last_s: 2.5 });
        expect(windowPassed()).toEqual([
            Math.ceil((lastUs - 2_500_000) / periodUs) * periodUs,
            lastUs,
        ]);
    });

    it('clips the window to the data', async () => {
        await run({ from_ts_ms: START_MS - 5000, to_ts_ms: START_MS + 1e9 });
        expect(windowPassed()).toEqual([0, lastUs]);
    });

    it('answers no_data for a window before the data', async () => {
        expect(
            await run({ from_ts_ms: START_MS - 5000, to_ts_ms: START_MS - 1 }),
        ).toMatchObject({ error: 'no_data' });
        expect(calcStatsMock).not.toHaveBeenCalled();
    });

    it('answers no_data for a window after the data', async () => {
        const end = START_MS + lastUs / 1000;
        expect(
            await run({ from_ts_ms: end + 1, to_ts_ms: end + 5000 }),
        ).toMatchObject({ error: 'no_data' });
        expect(calcStatsMock).not.toHaveBeenCalled();
    });

    it('takes one sample for from == to on a sample', async () => {
        const onSample = START_MS + 3000;
        await run({ from_ts_ms: onSample, to_ts_ms: onSample });
        expect(windowPassed()).toEqual([3_000_000, 3_000_000]);
    });

    it('answers no_data for from == to between samples', async () => {
        const between = START_MS + 3000 + periodUs / 2000;
        expect(
            await run({ from_ts_ms: between, to_ts_ms: between }),
        ).toMatchObject({ error: 'no_data' });
    });
});

describe('stats', () => {
    beforeEach(() => {
        DataManager().setSamplesPerSecond(1000);
        recordData({ lastUs: 9_999_000 });
    });

    it('answers in fixed units', async () => {
        expect(await run({ last_s: 2 })).toEqual({
            status: 'ok',
            avg_uA: 100,
            max_uA: 250,
            charge_uC: 200,
            charge_uAh: 200 / 3600,
            duration_ms: 2000,
            from_ts_ms: START_MS + 7999,
            to_ts_ms: START_MS + 9999,
            session_start_ts_ms: START_MS,
        });
    });

    it.each([
        ['no window', {}],
        [
            'last_s with a range',
            { last_s: 1, from_ts_ms: START_MS, to_ts_ms: START_MS + 1 },
        ],
        ['only from_ts_ms', { from_ts_ms: START_MS }],
        ['only to_ts_ms', { to_ts_ms: START_MS }],
        ['from after to', { from_ts_ms: START_MS + 2, to_ts_ms: START_MS + 1 }],
    ])('answers invalid_argument for %s', async (_, args) => {
        expect(await run(args)).toMatchObject({ error: 'invalid_argument' });
    });

    it('answers no_data without data', async () => {
        fakeData.bytes = 0;
        expect(await run({ last_s: 2 })).toMatchObject({ error: 'no_data' });
        expect(calcStatsMock).not.toHaveBeenCalled();
    });

    it('takes only last_s for data without a start time', async () => {
        recordData({ startMs: null, lastUs: 9_999_000 });
        expect(
            await run({ from_ts_ms: START_MS, to_ts_ms: START_MS + 1 }),
        ).toMatchObject({ error: 'invalid_argument' });
        expect(await run({ last_s: 2 })).toMatchObject({
            status: 'ok',
            from_ts_ms: null,
            to_ts_ms: null,
            session_start_ts_ms: null,
        });
    });

    it('answers data_changed when the data change meanwhile', async () => {
        calcStatsMock.mockImplementation((onComplete: OnComplete) => {
            fakeData.folder = '/sessions/new';
            onComplete(1, 1, 1);
        });
        expect(await run({ last_s: 2 })).toMatchObject({
            error: 'data_changed',
        });
        expect(selection(store.getState())).toEqual({
            begin: null,
            end: null,
        });
    });

    it('times out, aborts calcStats and frees the queue at once', async () => {
        jest.useFakeTimers();
        openPpk(store);
        calcStatsMock.mockImplementation(() => {}); // never completes
        const answer = run({ last_s: 2 });
        // Queued 20 s in: it waits at most 15 s, and runs when stats times out.
        await jest.advanceTimersByTimeAsync(20_000);
        const queued = runOperation(power, { on: true }, contextFor(store));
        let powered = false;
        queued.then(() => {
            powered = true;
        });

        await jest.advanceTimersByTimeAsync(9_999);
        expect(powered).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
        expect(await answer).toMatchObject({ error: 'timeout' });
        expect(
            (calcStatsMock.mock.calls[0][3] as AbortController).signal.aborted,
        ).toBe(true);
        expect(await queued).toMatchObject({ status: 'ok', output_on: true });
    });
});
