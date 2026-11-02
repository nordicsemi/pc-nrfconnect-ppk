/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { DataManager } from '../../globals';
import { hasData } from './dataSnapshot';

// Who recorded the data in the app. Every session has its own folder, so
// data belong to the API only while the session is the one the API started;
// anything else (started in the UI, a loaded file, a Scope trigger, a
// recovered session) belongs to the human.
let apiSessionFolder: string | undefined;

export type SessionOrigin = 'api' | 'ui' | null;

export const setApiSession = (folder: string | undefined) => {
    apiSessionFolder = folder;
};

// `present`: hasData(), when already known.
export const sessionOrigin = (present = hasData()): SessionOrigin => {
    if (!present) return null;
    const folder = DataManager().getSessionFolder();
    return folder !== undefined && folder === apiSessionFolder ? 'api' : 'ui';
};
