/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { RootState } from '../../slices';
import {
    type RemoteControlConfig,
    setRemoteControlMcpEnabled as persistMcpEnabled,
    setRemoteControlMcpListen as persistMcpListen,
    setRemoteControlRestEnabled as persistRestEnabled,
    setRemoteControlRestListen as persistRestListen,
    setRemoteControlToken as persistToken,
} from '../../utils/persistentStore';
import { type RemoteControlStatus } from './RemoteControl';

export const defaultRemoteControlConfig: RemoteControlConfig = {
    mcpEnabled: false,
    mcpListen: '127.0.0.1:8098',
    restEnabled: false,
    restListen: '127.0.0.1:8098',
    token: '',
};

interface RemoteControlState {
    config: RemoteControlConfig;
    status: RemoteControlStatus;
}

// The persisted config is loaded by RemoteControlProvider on mount, not
// here: tests elsewhere mock persistentStore with a fixed set of getters.
const initialState: RemoteControlState = {
    config: defaultRemoteControlConfig,
    status: { mcp: { state: 'stopped' }, rest: { state: 'stopped' } },
};

const remoteControlSlice = createSlice({
    name: 'remoteControl',
    initialState,
    reducers: {
        remoteControlSettingsLoaded(
            state,
            action: PayloadAction<RemoteControlConfig>,
        ) {
            state.config = action.payload;
        },
        setMcpEnabled(state, action: PayloadAction<boolean>) {
            state.config.mcpEnabled = action.payload;
            persistMcpEnabled(action.payload);
        },
        setMcpListen(state, action: PayloadAction<string>) {
            state.config.mcpListen = action.payload;
            persistMcpListen(action.payload);
        },
        setRestEnabled(state, action: PayloadAction<boolean>) {
            state.config.restEnabled = action.payload;
            persistRestEnabled(action.payload);
        },
        setRestListen(state, action: PayloadAction<string>) {
            state.config.restListen = action.payload;
            persistRestListen(action.payload);
        },
        setToken(state, action: PayloadAction<string>) {
            state.config.token = action.payload;
            persistToken(action.payload);
        },
        setRemoteControlStatus(
            state,
            action: PayloadAction<RemoteControlStatus>,
        ) {
            state.status = action.payload;
        },
    },
});

export const getRemoteControlConfig = (state: RootState) =>
    state.app.remoteControl.config;
export const getRemoteControlStatus = (state: RootState) =>
    state.app.remoteControl.status;

export const {
    remoteControlSettingsLoaded,
    setMcpEnabled,
    setMcpListen,
    setRestEnabled,
    setRestListen,
    setToken,
    setRemoteControlStatus,
} = remoteControlSlice.actions;

export default remoteControlSlice.reducer;
