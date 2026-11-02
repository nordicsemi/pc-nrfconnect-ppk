/*
 * Copyright (c) 2022 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

const sharedConfig = require('@nordicsemiconductor/pc-nrfconnect-shared/config/jest.config');

module.exports = {
    ...sharedConfig(),
    // jsdom as before; adds the Fetch API for the remote control tests only
    testEnvironment:
        '<rootDir>/src/features/remoteControl/__testUtils__/fetchEnvironment.js',
};
