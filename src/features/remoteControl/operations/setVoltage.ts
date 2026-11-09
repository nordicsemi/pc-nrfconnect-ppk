/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { logger } from '@nordicsemiconductor/pc-nrfconnect-shared';
import { z } from 'zod';

import { updateRegulator } from '../../../actions/deviceActions';
import { moveVoltageRegulatorVdd } from '../../../slices/voltageRegulatorSlice';
import {
    effectiveVoltageRange,
    requireControllable,
    requireSourceMode,
} from '../guards';
import { defineOperation, operationError } from '../operation';

export default defineOperation({
    name: 'set_voltage',
    description:
        'Sets the output voltage in mV (source mode only). Values outside the allowed range (status.voltage_range_mV: the app range, the voltage limit set in the app and the max_mV in the URL of this client, if given) are rejected, never clamped.',
    annotation: 'control',
    input: { mV: z.number().int() },
    rest: { method: 'POST', path: '/api/voltage' },
    guards: [requireControllable, requireSourceMode],
    handler: async ({ mV }, { getState, dispatch, origin, maxMv }) => {
        const range = effectiveVoltageRange(getState(), maxMv);
        if (!range) {
            return operationError(
                'out_of_range',
                'No voltage is allowed: check the voltage limit in the app and max_mV',
                { voltage_range_mV: null },
            );
        }
        if (!(mV >= range.min && mV <= range.max)) {
            return operationError(
                'out_of_range',
                `${mV} mV is outside the allowed range ${range.min}..${range.max} mV`,
                { voltage_range_mV: range },
            );
        }
        logger.info(`[${origin}] Voltage ${mV} mV`);
        dispatch(moveVoltageRegulatorVdd(mV));
        await dispatch(updateRegulator());
        return { status: 'ok', voltage_mV: mV };
    },
});
