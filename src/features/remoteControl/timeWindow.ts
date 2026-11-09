/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { type AppDispatch } from '@nordicsemiconductor/pc-nrfconnect-shared';
import { z } from 'zod';

import {
    DataManager,
    normalizeTimeCeil,
    normalizeTimeFloor,
    timestampToIndex,
} from '../../globals';
import { chartCursorAction } from '../../slices/chartSlice';
import { hasData, sessionStartMs } from './dataSnapshot';
import { type OperationError, operationError } from './operation';

// The time window of `stats`, `trace` and `export_csv`: either the last seconds of
// the data, or a range in host epoch ms.
export const windowInput = {
    last_s: z.number().positive().optional(),
    from_ts_ms: z.number().optional(),
    to_ts_ms: z.number().optional(),
};

export const WINDOW_DESCRIPTION =
    'The window is required: either last_s (the last seconds of the data) or both from_ts_ms and to_ts_ms (host epoch ms). ' +
    'It is clipped to the available data and the answer gives the actual range, rounded to whole samples. ' +
    'Timestamps are host epoch ms derived from the PC clock at the first sample: approximate, off by up to tens of ms plus one sample period.';

export const SELECTION_DESCRIPTION =
    'The window becomes the selection in the chart of the app, replacing the one there.';

export type WindowArgs = z.infer<z.ZodObject<typeof windowInput>>;

// In µs since the session start, on sample boundaries; begin <= end.
export interface SampleWindow {
    beginUs: number;
    endUs: number;
    // Epoch ms of the session start; undefined for data without it.
    startMs: number | undefined;
}

export const toEpochMs = (startMs: number | undefined, us: number) =>
    startMs === undefined ? null : startMs + us / 1000;

export const windowSamples = ({ beginUs, endUs }: SampleWindow) =>
    timestampToIndex(endUs) - timestampToIndex(beginUs) + 1;

export const epochRange = (window: SampleWindow) => ({
    from_ts_ms: toEpochMs(window.startMs, window.beginUs),
    to_ts_ms: toEpochMs(window.startMs, window.endUs),
    session_start_ts_ms: window.startMs ?? null,
});

// Shows the window as the chart's selection, so that the window
// statistics below the chart are those of the window; the chart view stays.
export const selectWindow = (dispatch: AppDispatch, window: SampleWindow) =>
    dispatch(
        chartCursorAction({
            cursorBegin: window.beginUs,
            cursorEnd: window.endUs,
        }),
    );

const noData = (message: string) => operationError('no_data', message);

export const resolveWindow = ({
    last_s: lastS,
    from_ts_ms: fromMs,
    to_ts_ms: toMs,
}: WindowArgs): SampleWindow | OperationError => {
    const range = fromMs !== undefined || toMs !== undefined;
    if (
        (lastS !== undefined) === range ||
        (fromMs === undefined) !== (toMs === undefined)
    ) {
        return operationError(
            'invalid_argument',
            'Give either last_s or both from_ts_ms and to_ts_ms',
        );
    }
    if (!hasData()) return noData('There are no data');

    const startMs = sessionStartMs(true);
    const lastUs = DataManager().getTimestamp();
    let beginUs: number;
    let endUs: number;
    if (lastS !== undefined) {
        endUs = lastUs;
        beginUs = lastUs - lastS * 1e6;
    } else {
        if (startMs === undefined) {
            return operationError(
                'invalid_argument',
                'The data have no start time (an old file); use last_s',
            );
        }
        if ((fromMs as number) > (toMs as number)) {
            return operationError(
                'invalid_argument',
                'from_ts_ms is after to_ts_ms',
            );
        }
        beginUs = ((fromMs as number) - startMs) * 1000;
        endUs = ((toMs as number) - startMs) * 1000;
    }
    if (endUs < 0) return noData('The window ends before the data start');

    beginUs = normalizeTimeCeil(Math.max(beginUs, 0));
    endUs = Math.min(normalizeTimeFloor(endUs), lastUs);
    if (beginUs > endUs) return noData('There is no sample in the window');
    return { beginUs, endUs, startMs };
};
