/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { getTraceValueAt, spreadPositions } from '../traceValue';

describe('getTraceValueAt', () => {
    describe('with raw samples', () => {
        const data = [
            { x: 0, y: 100 },
            { x: 10, y: 200 },
            { x: 20, y: null },
            { x: 30, y: 400 },
        ];

        it('returns the sample value at its exact timestamp', () => {
            expect(getTraceValueAt(10, data, [], 10)).toEqual({
                value: 200,
                time: 10,
            });
        });

        it('returns the value of the closest sample', () => {
            expect(getTraceValueAt(4, data, [], 10)).toEqual({
                value: 100,
                time: 0,
            });
            expect(getTraceValueAt(6, data, [], 10)).toEqual({
                value: 200,
                time: 10,
            });
        });

        it('returns null for samples without a value', () => {
            expect(getTraceValueAt(20, data, [], 10)).toBeNull();
        });

        it('returns null when far outside the data', () => {
            expect(getTraceValueAt(-50, data, [], 10)).toBeNull();
            expect(getTraceValueAt(100, data, [], 10)).toBeNull();
        });

        it('returns the edge samples just outside the data', () => {
            expect(getTraceValueAt(-2, data, [], 10)).toEqual({
                value: 100,
                time: 0,
            });
            expect(getTraceValueAt(33, data, [], 10)).toEqual({
                value: 400,
                time: 30,
            });
        });
    });

    describe('with downsampled data', () => {
        const data = [
            { x: 0, y: 50 },
            { x: 0, y: 150 },
            { x: 100, y: 10 },
            { x: 100, y: 900 },
            { x: 200, y: undefined },
            { x: 200, y: undefined },
        ];
        const averageLine = [
            { x: 0, y: 1000, count: 10 },
            { x: 100, y: 3000, count: 10 },
            { x: 200, y: 0, count: 0 },
        ];

        it('returns min, max and average of the group containing t', () => {
            expect(getTraceValueAt(0, data, averageLine, 10)).toEqual({
                min: 50,
                max: 150,
                avg: 100,
                first: 0,
                last: 90,
                count: 10,
            });
            expect(getTraceValueAt(199, data, averageLine, 10)).toEqual({
                min: 10,
                max: 900,
                avg: 300,
                first: 100,
                last: 190,
                count: 10,
            });
        });

        it('returns min and max without average when missing', () => {
            expect(getTraceValueAt(150, data, [], 10)).toEqual({
                min: 10,
                max: 900,
                avg: undefined,
                first: 100,
                last: 190,
                count: undefined,
            });
        });

        it('returns null for groups without samples', () => {
            expect(getTraceValueAt(250, data, averageLine, 10)).toBeNull();
        });

        it('returns null outside the data', () => {
            expect(getTraceValueAt(-1, data, averageLine, 10)).toBeNull();
            expect(getTraceValueAt(300, data, averageLine, 10)).toBeNull();
        });
    });

    describe('with two samples per group at 10 kS/s', () => {
        const data = [
            { x: 0, y: 1 },
            { x: 0, y: 2 },
            { x: 200, y: 3 },
            { x: 200, y: 4 },
            { x: 400, y: 5 },
            { x: 400, y: 6 },
        ];
        const averageLine = [
            { x: 0, y: 3, count: 2 },
            { x: 200, y: 7, count: 2 },
            { x: 400, y: 5, count: 1 },
        ];

        it('ends the range at the last sample in the group', () => {
            expect(getTraceValueAt(250, data, averageLine, 100)).toEqual({
                min: 3,
                max: 4,
                avg: 3.5,
                first: 200,
                last: 300,
                count: 2,
            });
        });

        it('uses the sample count for a partly filled last group', () => {
            expect(getTraceValueAt(450, data, averageLine, 100)).toEqual({
                min: 5,
                max: 6,
                avg: 5,
                first: 400,
                last: 400,
                count: 1,
            });
        });
    });

    it('ignores holes in the data', () => {
        // eslint-disable-next-line no-sparse-arrays
        const data = [{ x: 0, y: 1 }, , { x: 10, y: 2 }] as {
            x: number;
            y: number;
        }[];
        expect(getTraceValueAt(9, data, [], 10)).toEqual({
            value: 2,
            time: 10,
        });
    });

    it('returns null for empty data', () => {
        expect(getTraceValueAt(0, [], [], 10)).toBeNull();
    });
});

describe('spreadPositions', () => {
    it('keeps positions that are already far enough apart', () => {
        expect(spreadPositions([10, 50, 90], 20, 0, 100)).toEqual([10, 50, 90]);
    });

    it('pushes close positions apart', () => {
        expect(spreadPositions([50, 52, 54], 20, 0, 100)).toEqual([50, 70, 90]);
    });

    it('shifts positions back inside the upper limit', () => {
        expect(spreadPositions([95, 96, 97], 20, 0, 100)).toEqual([
            60, 80, 100,
        ]);
    });

    it('clamps positions into the range', () => {
        expect(spreadPositions([-10], 20, 0, 100)).toEqual([0]);
    });
});
