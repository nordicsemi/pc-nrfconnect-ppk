/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { selectedDevice } from '@nordicsemiconductor/pc-nrfconnect-shared';

import { DataManager } from '../../../globals';
import {
    appState,
    deviceOpen,
    isFileLoaded,
    isSavePending,
} from '../../../slices/appSlice';
import { dataLoggerState } from '../../../slices/dataLoggerSlice';
import { voltageRegulatorState } from '../../../slices/voltageRegulatorSlice';
import { controlQueue } from '../controlQueue';
import { hasData, sessionStartMs } from '../dataSnapshot';
import { enabledDigitalMask, hexByte, lastDigitalState } from '../digital';
import { effectiveVoltageRange, modeOf } from '../guards';
import { defineOperation } from '../operation';
import { durationSeconds } from '../samplingDuration';
import { sessionOrigin } from '../sessionOrigin';
import { toEpochMs } from '../timeWindow';

export default defineOperation({
    name: 'status',
    description:
        'Current state of the Power Profiler app: the selected PPK2, mode, voltage and the range this client may set (voltage_range_mV, lowered by the max_mV in its URL, if given), DUT power, sampling, sample rate, "Sample for" (duration_s, null = unlimited), the recorded data (host epoch ms, approximate) and who recorded them (session_origin: api, ui or null), unsaved data, a loaded file. ' +
        'With digital channels enabled in the app (Display options), digital_mask is the enabled channels and digital their state at the last recorded sample (live only while sampling; null without data), both "0xNN" with bit i = Di, disabled channels 0 and a channel toggling within the sample 1; both are absent when no channel is enabled. ' +
        'busy_op is the call the API is running; one stuck for long (e.g. a sampling start that never finished) blocks all control calls until the app window is reloaded (Ctrl+R).',
    annotation: 'read',
    input: {},
    rest: { method: 'GET', path: '/api/status' },
    queue: 'none',
    handler: async (_args, { getState, maxMv }) => {
        const state = getState();
        const device = selectedDevice(state);
        const open = device != null && deviceOpen(state);
        const app = appState(state);
        const present = hasData();
        const startMs = sessionStartMs(present);
        const busy = controlQueue.busyOp;
        const mask = enabledDigitalMask(state);
        return {
            status: 'ok',
            device_selected: device != null,
            serial_number: device?.serialNumber ?? null,
            mode: open ? modeOf(state) : null,
            voltage_mV: open ? voltageRegulatorState(state).currentVDD : null,
            voltage_range_mV: effectiveVoltageRange(state, maxMv),
            output_on: open ? app.deviceRunning : null,
            sampling: app.samplingRunning,
            sample_rate_hz: dataLoggerState(state).sampleFreq,
            duration_s: durationSeconds(state),
            buffer:
                startMs !== undefined
                    ? {
                          from_ts_ms: startMs,
                          to_ts_ms: toEpochMs(
                              startMs,
                              DataManager().getTimestamp(),
                          ),
                      }
                    : null,
            session_start_ts_ms: startMs ?? null,
            session_origin: sessionOrigin(present),
            save_pending: isSavePending(state),
            file_loaded: isFileLoaded(state),
            busy_op: busy
                ? {
                      name: busy.name,
                      origin: busy.origin,
                      since_ts_ms: busy.sinceMs,
                  }
                : null,
            ...(mask !== 0 && {
                digital: await lastDigitalState(mask),
                digital_mask: hexByte(mask),
            }),
        };
    },
});
