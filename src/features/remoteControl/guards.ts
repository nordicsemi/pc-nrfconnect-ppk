/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { selectedDevice } from '@nordicsemiconductor/pc-nrfconnect-shared';

import { type RootState } from '../../slices';
import {
    appState,
    deviceOpen,
    isFileLoaded,
    isSamplingRunning,
} from '../../slices/appSlice';
import { voltageRegulatorState } from '../../slices/voltageRegulatorSlice';
import {
    type OperationContext,
    type OperationError,
    operationError,
} from './operation';

// Checks shared by the operations that control the PPK, for their `guards`.
// Each returns the error to answer with, or undefined when the call may go
// on.

// The PPK must be selected and opened: the device thunks need the open
// device and would throw otherwise.
export const requireDevice = (state: RootState): OperationError | undefined => {
    if (selectedDevice(state) == null) {
        return operationError(
            'no_device',
            'No PPK is selected; select one in the app',
        );
    }
    if (!deviceOpen(state)) {
        return operationError('no_device', 'The PPK is still connecting');
    }
};

export const requireNoFile = (state: RootState): OperationError | undefined =>
    isFileLoaded(state)
        ? operationError(
              'file_loaded',
              'A .ppk2 file is loaded; the PPK cannot be controlled',
          )
        : undefined;

export const requireNotSampling = (
    state: RootState,
): OperationError | undefined =>
    isSamplingRunning(state)
        ? operationError(
              'sampling_running',
              'Not possible while sampling; stop sampling first',
          )
        : undefined;

export const requireControllable = (state: RootState) =>
    requireDevice(state) ?? requireNoFile(state);

// The mode as the API names it.
export const modeOf = (state: RootState) =>
    appState(state).isSmuMode ? 'source' : 'ampere';

// The app shows the voltage control only then (VoltageRegulator).
export const requireSourceMode = (
    state: RootState,
): OperationError | undefined => {
    const { isSmuMode, capabilities } = appState(state);
    return capabilities.ppkSetPowerMode && !isSmuMode
        ? operationError(
              'wrong_mode',
              'The voltage can only be set in source mode',
          )
        : undefined;
};

interface VoltageRange {
    min: number;
    max: number;
}

// Where the app, the voltage cap set in the app and the client's max_mV
// (if given) all allow the voltage; null when that is nothing or not
// computable (fail closed).
export const effectiveVoltageRange = (
    state: RootState,
    maxMv?: number,
): VoltageRange | null => {
    const { min, max, maxCap } = voltageRegulatorState(state);
    const range = { min, max: Math.min(max, maxCap, maxMv ?? Infinity) };
    // A NaN bound (e.g. an edited cap) fails the comparison, too.
    return range.min <= range.max ? range : null;
};

// Switching the output on in source mode applies the voltage the regulator
// was last set to (currentVDD; vdd is only the slider), which may be above
// what this call may set: the cap may have been lowered since, or the
// client has a lower max_mV. Ampere mode passes an external supply through.
// For the guards of a call that switches the output on.
export const requireVoltageAllowed = (
    state: RootState,
    _args: unknown,
    { maxMv }: Pick<OperationContext, 'maxMv'>,
): OperationError | undefined => {
    if (modeOf(state) !== 'source') return undefined;
    const range = effectiveVoltageRange(state, maxMv);
    const { currentVDD } = voltageRegulatorState(state);
    if (range && currentVDD <= range.max) return undefined;
    return operationError(
        'out_of_range',
        range
            ? `The current voltage ${currentVDD} mV exceeds the allowed maximum ${range.max} mV; set_voltage first`
            : 'No voltage is allowed: check the voltage limit in the app and max_mV',
        { voltage_mV: currentVDD, voltage_range_mV: range },
    );
};
