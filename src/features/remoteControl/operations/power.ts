/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { logger } from '@nordicsemiconductor/pc-nrfconnect-shared';
import { z } from 'zod';

import { setDeviceRunning } from '../../../actions/deviceActions';
import { appState } from '../../../slices/appSlice';
import { controlQueue } from '../controlQueue';
import { requireControllable, requireVoltageAllowed } from '../guards';
import { defineOperation } from '../operation';

export default defineOperation({
    name: 'power',
    description:
        'Switches the power output to the device under test on or off, like the "Enable power output" toggle; works in source and ampere mode (in ampere mode it breaks the pass-through supply: a power reset for battery boards). ' +
        'Switching on in source mode is refused with out_of_range while the voltage is above the allowed maximum (status.voltage_range_mV, lowered by the max_mV in the URL of this client); set_voltage first. ' +
        'Switching off never waits for other calls and cancels queued calls that would switch the power on again.',
    annotation: 'destructive',
    input: { on: z.boolean() },
    rest: { method: 'POST', path: '/api/power' },
    queue: ({ on }) => (on ? 'serial' : 'none'),
    powersOn: ({ on }) => on,
    guards: [
        requireControllable,
        (state, args, context) =>
            args.on ? requireVoltageAllowed(state, args, context) : undefined,
    ],
    handler: async ({ on }, { getState, dispatch, origin }) => {
        // Only a power off that is not refused cancels queued power-ons.
        // Not redundant with cancelPowerOnsOnPowerOff: this cancels them at
        // once, before the device command completes and the store changes,
        // and also when the power is off already.
        if (!on) controlQueue.powerOff();
        logger.info(`[${origin}] DUT power ${on ? 'ON' : 'OFF'}`);
        await dispatch(setDeviceRunning(on));
        return { status: 'ok', output_on: appState(getState()).deviceRunning };
    },
});
