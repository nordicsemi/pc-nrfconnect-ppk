/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';
import {
    App,
    render,
    selectedDevice,
    telemetry,
} from '@nordicsemiconductor/pc-nrfconnect-shared';

import Chart from './components/Chart/Chart';
import DeviceSelector from './components/DeviceSelector';
import DocumentationSections from './components/DocumentationSections';
import SidePanel from './components/SidePanel/SidePanel';
import RecoveryDialogs from './features/recovery/RecoveryDialogs';
import { updateTitle } from './globals';
import reducers from './slices';
import { getFileLoaded, isSavePending } from './slices/appSlice';
import { getRecordingMode } from './slices/chartSlice';
import { useGlobalHotkeys } from './utils/globalHotkeys';
import { isDataLoggerPane, isScopePane, Panes } from './utils/panes';

import './index.scss';

telemetry.enableTelemetry();

const GlobalHotkeysProvider = () => {
    useGlobalHotkeys();
    return null;
};

const AppTitleHook = () => {
    const device = useSelector(selectedDevice);
    const fileName = useSelector(getFileLoaded);
    const pendingSave = useSelector(isSavePending);

    useEffect(() => {
        if (fileName) {
            updateTitle(fileName);
            return;
        }

        let title = '';
        if (device?.serialNumber) {
            title += device.serialNumber;
        }

        if (pendingSave) {
            title += ' - Unsaved data*';
        }

        updateTitle(title);
    }, [device, fileName, pendingSave]);

    return null;
};

const ChartWrapper: React.FC<{ active: boolean }> = ({ active }) => {
    const currentMode = useSelector(getRecordingMode);
    const dataLoggerPane = useSelector(isDataLoggerPane);
    const scopePane = useSelector(isScopePane);
    const paneName = currentMode === 'DataLogger' ? 'Data Logger' : 'Scope';

    if (
        (currentMode === 'DataLogger' && !dataLoggerPane) ||
        (currentMode === 'Scope' && !scopePane)
    )
        return (
            <div className="tw-flex tw-h-full tw-items-center tw-justify-center">
                <div>
                    Some small change.

                    Currently the device is running in {paneName} mode. Switch
                    to the <span className="tw-uppercase">{paneName}</span> tab
                    to see the results.
                </div>
            </div>
        );

    return active ? <Chart /> : null;
};

render(
    <App
        appReducer={reducers}
        deviceSelect={<DeviceSelector />}
        sidePanel={<SidePanel />}
        documentation={DocumentationSections}
        panes={[
            { name: Panes.DATA_LOGGER, Main: ChartWrapper },
            { name: Panes.SCOPE, Main: ChartWrapper },
        ]}
    >
        <GlobalHotkeysProvider />
        <RecoveryDialogs />
        <AppTitleHook />
    </App>,
);
