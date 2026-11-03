/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { z } from 'zod';

import { getSamplesPerSecond, timestampToIndex } from '../../../globals';
import { digitalByte, enabledDigitalMask, hexByte } from '../digital';
import { defineOperation, operationError } from '../operation';
import {
    epochRange,
    resolveWindow,
    SELECTION_DESCRIPTION,
    selectWindow,
    toEpochMs,
    WINDOW_DESCRIPTION,
    windowInput,
    windowSamples,
} from '../timeWindow';
import { forEachBatch } from '../windowBatches';

export const MAX_TRACE_POINTS = 10_000;
export const MAX_DIGITAL_CHANGES = 1000;

// Three significant digits: a trace is for looking at, the CSV export has
// the full precision.
const round3 = (value: number) => Number(value.toPrecision(3));

// The window split into `points` buckets of equal width: sample `offset`
// (from the window start) of `total` falls into bucket
// floor(offset * points / total). The samples come in order; those without
// a value (NaN) are left out. `mask`: the enabled digital channels, 0 for
// none.
class Trace {
    readonly sum: Float64Array;
    readonly count: Float64Array;
    readonly min: Float64Array;
    readonly max: Float64Array;
    // The digital byte of a bucket's first sample.
    readonly firstByte: (number | null)[];
    readonly changes: [number, string][] = [];
    truncatedAtMs: number | undefined;
    #bucket = 0;
    #nextBucketStart: number;
    #previousBits: number | null = null;
    #previousByte: number | null = null;

    constructor(
        readonly points: number,
        readonly total: number,
        readonly mask: number,
        readonly samplesPerSecond: number,
    ) {
        this.sum = new Float64Array(points);
        this.count = new Float64Array(points);
        this.min = new Float64Array(points).fill(Infinity);
        this.max = new Float64Array(points).fill(-Infinity);
        this.firstByte = new Array(points).fill(null);
        this.#nextBucketStart = this.#bucketStart(1);
    }

    // The offset of the first sample of `bucket`.
    #bucketStart(bucket: number) {
        return Math.ceil((bucket * this.total) / this.points);
    }

    add(offset: number, value: number, bits: number) {
        if (Number.isNaN(value)) return;
        while (offset >= this.#nextBucketStart) {
            this.#bucket += 1;
            this.#nextBucketStart = this.#bucketStart(this.#bucket + 1);
        }
        const bucket = this.#bucket;
        this.sum[bucket] += value;
        this.count[bucket] += 1;
        if (value < this.min[bucket]) this.min[bucket] = value;
        if (value > this.max[bucket]) this.max[bucket] = value;
        if (this.mask !== 0) this.#addDigital(bucket, offset, bits);
    }

    #addDigital(bucket: number, offset: number, bits: number) {
        const previous = this.#previousByte;
        const byte =
            previous !== null && bits === this.#previousBits
                ? previous
                : digitalByte(bits, this.mask);
        this.#previousBits = bits;
        this.#previousByte = byte;
        this.firstByte[bucket] ??= byte;
        if (previous === null || byte === previous) return;
        const ms = (offset * 1000) / this.samplesPerSecond;
        if (this.changes.length < MAX_DIGITAL_CHANGES) {
            this.changes.push([ms, hexByte(byte)]);
        } else {
            this.truncatedAtMs ??= ms;
        }
    }

    // The columns of the answer.
    columns() {
        const perBucket = (value: (bucket: number) => number) =>
            Array.from(this.count, (count, bucket) =>
                count > 0 ? round3(value(bucket)) : null,
            );
        return {
            avg_uA: perBucket(bucket => this.sum[bucket] / this.count[bucket]),
            min_uA: perBucket(bucket => this.min[bucket]),
            max_uA: perBucket(bucket => this.max[bucket]),
            ...(this.mask !== 0 && {
                digital_mask: hexByte(this.mask),
                digital: this.firstByte.map(byte =>
                    byte === null ? null : hexByte(byte),
                ),
                digital_changes: this.changes,
                ...(this.truncatedAtMs !== undefined && {
                    truncated: true,
                    truncated_at_ms: this.truncatedAtMs,
                }),
            }),
        };
    }
}

export default defineOperation({
    name: 'trace',
    description:
        'The current over a window of the recorded data as a time series of `points` equal buckets (1..10000), to see the shape of the current without exporting a CSV. ' +
        'Columnar: bucket i starts at t0_ms + i * dt_ms (host epoch ms; dt_ms may be fractional) and avg_uA[i], min_uA[i], max_uA[i] are its average, minimum and maximum in uA, rounded to 3 significant digits (export_csv has the full precision), null for a bucket without samples. ' +
        'A window with fewer samples than points gives one bucket per sample: `points` in the answer is the actual count. ' +
        'With digital channels enabled in the app (Display options): digital_mask is the enabled channels, digital[i] the state at the first sample of bucket i, and digital_changes lists [ms after t0_ms, state] for every change of the enabled channels within the window (the state at the window start is digital[0], not a change). ' +
        `States are "0xNN" with bit i = Di; disabled channels are 0, a channel toggling within one sample counts as 1. At most ${MAX_DIGITAL_CHANGES} changes: then truncated is true and truncated_at_ms is the time of the first change left out. ` +
        'The digital fields are absent when no channel is enabled. ' +
        `${WINDOW_DESCRIPTION} ${SELECTION_DESCRIPTION} ` +
        'Long windows at high sample rates take seconds; the call times out after 30 s. Works without a PPK on the data shown in the app.',
    annotation: 'read',
    input: { ...windowInput, points: z.number().int().min(1) },
    rest: { method: 'GET', path: '/api/trace' },
    timeoutMs: 30_000,
    handler: async (
        { points, ...windowArgs },
        { signal, getState, dispatch },
    ) => {
        if (points > MAX_TRACE_POINTS) {
            return operationError(
                'out_of_range',
                `points must be at most ${MAX_TRACE_POINTS}`,
                { max_points: MAX_TRACE_POINTS },
            );
        }
        const window = resolveWindow(windowArgs);
        if ('status' in window) return window;

        const total = windowSamples(window);
        const samplesPerSecond = getSamplesPerSecond();
        const trace = new Trace(
            Math.min(points, total),
            total,
            enabledDigitalMask(getState()),
            samplesPerSecond,
        );
        const first = timestampToIndex(window.beginUs);
        const changed = await forEachBatch(
            window,
            signal,
            'while computing the trace',
            (start, data) => {
                const length = data.getLength();
                for (let n = 0; n < length; n += 1) {
                    trace.add(
                        start - first + n,
                        data.getCurrentData(n),
                        trace.mask !== 0 ? data.getBitData(n) : 0,
                    );
                }
            },
        );
        if (changed) return changed;
        selectWindow(dispatch, window);
        return {
            status: 'ok',
            t0_ms: toEpochMs(window.startMs, window.beginUs),
            dt_ms: (total * 1000) / samplesPerSecond / trace.points,
            points: trace.points,
            ...trace.columns(),
            ...epochRange(window),
        };
    },
});
