/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { DataManager } from '../../globals';
import { type OperationError, operationError } from './operation';

// What the remote control needs to know about the data in the app.

// Bytes of samples in the current session; 0 without any.
export const sessionBytes = () => {
    try {
        return DataManager().getSessionBuffers().fileBuffer.getSessionInBytes();
    } catch {
        return 0; // no session buffers
    }
};

export const hasData = () => sessionBytes() > 0;

// Epoch ms of the first sample; undefined for data without it (an old
// .ppk file) and without data. `present`: hasData(), when already known.
export const sessionStartMs = (present = hasData()) =>
    present ? DataManager().getStartSystemTime() : undefined;

// Identifies the data: a new session or a loaded file changes it.
export interface DataIdentity {
    folder: string | undefined;
    startMs: number | undefined;
}

export const dataIdentity = (): DataIdentity => ({
    folder: DataManager().getSessionFolder(),
    startMs: DataManager().getStartSystemTime(),
});

// The `data_changed` answer when the data are no longer the identified
// ones, e.g. 'while computing the stats'; otherwise undefined.
export const dataChanged = (
    identity: DataIdentity,
    during: string,
): OperationError | undefined => {
    const now = dataIdentity();
    return identity.folder === now.folder && identity.startMs === now.startMs
        ? undefined
        : operationError('data_changed', `The data changed ${during}`);
};
