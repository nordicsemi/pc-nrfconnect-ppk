/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { type RootState } from '../../slices';
import { dataLoggerState } from '../../slices/dataLoggerSlice';
import { convertTimeToSeconds } from '../../utils/duration';
import { type TimeUnit } from '../../utils/persistentStore';

// The "Sample for" setting: null for unlimited.
export const durationSeconds = (state: RootState) => {
    const { duration, durationUnit } = dataLoggerState(state);
    const seconds = convertTimeToSeconds(duration, durationUnit);
    return Number.isFinite(seconds) ? seconds : null;
};

// The largest unit that gives a whole value within the UI's range 1..3600.
const UNITS: readonly [Exclude<TimeUnit, 'inf'>, number][] = [
    ['d', 24 * 60 * 60],
    ['h', 60 * 60],
    ['m', 60],
    ['s', 1],
];
export const toUiDuration = (seconds: number) =>
    UNITS.filter(
        ([, size]) => seconds % size === 0 && seconds / size <= 3600,
    ).map(([unit, size]) => ({ unit, value: seconds / size }))[0];
