/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

// The app's real Redux store with a fake PPK (see fakeModules.ts).

import { setCurrentPane } from '@nordicsemiconductor/pc-nrfconnect-shared';
import createStore from '@nordicsemiconductor/pc-nrfconnect-shared/src/store';

import appReducer, { type RootState } from '../../../slices';
import {
    deviceOpenedAction,
    samplingStoppedAction,
    setDeviceRunningAction,
    setPowerModeAction,
} from '../../../slices/appSlice';
import { updateRegulator } from '../../../slices/voltageRegulatorSlice';
import { Panes } from '../../../utils/panes';
import {
    type CallContext,
    type Origin,
    type ServerContext,
} from '../operation';
import { SERIAL_NUMBER } from './fakeModules';

export {
    fakeData,
    recordData,
    resetFakeData,
    SERIAL_NUMBER,
    START_MS,
} from './fakeModules';

export const createTestStore = () => {
    const store = createStore(appReducer);
    store.dispatch(setCurrentPane(Panes.DATA_LOGGER));
    return store;
};
export type TestStore = ReturnType<typeof createTestStore>;

export const selectPpk = (store: TestStore) =>
    store.dispatch({
        type: 'device/selectDevice',
        payload: { serialNumber: SERIAL_NUMBER },
    });

// A selected and opened PPK2, as after DeviceSelector and open().
export const openPpk = (
    store: TestStore,
    { mode = 'source' }: { mode?: 'source' | 'ampere' } = {},
) => {
    selectPpk(store);
    store.dispatch(
        deviceOpenedAction({
            portName: SERIAL_NUMBER,
            capabilities: { ppkSetPowerMode: true, ppkDeviceRunning: true },
        }),
    );
    store.dispatch(
        updateRegulator({ vdd: 3000, currentVDD: 3000, min: 800, max: 5000 }),
    );
    store.dispatch(setPowerModeAction({ isSmuMode: mode === 'source' }));
    store.dispatch(setDeviceRunningAction({ isRunning: mode === 'ampere' }));
    store.dispatch(samplingStoppedAction());
};

// What a server gets for the store, and what it passes per call.
export const serverContextFor = (store: TestStore): ServerContext => ({
    getState: store.getState as () => RootState,
    dispatch: store.dispatch,
    subscribe: store.subscribe,
});
export const contextFor = (
    store: TestStore,
    origin: Origin = 'MCP',
): CallContext => ({ ...serverContextFor(store), origin });
