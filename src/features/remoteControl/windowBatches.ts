/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import {
    DataManager,
    type FileData,
    frameSize,
    indexToTimestamp,
    timestampToIndex,
} from '../../globals';
import { abortable } from './abortable';
import { dataChanged, dataIdentity } from './dataSnapshot';
import { type OperationError } from './operation';
import { type SampleWindow } from './timeWindow';

export const SAMPLES_PER_BATCH = 100_000;
// Work this long at most before the UI gets a turn.
const SLICE_MS = 12;

const nextTask = () =>
    new Promise(resolve => {
        setTimeout(resolve);
    });

// Reads the window in batches of SAMPLES_PER_BATCH samples and passes each
// with the index of its first sample to `onBatch`, which may be async.
// Answers data_changed (`during`, e.g. 'during the export') when the data
// change meanwhile, otherwise undefined; rejects on the abort of `signal`
// (the answer is `timeout` already).
export const forEachBatch = async (
    window: SampleWindow,
    signal: AbortSignal,
    during: string,
    onBatch: (start: number, data: FileData) => unknown,
): Promise<OperationError | undefined> => {
    const identity = dataIdentity();
    const buffer = Buffer.alloc(SAMPLES_PER_BATCH * frameSize);
    const first = timestampToIndex(window.beginUs);
    const last = timestampToIndex(window.endUs);
    let sliceStart = performance.now();
    for (let start = first; start <= last; start += SAMPLES_PER_BATCH) {
        const end = Math.min(last, start + SAMPLES_PER_BATCH - 1);
        // eslint-disable-next-line no-await-in-loop
        const data = await abortable(
            DataManager().getData(
                buffer,
                indexToTimestamp(start),
                indexToTimestamp(end),
                'end',
            ),
            signal,
        );
        const changed = dataChanged(identity, during);
        if (changed) return changed;
        // eslint-disable-next-line no-await-in-loop
        await onBatch(start, data);
        if (performance.now() - sliceStart >= SLICE_MS) {
            // eslint-disable-next-line no-await-in-loop
            await nextTask();
            sliceStart = performance.now();
        }
    }
    return undefined;
};
