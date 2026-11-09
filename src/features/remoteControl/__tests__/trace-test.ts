/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import '../__testUtils__/operationMocks';

import { DataManager } from '../../../globals';
import { toggleDigitalChannels } from '../../../slices/chartSlice';
import {
    contextFor,
    createTestStore,
    fakeData,
    recordData,
    resetFakeData,
    START_MS,
    type TestStore,
} from '../__testUtils__/fakeApp';
import {
    enableDigitalChannels,
    pins,
    pinsDuring,
    samplesAre,
    selection,
} from '../__testUtils__/fakeSamples';
import { runOperation } from '../operation';
import trace from '../operations/trace';

let store: TestStore;
const run = (args: unknown) =>
    runOperation(trace, args, contextFor(store)) as Promise<
        Record<string, unknown>
    >;

// The epoch ms of sample `index`, as the operations compute it.
const epochOf = (index: number, rate: number) =>
    START_MS + (1e6 * index) / rate / 1000;
// A window of the samples first..last, its ends a quarter sample outside:
// epoch ms near 1.7e12 have a resolution of 0.25 µs.
const samples = (first: number, last: number, rate: number) => ({
    from_ts_ms: epochOf(first - 0.25, rate),
    to_ts_ms: epochOf(last + 0.25, rate),
});

beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    resetFakeData();
    store = createTestStore();
    enableDigitalChannels(store, 0);
});

describe.each([1, 1000, 100_000])('trace at %d Hz', rate => {
    beforeEach(() => {
        DataManager().setSamplesPerSecond(rate);
        recordData({ lastUs: 99e6 / rate }); // 100 samples
        samplesAre(index => [index]);
    });

    it('splits the window into equal buckets', async () => {
        // 10 samples into 4 buckets of 2.5 samples: 3, 2, 3, 2 samples.
        expect(await run({ ...samples(20, 29, rate), points: 4 })).toEqual({
            status: 'ok',
            t0_ms: epochOf(20, rate),
            dt_ms: (10 * 1000) / rate / 4,
            points: 4,
            avg_uA: [21, 23.5, 26, 28.5],
            min_uA: [20, 23, 25, 28],
            max_uA: [22, 24, 27, 29],
            from_ts_ms: epochOf(20, rate),
            to_ts_ms: epochOf(29, rate),
            session_start_ts_ms: START_MS,
        });
    });

    it('gives one bucket per sample for fewer samples than points', async () => {
        expect(await run({ ...samples(5, 7, rate), points: 10 })).toMatchObject(
            {
                dt_ms: (3 * 1000) / rate / 3,
                points: 3,
                avg_uA: [5, 6, 7],
                min_uA: [5, 6, 7],
                max_uA: [5, 6, 7],
            },
        );
    });

    it('takes the last seconds', async () => {
        expect(await run({ last_s: 10.25 / rate, points: 1 })).toMatchObject({
            t0_ms: epochOf(89, rate),
            points: 1,
            min_uA: [89],
            max_uA: [99],
        });
    });

    it('selects the window in the chart', async () => {
        await run({ ...samples(20, 29, rate), points: 4 });
        expect(selection(store.getState())).toEqual({
            begin: 20e6 / rate,
            end: 29e6 / rate,
        });
    });
});

