/*
 * Copyright (c) 2025 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import fs from 'fs';

import { DataManager } from '../../globals';
import appReducer, { type RootState } from '../../slices';
import { getFreeSpace } from '../../utils/fileUtils';
import { isScopePane } from '../../utils/panes';
import { samplingStart } from '../deviceActions';
import { startSamplingSession } from '../samplingSessionActions';

jest.mock(
    '@nordicsemiconductor/pc-nrfconnect-shared/ipc/launcherConfig',
    () => ({
        getConfig: jest.fn(() => ({ appDataDir: '/mock/app/data' })),
    }),
);
jest.mock('electron', () => ({ ipcRenderer: { sendSync: jest.fn() } }));
jest.mock('@nordicsemiconductor/pc-nrfconnect-shared', () => ({
    ...jest.requireActual('@nordicsemiconductor/pc-nrfconnect-shared'),
    telemetry: { sendEvent: jest.fn() },
}));
jest.mock('fs', () => ({ existsSync: jest.fn() }));
jest.mock('../deviceActions', () => ({
    samplingStart: jest.fn(() => ({ type: 'mock/samplingStart' })),
}));
jest.mock('../../globals', () => ({ DataManager: jest.fn() }));
jest.mock('../../components/Chart/data/dataAccumulator', () => ({
    resetCache: jest.fn(),
}));
jest.mock('../../utils/fileUtils', () => ({ getFreeSpace: jest.fn() }));
jest.mock('../../utils/panes', () => ({ isScopePane: jest.fn() }));

const reset = jest.fn();
const existsSync = fs.existsSync as jest.Mock;

const run = async () => {
    const appState = appReducer(undefined, { type: 'init' });
    const state = {
        app: {
            ...appState,
            app: {
                ...appState.app,
                sessionFolder: '/tmp/session',
                diskFullLimitMb: 10,
            },
        },
    } as unknown as RootState;
    const dispatch = jest.fn(action => action);
    const result = await startSamplingSession()(dispatch, () => state, {});
    return { result, dispatch };
};

describe('startSamplingSession', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        reset.mockResolvedValue(undefined);
        (DataManager as jest.Mock).mockReturnValue({
            reset,
            getSamplesPerSecond: () => 1000,
        });
        (isScopePane as unknown as jest.Mock).mockReturnValue(false);
        existsSync.mockReturnValue(true);
        (getFreeSpace as jest.Mock).mockResolvedValue(5000);
    });

    it('resets the session and starts sampling', async () => {
        const { result, dispatch } = await run();

        expect(result).toEqual({ ok: true, freeSpace: 5000 });
        expect(reset).toHaveBeenCalledTimes(1);
        expect(getFreeSpace).toHaveBeenCalledWith(10, '/tmp/session');
        expect(samplingStart).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenLastCalledWith({
            type: 'mock/samplingStart',
        });
    });

    it('does not check the disk in scope mode', async () => {
        (isScopePane as unknown as jest.Mock).mockReturnValue(true);
        existsSync.mockReturnValue(false);

        const { result } = await run();

        expect(result).toEqual({ ok: true, freeSpace: undefined });
        expect(getFreeSpace).not.toHaveBeenCalled();
        expect(samplingStart).toHaveBeenCalledTimes(1);
    });

    it('fails when the Temp Disk folder is missing', async () => {
        existsSync.mockReturnValue(false);

        const { result } = await run();

        expect(result).toEqual({
            ok: false,
            error: 'temp_disk_missing',
            message: expect.stringContaining("'/tmp/session' does not exists"),
        });
        expect(samplingStart).not.toHaveBeenCalled();
    });

    it('fails when the disk is full', async () => {
        (getFreeSpace as jest.Mock).mockResolvedValue(-100);

        const { result } = await run();

        expect(result).toEqual({
            ok: false,
            error: 'disk_full',
            message: expect.stringContaining('Disk is full'),
            freeSpace: 0,
        });
        expect(samplingStart).not.toHaveBeenCalled();
    });
});
