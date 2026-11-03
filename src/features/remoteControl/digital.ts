/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { DataManager, frameSize, numberOfDigitalChannels } from '../../globals';
import { type RootState } from '../../slices';
import { getChartDigitalChannelInfo } from '../../slices/chartSlice';
import { always1, getSingleBitState } from '../../utils/bitConversion';
import { hasData } from './dataSnapshot';

/* eslint-disable no-bitwise */

// The digital channels D0-D7 as the API reports them: one byte, bit i = Di.

// The channels enabled in the app (Display options, Digital channels on
// and the channel's button on) as a byte; 0 when none is.
export const enabledDigitalMask = (state: RootState) => {
    const { digitalChannels, digitalChannelsVisible } =
        getChartDigitalChannelInfo(state);
    if (!digitalChannelsVisible) return 0;
    return digitalChannels.reduce(
        (mask, enabled, i) => (enabled ? mask | (1 << i) : mask),
        0,
    );
};

// The byte of a sample's bits (the stored bit pairs) for the channels in
// `mask`, the others 0. A channel that was high at any time within the
// sample (X in the CSV export, at low sample rates) counts as 1.
export const digitalByte = (bits: number, mask: number) => {
    let byte = 0;
    for (let i = 0; i < numberOfDigitalChannels; i += 1) {
        if (mask & (1 << i) && getSingleBitState(bits, i) & always1) {
            byte |= 1 << i;
        }
    }
    return byte;
};

const CSV_STATES = ['-', '0', '1', 'X'];
// The CSV fields of the 4 channels in a byte of the stored bits (bit pairs),
// for every byte.
const CSV_FIELDS_OF_4 = Array.from({ length: 256 }, (_, byte) =>
    [0, 1, 2, 3]
        .map(i => `,${CSV_STATES[getSingleBitState(byte, i)]}`)
        .join(''),
);

// D0-D7 of a sample's bits as separate CSV fields (',0,1,X,-,...'), as the
// export of the app writes them.
export const csvBitFields = (bits: number) =>
    CSV_FIELDS_OF_4[bits & 0xff] + CSV_FIELDS_OF_4[bits >> 8];

// '0x0A'.
export const hexByte = (byte: number) =>
    `0x${byte.toString(16).toUpperCase().padStart(2, '0')}`;

// The state of the last recorded sample as '0xNN'; null without data or
// when it cannot be read.
export const lastDigitalState = async (mask: number) => {
    if (!hasData()) return null;
    try {
        const lastUs = DataManager().getTimestamp();
        const data = await DataManager().getData(
            Buffer.alloc(frameSize),
            lastUs,
            lastUs,
            'end',
        );
        return hexByte(digitalByte(data.getBitData(0), mask));
    } catch {
        return null; // a short read
    }
};
