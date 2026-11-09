/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

// A client's own voltage limit: `?max_mV=` in the URL of /mcp or /api/*,
// e.g. in the `url` of `.mcp.json`. It guards against an agent's slip, it
// is no security boundary: the voltage cap set in the app stays the hard
// limit, and max_mV can only lower it.
export const MAX_MV_PARAM = 'max_mV';

export class InvalidMaxMvError extends Error {}

// A positive integer, given at most once; undefined when absent. Throws
// InvalidMaxMvError for anything else: an invalid limit is never ignored.
export const parseMaxMv = (searchParams: URLSearchParams) => {
    const values = searchParams.getAll(MAX_MV_PARAM);
    if (values.length === 0) return undefined;
    if (values.length > 1) {
        throw new InvalidMaxMvError(`${MAX_MV_PARAM} is given more than once`);
    }
    const [value] = values;
    const maxMv = Number(value);
    if (!(/^\d+$/.test(value) && Number.isSafeInteger(maxMv) && maxMv > 0)) {
        throw new InvalidMaxMvError(
            `${MAX_MV_PARAM} must be a positive integer in mV, not ${JSON.stringify(value)}`,
        );
    }
    return maxMv;
};
