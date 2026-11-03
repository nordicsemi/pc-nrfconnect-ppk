/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { useEffect, useState } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { type AppDispatch } from '@nordicsemiconductor/pc-nrfconnect-shared';

import type { RootState } from '../../slices';
import { getRemoteControlSettings } from '../../utils/persistentStore';
import { cancelPowerOnsOnPowerOff } from './controlQueue';
import instructions from './instructions';
import operations from './operations';
import RemoteControl from './RemoteControl';
import {
    defaultRemoteControlConfig,
    getRemoteControlConfig,
    remoteControlSettingsLoaded,
    setRemoteControlStatus,
} from './remoteControlSlice';

// Runs the remote control servers with the config from the Redux store.
// Mounted inside <App>, renders nothing.
//
// The port is released on `pagehide`, not `beforeunload`: the latter is
// cancelled when the user keeps the window open in the unsaved-data dialog.
export default () => {
    const store = useStore<RootState>();
    const dispatch = useDispatch<AppDispatch>();
    const config = useSelector(getRemoteControlConfig);
    const [remoteControl] = useState(
        () =>
            new RemoteControl({
                getContext: () => ({
                    getState: store.getState,
                    dispatch,
                    subscribe: store.subscribe,
                }),
                operations,
                instructions,
                onStatus: status => dispatch(setRemoteControlStatus(status)),
            }),
    );

    useEffect(() => {
        dispatch(
            remoteControlSettingsLoaded(
                getRemoteControlSettings(defaultRemoteControlConfig),
            ),
        );
    }, [dispatch]);

    useEffect(() => cancelPowerOnsOnPowerOff(store), [store]);

    useEffect(() => {
        remoteControl.apply(config);
    }, [remoteControl, config]);

    useEffect(() => {
        const stop = () => remoteControl.stopNow();
        window.addEventListener('pagehide', stop);
        return () => {
            window.removeEventListener('pagehide', stop);
            stop();
        };
    }, [remoteControl]);

    return null;
};
