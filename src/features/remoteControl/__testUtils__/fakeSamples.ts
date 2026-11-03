/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

// Recorded samples for DataManager().getData (see fakeModules.ts). Import
// after operationMocks.

import { FileData, frameSize, timestampToIndex } from '../../../globals';
import { type RootState } from '../../../slices';
import { setDigitalChannels } from '../../../slices/chartSlice';
import { convertBits16 } from '../../../utils/bitConversion';
import { type booleanTupleOf8 } from '../../../utils/persistentStore';
import { fakeData } from './fakeModules';

// A sample: the current and the stored bits (bit pairs, see pins()).
export type Sample = readonly [value: number, bits?: number];

// The stored bits of pins D0-D7 at the levels of `byte` (bit i = Di).
export const pins = (byte: number) => convertBits16(byte);

// The stored bits of a sample during which the pins had the levels of all
// `bytes`: X where they differ (as at low sample rates).
export const pinsDuring = (...bytes: number[]) =>
    // eslint-disable-next-line no-bitwise
    bytes.reduce((bits, byte) => bits | pins(byte), 0);

export const fileData = (samples: readonly Sample[]) => {
    const bytes = new Uint8Array(samples.length * frameSize);
    const view = new DataView(bytes.buffer);
    samples.forEach(([value, bits = pins(0)], i) => {
        view.setFloat32(i * frameSize, value, true);
        view.setUint16(i * frameSize + 4, bits); // as DataManager().addData
    });
    return new FileData(bytes, bytes.length);
};

// getData answering with sample(index) for every index asked for.
export const samplesAre = (sample: (index: number) => Sample) =>
    fakeData.getData.mockImplementation(
        (_buffer: Buffer, fromUs: number, toUs: number) => {
            const first = timestampToIndex(fromUs);
            const last = timestampToIndex(toUs);
            return Promise.resolve(
                fileData(
                    Array.from({ length: last - first + 1 }, (_, i) =>
                        sample(first + i),
                    ),
                ),
            );
        },
    );

// Enables the digital channels whose bits are set in `mask` (bit i = Di).
export const enableDigitalChannels = (
    store: { dispatch: (action: unknown) => unknown },
    mask: number,
) =>
    store.dispatch(
        setDigitalChannels({
            digitalChannels: Array.from(
                { length: 8 },
                // eslint-disable-next-line no-bitwise
                (_, i) => (mask & (1 << i)) !== 0,
            ) as booleanTupleOf8,
        }),
    );

export const selection = (state: RootState) => ({
    begin: state.app.chart.cursorBegin,
    end: state.app.chart.cursorEnd,
});
