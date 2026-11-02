/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import {
    setRemoteControlMcpEnabled,
    setRemoteControlMcpListen,
    setRemoteControlRestEnabled,
    setRemoteControlRestListen,
    setRemoteControlToken,
} from '../../../utils/persistentStore';
import reducer, {
    defaultRemoteControlConfig,
    remoteControlSettingsLoaded,
    setMcpEnabled,
    setMcpListen,
    setRestEnabled,
    setRestListen,
    setToken,
} from '../remoteControlSlice';

jest.mock('../../../utils/persistentStore', () => ({
    setRemoteControlMcpEnabled: jest.fn(),
    setRemoteControlMcpListen: jest.fn(),
    setRemoteControlRestEnabled: jest.fn(),
    setRemoteControlRestListen: jest.fn(),
    setRemoteControlToken: jest.fn(),
}));

describe('remoteControlSlice', () => {
    beforeEach(() => jest.clearAllMocks());

    it('starts disabled on 127.0.0.1:8098 without reading the store', () => {
        expect(reducer(undefined, { type: 'init' }).config).toEqual({
            mcpEnabled: false,
            mcpListen: '127.0.0.1:8098',
            restEnabled: false,
            restListen: '127.0.0.1:8098',
            token: '',
        });
    });

    it.each([
        [setMcpEnabled, true, setRemoteControlMcpEnabled, 'mcpEnabled'],
        [setMcpListen, '0.0.0.0:1', setRemoteControlMcpListen, 'mcpListen'],
        [setRestEnabled, true, setRemoteControlRestEnabled, 'restEnabled'],
        [setRestListen, '[::1]:2', setRemoteControlRestListen, 'restListen'],
        [setToken, 'abc', setRemoteControlToken, 'token'],
    ] as const)(
        '%p updates the config and persists it',
        (action, value, persist, key) => {
            const state = reducer(
                undefined,
                (action as (v: typeof value) => { type: string })(value),
            );
            expect(state.config[key]).toBe(value);
            expect(persist).toHaveBeenCalledWith(value);
        },
    );

    it('loading the settings does not write them back', () => {
        const loaded = { ...defaultRemoteControlConfig, restEnabled: true };
        const state = reducer(undefined, remoteControlSettingsLoaded(loaded));
        expect(state.config).toEqual(loaded);
        expect(setRemoteControlRestEnabled).not.toHaveBeenCalled();
    });
});
