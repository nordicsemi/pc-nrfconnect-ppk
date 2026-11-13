/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { type AverageLine } from '../data/dataAccumulator';
import { type AmpereState } from '../data/dataTypes';

export type TraceValue =
    | { value: number; time: number }
    | {
          min: number;
          max: number;
          avg?: number;
          first: number;
          last?: number;
          count?: number;
      };

type Point = { x: number; y: AmpereState['y']; index: number };

const isNumber = (v: unknown): v is number =>
    typeof v === 'number' && !Number.isNaN(v);

const pointAt = (data: AmpereState[], index: number): Point | undefined => {
    const p = data[index];
    return p != null && isNumber(p.x) ? { x: p.x, y: p.y, index } : undefined;
};

// Points are sorted by x. When the data is downsampled each group is
// represented by a min and a max point sharing the same x.
const isGroupPair = (data: AmpereState[], point: Point) =>
    pointAt(data, point.index - 1)?.x === point.x ||
    pointAt(data, point.index + 1)?.x === point.x;

const findSurroundingPoints = (data: AmpereState[], t: number) => {
    let previous: Point | undefined;
    let next: Point | undefined;
    for (let i = 0; i < data.length; i += 1) {
        const p = pointAt(data, i);
        if (p != null) {
            if (p.x > t) {
                next = p;
                break;
            }
            previous = p;
        }
    }
    return { previous, next };
};

const findStep = (data: AmpereState[], point: Point) => {
    for (let i = point.index - 1; i >= 0; i -= 1) {
        const p = pointAt(data, i);
        if (p != null && p.x !== point.x) return point.x - p.x;
    }
    for (let i = point.index + 1; i < data.length; i += 1) {
        const p = pointAt(data, i);
        if (p != null && p.x !== point.x) return p.x - point.x;
    }
    return 0;
};

const groupValue = (
    data: AmpereState[],
    averageLine: AverageLine[],
    groupX: number,
    lastIndexInGroup: number,
    step: number,
    samplePeriod: number,
    isLastGroup: boolean,
): TraceValue | null => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = lastIndexInGroup; i >= 0; i -= 1) {
        const p = pointAt(data, i);
        if (p == null || p.x !== groupX) break;
        if (isNumber(p.y)) {
            min = Math.min(min, p.y);
            max = Math.max(max, p.y);
        }
    }
    if (min > max) return null;

    const average = averageLine.find(a => a != null && a.x === groupX);
    const avg =
        average != null && average.count > 0
            ? average.y / average.count
            : undefined;

    // The group covers [groupX, groupX + step), so its last sample is one
    // sample period before the next group starts. The last group may only be
    // partly filled, so count its samples instead.
    const count = average?.count;
    let last: number | undefined;
    if (isLastGroup && count != null && count > 0) {
        last = groupX + (count - 1) * samplePeriod;
    } else if (step > 0) {
        last = groupX + step - samplePeriod;
    }

    return {
        min,
        max,
        avg,
        first: groupX,
        last: last != null ? Math.max(groupX, last) : undefined,
        count,
    };
};

// Returns the current (in nA) of the plotted trace at time t (in µs).
// For raw samples this is the value of the sample closest in time, for
// downsampled data the min, max and average of the group containing t,
// together with the timestamps of the first and last sample in the group.
// samplePeriod is the time between two samples (in µs).
export const getTraceValueAt = (
    t: number,
    data: AmpereState[],
    averageLine: AverageLine[],
    samplePeriod: number,
): TraceValue | null => {
    if (!isNumber(t)) return null;

    const { previous, next } = findSurroundingPoints(data, t);
    const reference = previous ?? next;
    if (reference == null) return null;

    const step = findStep(data, reference);

    if (isGroupPair(data, reference)) {
        if (previous == null) return null;
        if (next == null && step > 0 && t >= previous.x + step) return null;
        return groupValue(
            data,
            averageLine,
            previous.x,
            previous.index,
            step,
            samplePeriod,
            next == null,
        );
    }

    let nearest: Point;
    if (previous == null) nearest = next as Point;
    else if (next == null) nearest = previous;
    else nearest = t - previous.x <= next.x - t ? previous : next;

    if (step > 0 && Math.abs(nearest.x - t) > step) return null;

    return isNumber(nearest.y) ? { value: nearest.y, time: nearest.x } : null;
};

// Moves the given positions (sorted ascending) apart so neighbours are at
// least gap apart, keeping all of them within [min, max] when possible.
export const spreadPositions = (
    positions: number[],
    gap: number,
    min: number,
    max: number,
) => {
    const result = positions.map(p => Math.min(max, Math.max(min, p)));
    for (let i = 1; i < result.length; i += 1) {
        result[i] = Math.max(result[i], result[i - 1] + gap);
    }
    if (result.length > 0) {
        result[result.length - 1] = Math.min(result[result.length - 1], max);
    }
    for (let i = result.length - 2; i >= 0; i -= 1) {
        result[i] = Math.min(result[i], result[i + 1] - gap);
    }
    return result;
};
