/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { calcStats } from '../../../components/Chart/data/dataAccumulator';
import { abortable } from '../abortable';
import { dataChanged, dataIdentity } from '../dataSnapshot';
import { defineOperation } from '../operation';
import {
    epochRange,
    resolveWindow,
    SELECTION_DESCRIPTION,
    selectWindow,
    WINDOW_DESCRIPTION,
    windowInput,
} from '../timeWindow';

interface Stats {
    average: number;
    max: number;
    delta: number;
}

export default defineOperation({
    name: 'stats',
    description:
        'Average and max current and the charge over a window of the recorded data, computed like the window statistics below the chart. ' +
        'Units are fixed: uA, uC, uAh, ms. ' +
        `${WINDOW_DESCRIPTION} ${SELECTION_DESCRIPTION} ` +
        'Long windows at high sample rates take seconds; the call times out after 30 s. Works without a PPK on the data shown in the app.',
    annotation: 'read',
    input: windowInput,
    rest: { method: 'GET', path: '/api/stats' },
    timeoutMs: 30_000,
    handler: async (args, { signal, dispatch }) => {
        const window = resolveWindow(args);
        if ('status' in window) return window;

        const identity = dataIdentity();
        const abort = new AbortController();
        signal.addEventListener('abort', () => abort.abort(), { once: true });
        const result = await abortable(
            new Promise<Stats>(resolve => {
                calcStats(
                    (average, max, delta) => resolve({ average, max, delta }),
                    window.beginUs,
                    window.endUs,
                    abort,
                );
            }),
            signal,
        );
        const changed = dataChanged(identity, 'while computing the stats');
        if (changed) return changed;
        selectWindow(dispatch, window);
        const chargeUC = (result.average * result.delta) / 1e6;
        return {
            status: 'ok',
            avg_uA: result.average,
            max_uA: result.max,
            charge_uC: chargeUC,
            charge_uAh: chargeUC / 3600,
            duration_ms: result.delta / 1000,
            ...epochRange(window),
        };
    },
});
