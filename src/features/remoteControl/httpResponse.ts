/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { type ServerResponse } from 'http';

// False once a response has started, ended or its connection is gone, so a
// late answer (e.g. after a failure mid-response) is dropped, not thrown.
export const canWrite = (res: ServerResponse) =>
    !res.headersSent && !res.writableEnded && !res.destroyed;

export const sendJson = (
    res: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
) => {
    if (!canWrite(res)) return;
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        ...headers,
    });
    res.end(JSON.stringify(body));
};
