/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { logger } from '@nordicsemiconductor/pc-nrfconnect-shared';
import { z } from 'zod';

import { setDeviceRunning, setPowerMode } from '../../../actions/deviceActions';
import { appState } from '../../../slices/appSlice';
import { modeOf, requireControllable, requireNotSampling } from '../guards';
import { defineOperation, operationError } from '../operation';

export default defineOperation({
    name: 'set_mode',
    description:
        'Switches between source meter ("source": the PPK supplies the DUT; switching to it turns the DUT power off) and ampere meter ("ampere": measures an external supply; switching to it turns the power output on). Not while sampling.',
    annotation: 'destructive',
    input: { mode: z.enum(['source', 'ampere']) },
    rest: { method: 'POST', path: '/api/mode' },
    powersOn: ({ mode }) => mode === 'ampere',
    guards: [requireControllable, requireNotSampling],
    handler: async ({ mode }, { getState, dispatch, origin, poweredOff }) => {
        const result = () => ({
            mode: modeOf(getState()),
            output_on: appState(getState()).deviceRunning,
        });
        if (modeOf(getState()) === mode) {
            return { status: 'ok', ...result(), changed: false };
        }

        logger.info(`[${origin}] Mode ${mode}`);
        await dispatch(setPowerMode(mode === 'source'));
        // Switching to ampere mode turns the power on: a power off that came
        // meanwhile (it skips the queue) must win.
        if (poweredOff()) {
            await dispatch(setDeviceRunning(false));
            return operationError(
                'cancelled',
                'The DUT power was switched off meanwhile; it stays off',
                result(),
            );
        }
        return { status: 'ok', ...result(), changed: true };
    },
});