describe('trace', () => {
    beforeEach(() => {
        DataManager().setSamplesPerSecond(1000);
        recordData({ lastUs: 999_999_000 }); // 1000 s at 1 kHz
        samplesAre(index => [index]);
    });

    it('reads in batches of 100000 samples, across which the buckets go on', async () => {
        // 5 buckets of exactly 50000 samples: 0 at a bucket's first sample,
        // 20 at its last, 10 in between, plus 100 per bucket.
        samplesAre(index => {
            const inBucket = index % 50_000;
            const edges: Record<number, number> = { 0: 0, 49_999: 20 };
            const edge = edges[inBucket] ?? 10;
            return [100 * Math.floor(index / 50_000) + edge];
        });
        expect(
            await run({ ...samples(0, 249_999, 1000), points: 5 }),
        ).toMatchObject({
            dt_ms: 50_000,
            avg_uA: [10, 110, 210, 310, 410],
            min_uA: [0, 100, 200, 300, 400],
            max_uA: [20, 120, 220, 320, 420],
        });
        expect(
            fakeData.getData.mock.calls.map(([, from, to]) => [from, to]),
        ).toEqual([
            [0, 99_999_000],
            [100_000_000, 199_999_000],
            [200_000_000, 249_999_000],
        ]);
    });

    it('rounds to 3 significant digits', async () => {
        const values = [1234.5678, 0.00123456, -98.765, 0, 3.4e38, 1.005];
        samplesAre(index => [values[index]]);
        recordData({ lastUs: 5000 });
        expect(await run({ ...samples(0, 5, 1000), points: 6 })).toMatchObject({
            avg_uA: [1230, 0.00123, -98.8, 0, 3.4e38, 1],
        });
        samplesAre(index => [[1, 2, 2][index]]);
        expect(await run({ ...samples(0, 2, 1000), points: 1 })).toMatchObject({
            avg_uA: [1.67],
            min_uA: [1],
            max_uA: [2],
        });
    });

    it('skips samples without a value and answers null for an empty bucket', async () => {
        const values = [1, NaN, 3, NaN, NaN, NaN, 5, NaN];
        samplesAre(index => [values[index]]);
        expect(await run({ ...samples(0, 7, 1000), points: 4 })).toMatchObject({
            points: 4,
            avg_uA: [1, 3, null, 5],
            min_uA: [1, 3, null, 5],
            max_uA: [1, 3, null, 5],
        });
    });

    it.each([
        [0, 'invalid_argument'],
        [1.5, 'invalid_argument'],
        [10_001, 'out_of_range'],
    ])('answers %d points with %s', async (points, error) => {
        expect(await run({ last_s: 1, points })).toMatchObject({ error });
        expect(fakeData.getData).not.toHaveBeenCalled();
    });

    it('gives the limit with out_of_range and takes 10000 points', async () => {
        expect(await run({ last_s: 1, points: 10_001 })).toMatchObject({
            error: 'out_of_range',
            max_points: 10_000,
        });
        expect(await run({ last_s: 20, points: 10_000 })).toMatchObject({
            status: 'ok',
            points: 10_000,
        });
    });

    it('requires points', async () => {
        expect(await run({ last_s: 1 })).toMatchObject({
            error: 'invalid_argument',
        });
    });

    it('answers like stats for a window without data', async () => {
        expect(
            await run({
                from_ts_ms: START_MS - 5000,
                to_ts_ms: START_MS - 1,
                points: 1,
            }),
        ).toMatchObject({ error: 'no_data' });
        expect(await run({ points: 1 })).toMatchObject({
            error: 'invalid_argument',
        });
    });

    it('answers data_changed when the data change meanwhile', async () => {
        samplesAre(index => {
            fakeData.folder = '/sessions/new';
            return [index];
        });
        expect(await run({ last_s: 1, points: 1 })).toMatchObject({
            error: 'data_changed',
        });
        expect(selection(store.getState())).toEqual({
            begin: null,
            end: null,
        });
    });

    it('times out after 30 s on a hung read', async () => {
        jest.useFakeTimers();
        fakeData.getData.mockImplementation(() => new Promise(() => {}));
        const answer = run({ last_s: 500, points: 10 });
        await jest.advanceTimersByTimeAsync(29_999);
        expect(fakeData.getData).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(await answer).toMatchObject({ error: 'timeout' });
    });

    it('stops reading at the timeout', async () => {
        jest.useFakeTimers();
        // 6 batches of 7 s each: the 5th starts at 28 s, the 6th would at 35 s.
        const read = fakeData.getData.getMockImplementation() as jest.Mock;
        fakeData.getData.mockImplementation(
            (...args: unknown[]) =>
                new Promise(resolve => {
                    setTimeout(() => resolve(read(...args)), 7000);
                }),
        );
        const answer = run({ last_s: 500, points: 10 });
        await jest.advanceTimersByTimeAsync(30_000);
        expect(await answer).toMatchObject({ error: 'timeout' });
        expect(fakeData.getData).toHaveBeenCalledTimes(5);
        await jest.advanceTimersByTimeAsync(20_000);
        expect(fakeData.getData).toHaveBeenCalledTimes(5);
        expect(selection(store.getState())).toEqual({
            begin: null,
            end: null,
        });
    });

    it('has no digital fields without an enabled channel', async () => {
        const result = await run({ last_s: 1, points: 2 });
        expect(
            Object.keys(result).filter(key => /digital|trunc/.test(key)),
        ).toEqual([]);
    });

    it('has no digital fields with the digital channels hidden', async () => {
        enableDigitalChannels(store, 0xff);
        store.dispatch(toggleDigitalChannels());
        expect(store.getState().app.chart.digitalChannelsVisible).toBe(false);
        expect(await run({ last_s: 1, points: 2 })).not.toHaveProperty(
            'digital_mask',
        );
    });
});

