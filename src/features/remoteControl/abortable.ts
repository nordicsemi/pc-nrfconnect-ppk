/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

// Rejects with the abort reason as soon as the signal aborts, also when
// `promise` never settles; a late rejection of `promise` is then swallowed.
export const abortable = <T>(
    promise: Promise<T>,
    signal: AbortSignal,
): Promise<T> => {
    promise.catch(() => {});
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
            value => {
                signal.removeEventListener('abort', onAbort);
                resolve(value);
            },
            error => {
                signal.removeEventListener('abort', onAbort);
                reject(error);
            },
        );
    });
};
