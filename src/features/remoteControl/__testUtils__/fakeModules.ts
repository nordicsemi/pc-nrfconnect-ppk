/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

// Fake recorded data and a fake PPK, for the tests of the operations. The
// mock factories are required from jest.mock() calls in the tests:
//
//   jest.mock('../../../globals', () =>
//       jest.requireActual('../__testUtils__/fakeModules').globalsMock());
//   jest.mock('../../../actions/deviceActions', () =>
//       jest.requireActual('../__testUtils__/fakeModules').deviceActionsMock());
//
// Nothing of the app is imported at the top: the factories run while the
// app's modules load.

import type * as Globals from '../../../globals';
import { type RootState } from '../../../slices';

export const SERIAL_NUMBER = 'E2BCADE3A438';

// What DataManager reports about the data, set by the tests.
export const fakeData = {
    folder: undefined as string | undefined,
    bytes: 0,
    startMs: undefined as number | undefined,
    lastUs: 0,
    getData: jest.fn(),
};

export const resetFakeData = () => {
    fakeData.folder = undefined;
    fakeData.bytes = 0;
    fakeData.startMs = undefined;
    fakeData.lastUs = 0;
    fakeData.getData.mockReset();
};

export const START_MS = 1_700_000_000_000;

// Data of a session, the last sample at `lastUs`; `startMs: null` for data
// without a start time (an old file).
export const recordData = ({
    folder = '/sessions/ui',
    startMs = START_MS,
    lastUs,
}: {
    folder?: string;
    startMs?: number | null;
    lastUs: number;
}) => {
    fakeData.folder = folder;
    fakeData.startMs = startMs ?? undefined;
    fakeData.lastUs = lastUs;
    fakeData.bytes = 6;
};

export const globalsMock = () => {
    const actual = jest.requireActual<typeof Globals>('../../../globals');
    return {
        ...actual,
        DataManager: () => ({
            ...actual.DataManager(),
            getSessionFolder: () => fakeData.folder,
            getStartSystemTime: () => fakeData.startMs,
            getTimestamp: () => fakeData.lastUs,
            getSessionBuffers: () => {
                if (fakeData.bytes === 0) throw new Error('No buffers');
                return {
                    fileBuffer: { getSessionInBytes: () => fakeData.bytes },
                };
            },
            getData: (...args: unknown[]) => fakeData.getData(...args),
        }),
    };
};

type Thunk = (
    dispatch: (action: unknown) => unknown,
    getState: () => RootState,
) => void;

// The device thunks without a device: they only change the state, as the
// real ones do after the device answered (synchronously: the real device
// commands resolve at once, too).
export const deviceActionsMock = () => {
    const app = jest.requireActual('../../../slices/appSlice');
    const regulator = jest.requireActual(
        '../../../slices/voltageRegulatorSlice',
    );
    return {
        setDeviceRunning: jest.fn(
            (isRunning: boolean): Thunk =>
                dispatch => {
                    dispatch(app.setDeviceRunningAction({ isRunning }));
                },
        ),
        setPowerMode: jest.fn(
            (isSmuMode: boolean): Thunk =>
                dispatch => {
                    if (isSmuMode) {
                        dispatch(
                            app.setDeviceRunningAction({ isRunning: false }),
                        );
                    }
                    dispatch(app.setPowerModeAction({ isSmuMode }));
                    if (!isSmuMode) {
                        dispatch(
                            app.setDeviceRunningAction({ isRunning: true }),
                        );
                    }
                },
        ),
        updateRegulator: jest.fn(
            (): Thunk => (dispatch, getState) => {
                dispatch(
                    regulator.updateRegulator({
                        currentVDD: getState().app.voltageRegulator.vdd,
                    }),
                );
            },
        ),
        samplingStop: jest.fn(
            (): Thunk => dispatch => {
                dispatch(app.samplingStoppedAction());
            },
        ),
    };
};

type Tree = Record<string, unknown>;

// A working electron-store for the persisted settings. Like conf, it stores
// dotted keys nested: 'a.b' is { a: { b } } in `store`.
export const electronStoreMock = () =>
    jest.fn().mockImplementation(() => {
        const tree: Tree = {};
        const get = (key: string, defaultValue?: unknown) => {
            const value = key
                .split('.')
                .reduce<unknown>(
                    (node, part) =>
                        node !== null && typeof node === 'object'
                            ? (node as Tree)[part]
                            : undefined,
                    tree,
                );
            return value === undefined ? defaultValue : value;
        };
        const setOne = (key: string, value: unknown) => {
            const parts = key.split('.');
            const last = parts.pop() as string;
            const parent = parts.reduce<Tree>((node, part) => {
                if (node[part] === null || typeof node[part] !== 'object') {
                    node[part] = {};
                }
                return node[part] as Tree;
            }, tree);
            parent[last] = value;
        };
        return {
            get,
            set: (key: string | Tree, value?: unknown) =>
                typeof key === 'string'
                    ? setOne(key, value)
                    : Object.entries(key).forEach(([k, v]) => setOne(k, v)),
            get store() {
                return JSON.parse(JSON.stringify(tree));
            },
        };
    });
