/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React from 'react';
import { Provider, useSelector } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { act, render, screen } from '@testing-library/react';

import appReducer from '../../../slices';
import { setDeviceRunningAction } from '../../../slices/appSlice';
import { canBind, freePort, request } from '../__testUtils__/http';
import { controlQueue } from '../controlQueue';
import RemoteControlProvider from '../RemoteControlProvider';
import {
    defaultRemoteControlConfig,
    getRemoteControlStatus,
} from '../remoteControlSlice';

// The operations load the data layer, which asks for the app data
// directory when it loads.
jest.mock('@nordicsemiconductor/pc-nrfconnect-shared', () => ({
    ...jest.requireActual('@nordicsemiconductor/pc-nrfconnect-shared'),
    getAppDataDir: () => '/mock/app/data',
}));

const mockSettings = jest.fn();
jest.mock('../../../utils/persistentStore', () => ({
    ...jest.requireActual('../../../utils/persistentStore'),
    getRemoteControlSettings: () => mockSettings(),
}));

// shared persists a log setting on beforeunload; give it a working store.
jest.mock('electron-store', () =>
    jest.fn().mockImplementation(() => ({
        get: (_: string, defaultValue: unknown) => defaultValue,
        set: jest.fn(),
    })),
);

const RestStatus = () => {
    const { rest } = useSelector(getRemoteControlStatus);
    return <div>rest:{rest.state}</div>;
};

// The app's reducer, which `status` reads, without shared's other slices.
const createStore = () =>
    configureStore({
        reducer: {
            app: appReducer,
            device: () => ({ selectedDevice: undefined }),
        },
    });

const renderWithRestOn = async (port: number) => {
    mockSettings.mockReturnValue({
        ...defaultRemoteControlConfig,
        restEnabled: true,
        restListen: `127.0.0.1:${port}`,
    });
    const store = createStore();
    const view = render(
        <Provider store={store}>
            <RemoteControlProvider />
            <RestStatus />
        </Provider>,
    );
    await screen.findByText('rest:running');
    return view;
};

describe('RemoteControlProvider', () => {
    it('starts the server from the persisted settings on mount', async () => {
        const port = await freePort();
        const { unmount } = await renderWithRestOn(port);

        const response = await request(port, { path: '/api/status' });
        expect(response.status).toBe(200);
        unmount();
    });

    it('keeps running when beforeunload is cancelled, stops on pagehide', async () => {
        const port = await freePort();
        const { unmount } = await renderWithRestOn(port);

        // What ConfirmCloseDialog does when there is unsaved data.
        const beforeUnload = new Event('beforeunload', { cancelable: true });
        beforeUnload.preventDefault();
        window.dispatchEvent(beforeUnload);
        expect((await request(port, { path: '/api/status' })).status).toBe(200);

        act(() => {
            window.dispatchEvent(new Event('pagehide'));
        });
        expect(await canBind(port)).toBe(true);
        await screen.findByText('rest:stopped');
        unmount();
    });

    it('stops the server on unmount', async () => {
        const port = await freePort();
        const { unmount } = await renderWithRestOn(port);
        unmount();
        expect(await canBind(port)).toBe(true);
    });

    it('cancels queued power-ons when the DUT power goes off', async () => {
        mockSettings.mockReturnValue(defaultRemoteControlConfig);
        const store = createStore();
        store.dispatch(setDeviceRunningAction({ isRunning: true }));
        const { unmount } = render(
            <Provider store={store}>
                <RemoteControlProvider />
            </Provider>,
        );
        const holder = await controlQueue.acquire(
            { name: 'holder', origin: 'MCP' },
            { waitMs: 15_000, powersOn: false },
        );
        const powerOn = controlQueue.acquire(
            { name: 'power', origin: 'MCP' },
            { waitMs: 15_000, powersOn: true },
        );

        act(() => {
            store.dispatch(setDeviceRunningAction({ isRunning: false }));
        });

        expect(await powerOn).toBe('cancelled');
        if (typeof holder !== 'string') holder.release();
        unmount();
    });
});
