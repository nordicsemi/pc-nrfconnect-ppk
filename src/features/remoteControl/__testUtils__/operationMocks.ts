/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

// The mocks of the operation tests; import it first, before anything of
// the app:
//
//   import '../__testUtils__/operationMocks';
//
// The data layer asks for the app data directory when it loads, the
// device thunks need a PPK, the settings are persisted, and the logger is
// checked by the tests.

jest.mock('@nordicsemiconductor/pc-nrfconnect-shared', () => ({
    ...jest.requireActual('@nordicsemiconductor/pc-nrfconnect-shared'),
    getAppDataDir: () => '/mock/app/data',
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
// A working electron-store for the persisted settings: the shared mock
// (moduleNameMapper) loses its implementation here.
jest.mock('electron-store', () =>
    jest.requireActual('./fakeModules').electronStoreMock(),
);
jest.mock('../../../globals', () =>
    jest.requireActual('./fakeModules').globalsMock(),
);
jest.mock('../../../actions/deviceActions', () =>
    jest.requireActual('./fakeModules').deviceActionsMock(),
);
