/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { logger } from '@nordicsemiconductor/pc-nrfconnect-shared';
import { z } from 'zod';

import {
    dataLoggerState,
    updateSampleFreqLog10,
} from '../../../slices/dataLoggerSlice';
import { requireControllable, requireNotSampling } from '../guards';
import { defineOperation, operationError } from '../operation';

export default defineOperation({
    name: 'set_sample_rate',
    description:
        'Sets the Data Logger sample rate in Hz; the app supports powers of ten only (1, 10, …, 100000). Not while sampling.',
    annotation: 'control',
    input: { hz: z.number().int() },
    rest: { method: 'POST', path: '/api/sample-rate' },
    guards: [requireControllable, requireNotSampling],
    handler: ({ hz }, { getState, dispatch, origin }) => {
        const { maxFreqLog10, maxSampleFreq } = dataLoggerState(getState());
        const allowed = Array.from(
            { length: maxFreqLog10 + 1 },
            (_, log10) => 10 ** log10,
        ).filter(rate => rate <= maxSampleFreq);
        if (!allowed.includes(hz)) {
            return operationError(
                'out_of_range',
                `${hz} Hz is not supported; use one of ${allowed.join(', ')}`,
            );
        }
        logger.info(`[${origin}] Sample rate ${hz} Hz`);
        dispatch(updateSampleFreqLog10({ sampleFreqLog10: Math.log10(hz) }));
        return {
            status: 'ok',
            sample_rate_hz: dataLoggerState(getState()).sampleFreq,
        };
    },
});