describe('trace of the digital channels', () => {
    beforeEach(() => {
        DataManager().setSamplesPerSecond(100_000);
        recordData({ lastUs: 99_990 }); // 10000 samples at 100 kHz
    });

    it('gives the state at the first sample of each bucket and the changes', async () => {
        enableDigitalChannels(store, 0b0000_0111);
        // D0 high from sample 3, D1 high at 5..6, D7 (disabled) always
        // high, D2 toggling within sample 8 (X).
        const bytes = [0x80, 0x80, 0x80, 0x81, 0x81, 0x83, 0x83, 0x81];
        samplesAre(index => {
            if (index === 8) return [0, pinsDuring(0x81, 0x85)];
            return [0, pins(bytes[index] ?? 0x81)];
        });
        expect(
            await run({ ...samples(0, 9, 100_000), points: 5 }),
        ).toMatchObject({
            digital_mask: '0x07',
            digital: ['0x00', '0x00', '0x01', '0x03', '0x05'],
            digital_changes: [
                [0.03, '0x01'],
                [0.05, '0x03'],
                [0.07, '0x01'],
                [0.08, '0x05'],
                [0.09, '0x01'],
            ],
        });
    });

    it('does not report the state at the window start as a change', async () => {
        enableDigitalChannels(store, 0x01);
        samplesAre(index => [0, pins(index < 50 ? 0x01 : 0)]);
        const result = await run({ ...samples(10, 59, 100_000), points: 1 });
        expect(result).toMatchObject({
            digital: ['0x01'],
            digital_changes: [[0.4, '0x00']],
        });
        expect(result).not.toHaveProperty('truncated');
    });

    it('ignores changes of disabled channels', async () => {
        enableDigitalChannels(store, 0x02);
        samplesAre(index => [0, pins(index % 2 ? 0xfd : 0)]);
        expect(
            await run({ ...samples(0, 99, 100_000), points: 2 }),
        ).toMatchObject({
            digital_mask: '0x02',
            digital: ['0x00', '0x00'],
            digital_changes: [],
        });
    });

    it('takes the state of the first sample with a value', async () => {
        enableDigitalChannels(store, 0x01);
        samplesAre(index => [index < 3 ? NaN : 1, pins(index < 3 ? 0x01 : 0)]);
        expect(
            await run({ ...samples(0, 9, 100_000), points: 2 }),
        ).toMatchObject({
            digital: ['0x00', '0x00'],
            digital_changes: [],
        });
        samplesAre(index => [index < 5 ? NaN : 1, pins(0x01)]);
        expect(
            await run({ ...samples(0, 9, 100_000), points: 2 }),
        ).toMatchObject({
            avg_uA: [null, 1],
            digital: [null, '0x01'],
        });
    });

    it('lists at most 1000 changes', async () => {
        enableDigitalChannels(store, 0x01);
        samplesAre(index => [0, pins(index % 2)]);
        const result = await run({ ...samples(0, 1099, 100_000), points: 1 });
        const changes = result.digital_changes as [number, string][];
        expect(changes).toHaveLength(1000);
        expect(changes[0]).toEqual([0.01, '0x01']);
        expect(changes[999]).toEqual([10, '0x00']);
        expect(result).toMatchObject({
            truncated: true,
            truncated_at_ms: 10.01,
        });
    });

    it('does not truncate exactly 1000 changes', async () => {
        enableDigitalChannels(store, 0x01);
        samplesAre(index => [0, pins(index % 2)]);
        const result = await run({ ...samples(0, 1000, 100_000), points: 1 });
        expect(result.digital_changes).toHaveLength(1000);
        expect(result).not.toHaveProperty('truncated');
        expect(result).not.toHaveProperty('truncated_at_ms');
    });
});
