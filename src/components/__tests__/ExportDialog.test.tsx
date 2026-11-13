/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React from 'react';
import type { AnyAction } from 'redux';

import { indexToTimestamp } from '../../globals';
import { showExportDialog } from '../../slices/appSlice';
import { chartCursorAction, chartWindowAction } from '../../slices/chartSlice';
import { fireEvent, render, screen } from '../../utils/testUtils';
import ExportDialog from '../SaveExport/ExportDialog';

jest.mock('../../features/recovery/SessionsListFileHandler', () => ({
    ReadSessions: jest.fn(() => []),
    WriteSessions: jest.fn(),
    SessionFlag: {
        NotRecovered: 0,
        Recovered: 1,
        PPK2Loaded: 2,
    },
}));

jest.mock('../../utils/persistentStore', () => ({
    getLastSaveDir: () => 'mocked/save/dir',
    getMaxBufferSize: () => 200,
    getVoltageRegulatorMaxCapPPK1: () => 3600,
    getVoltageRegulatorMaxCapPPK2: () => 5000,
    getDigitalChannels: () => [
        true,
        true,
        false,
        false,
        false,
        false,
        false,
        false,
    ],
    getDigitalChannelsVisible: () => true,
    getTimestampsVisible: () => false,
    getTraceValueVisible: () => false,
    getSpikeFilter: () => ({ samples: 3, alpha: 0.18, alpha5: 0.06 }),
    getSamplingMode: () => 'Live',
    getTriggerLevel: () => 1000,
    getRecordingLength: () => 1000,
    getTriggerOffset: () => 0,
    getAutoExport: () => false,
    getTriggerType: () => 'Single',
    getTriggerEdge: () => 'Rising Edge',
    getDigitalChannelsTriggerLogic: () => 'AND',
    getTriggerCategory: () => 'Analog',
    getDigitalChannelsTriggers: () => [
        'Active',
        'Active',
        'Inactive',
        'Inactive',
        'Inactive',
        'Inactive',
        'Inactive',
        'Inactive',
    ],
}));

const getTimestampMock = jest.fn(() => 0);

jest.mock('../../globals', () => {
    const temp = jest.requireActual('../../globals');
    return {
        ...temp,
        DataManager: () => ({
            ...temp,
            getTimestamp: getTimestampMock,
        }),
    };
});

const initialStateActions = [
    chartWindowAction(1_000_000, 1_000_000),
    showExportDialog(),
] as AnyAction[];

describe('ExportDialog', () => {
    const totalSizeLargerThanZeroPattern = /[1-9][0-9]*\sMB/;
    const durationLargerThanZeroPattern = /[0-9][0-9]*\ss/;

    test('should show the number of records for the whole sample when exporting "All"', () => {
        const expectedNumberOfRecords = 2_000_000;
        const numberOfRecordsText = `${expectedNumberOfRecords} records`;

        getTimestampMock.mockImplementation(() =>
            indexToTimestamp(expectedNumberOfRecords),
        );

        render(<ExportDialog />, initialStateActions);

        const buttonToSelectAll = screen.getByText('All');
        fireEvent.click(buttonToSelectAll);

        const numberOfRecords = screen.getByText(numberOfRecordsText);
        expect(numberOfRecords).not.toBeUndefined();
        const totalSize = screen.getByText(totalSizeLargerThanZeroPattern);
        expect(totalSize).not.toBeUndefined();
        const duration = screen.getByText(durationLargerThanZeroPattern);
        expect(duration).not.toBeUndefined();
    });

    test('should show the number of records only inside the window', () => {
        const expectedNumberOfRecords = 100_000;
        const numberOfRecordsText = '100000 records';

        getTimestampMock.mockImplementation(() =>
            indexToTimestamp(expectedNumberOfRecords),
        );

        render(<ExportDialog />, initialStateActions);
        const radioWindow = screen.getByText('Window');
        fireEvent.click(radioWindow);

        const numberOfRecords = screen.getByText(numberOfRecordsText);
        expect(numberOfRecords).toBeDefined();
        const totalSize = screen.getByText(totalSizeLargerThanZeroPattern);
        expect(totalSize).toBeDefined();
        const duration = screen.getByText(durationLargerThanZeroPattern);
        expect(duration).toBeDefined();
    });

    test('should open with the last option to export the selected area when area has been selected', () => {
        const numberOfRecordsText = '80000 records';

        render(<ExportDialog />, [
            chartCursorAction({ cursorBegin: 1, cursorEnd: 800000 }),
            ...initialStateActions,
            // Chart cursor uses timestamps, and the default sampling rate is 100_000 samples/sec
            // which means that there will be (0.8 - 0.000001) * 100_000 = 7999 samples + 1 header => 400 Records
        ]);

        const numberOfRecords = screen.getByText(numberOfRecordsText);
        expect(numberOfRecords).not.toBe(undefined);
        const totalSize = screen.getByText(totalSizeLargerThanZeroPattern);
        expect(totalSize).not.toBe(undefined);
        const duration = screen.getByText(durationLargerThanZeroPattern);
        expect(duration).not.toBe(undefined);
    });
});
