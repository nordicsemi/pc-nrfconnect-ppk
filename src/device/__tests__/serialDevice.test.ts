/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

/* eslint-disable @typescript-eslint/no-require-imports, global-require */

import EventEmitter from 'events';

const mockChild = Object.assign(new EventEmitter(), {
    send: jest.fn(),
    kill: jest.fn(),
    pid: 12345,
    connected: true,
    disconnect: jest.fn(),
    unref: jest.fn(),
    ref: jest.fn(),
    killed: false,
    exitCode: null,
    signalCode: null,
    channel: undefined,
    stdio: [null, null, null, null],
    stdin: null,
    stdout: null,
    stderr: null,
});

jest.mock('@nordicsemiconductor/pc-nrfconnect-shared', () => ({
    getAppDir: jest.fn(() => '/mock/app'),
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));

jest.mock(
    '@nordicsemiconductor/pc-nrfconnect-shared/nrfutil/device/common',
    () => ({}),
);

jest.mock('child_process', () => ({
    fork: jest.fn(() => mockChild),
}));

const originalPlatform = process.platform;

describe('SerialDevice', () => {
    const mockDevice = {
        serialPorts: [{ comName: '/dev/tty.test' }],
    };
    const mockCallback = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        mockChild.removeAllListeners();
    });

    afterAll(() => {
        Object.defineProperty(process, 'platform', {
            value: originalPlatform,
        });
    });

    function loadSerialDevice() {
        const { fork } = require('child_process');
        const { default: SerialDevice } = require('../serialDevice');
        const { logger } = require('@nordicsemiconductor/pc-nrfconnect-shared');
        return { SerialDevice, fork, logger };
    }

    test('uses serialDevice.darwin.js worker on macOS', () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        jest.resetModules();

        const { SerialDevice, fork } = loadSerialDevice();
        const device = new SerialDevice(mockDevice, mockCallback);

        expect(device).toBeDefined();
        expect(fork).toHaveBeenCalledWith(
            expect.stringContaining('serialDevice.darwin.js'),
        );
    });

    test('uses serialDevice.js worker on Linux', () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        jest.resetModules();

        const { SerialDevice, fork } = loadSerialDevice();
        const device = new SerialDevice(mockDevice, mockCallback);

        expect(device).toBeDefined();
        expect(fork).toHaveBeenCalledWith(
            expect.stringContaining('serialDevice.js'),
        );
        expect(fork).not.toHaveBeenCalledWith(
            expect.stringContaining('darwin'),
        );
    });

    test('uses serialDevice.js worker on Windows', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        jest.resetModules();

        const { SerialDevice, fork } = loadSerialDevice();
        const device = new SerialDevice(mockDevice, mockCallback);

        expect(device).toBeDefined();
        expect(fork).toHaveBeenCalledWith(
            expect.stringContaining('serialDevice.js'),
        );
        expect(fork).not.toHaveBeenCalledWith(
            expect.stringContaining('darwin'),
        );
    });

    test('logs error messages from worker via logger.error', () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        jest.resetModules();

        const { SerialDevice, logger } = loadSerialDevice();
        const device = new SerialDevice(mockDevice, mockCallback);
        device.parser = jest.fn();

        mockChild.emit('message', { error: 'PPK command failed' });

        expect(logger.error).toHaveBeenCalledWith('PPK command failed');
    });

    test('passes buffer data to parser', () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        jest.resetModules();

        const { SerialDevice } = loadSerialDevice();
        const device = new SerialDevice(mockDevice, mockCallback);
        const parserMock = jest.fn();
        device.parser = parserMock;

        const testData = [1, 2, 3, 4];
        mockChild.emit('message', { type: 'Buffer', data: testData });

        expect(parserMock).toHaveBeenCalledWith(Buffer.from(testData));
    });
});
