/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import {
    type AppThunk,
    telemetry,
} from '@nordicsemiconductor/pc-nrfconnect-shared';
import fs from 'fs';

import { resetCache } from '../components/Chart/data/dataAccumulator';
import { DataManager } from '../globals';
import { type RootState } from '../slices';
import { getDiskFullTrigger, getSessionRootFolder } from '../slices/appSlice';
import {
    type RecordingMode,
    resetChartTime,
    resetCursor,
} from '../slices/chartSlice';
import {
    getDigitalChannelsTriggerLogic,
    getDigitalChannelsTriggersStates,
    getTriggerCategory,
    getTriggerEdge,
    getTriggerOffset,
    getTriggerRecordingLength,
    getTriggerType,
    getTriggerValue,
    resetTriggerOrigin,
} from '../slices/triggerSlice';
import { getFreeSpace } from '../utils/fileUtils';
import { isScopePane } from '../utils/panes';
import { samplingStart } from './deviceActions';

export type StartSamplingResult =
    | {
          ok: true;
          /** Free space in bytes, only measured in Data Logger mode. */
          freeSpace?: number;
      }
    | {
          ok: false;
          error: 'temp_disk_missing' | 'disk_full';
          message: string;
          /** Free space in bytes, only measured in Data Logger mode. */
          freeSpace?: number;
      };

/**
 * Clears the previous session and starts sampling, exactly like the Start
 * button of the side panel. Failures are returned instead of only logged, so
 * that callers other than the UI can report them.
 *
 * @returns {AppThunk} thunk resolving to the outcome of the start attempt
 */
export const startSamplingSession =
    (): AppThunk<RootState, Promise<StartSamplingResult>> =>
    async (dispatch, getState) => {
        await DataManager().reset();
        dispatch(resetChartTime());
        dispatch(resetTriggerOrigin());
        dispatch(resetCursor());
        resetCache();

        const state = getState();
        const mode: RecordingMode = isScopePane(state) ? 'Scope' : 'DataLogger';
        const sessionFolder = getSessionRootFolder(state);
        const diskFullTrigger = getDiskFullTrigger(state);
        const triggerCategory = getTriggerCategory(state);

        const telemetryMetadata = {
            mode,
            ...(mode === 'DataLogger' && {
                samplesPerSecond: DataManager().getSamplesPerSecond(),
            }),
            ...(mode === 'Scope' && {
                triggerRecordingLength: getTriggerRecordingLength(state),
                triggerOffset: getTriggerOffset(state),
                triggerCategory,
                triggerType: getTriggerType(state),
                ...(triggerCategory === 'Analog' && {
                    triggerValue: getTriggerValue(state),
                    triggerEdge: getTriggerEdge(state),
                }),
                ...(triggerCategory === 'Digital' && {
                    triggerLogic: getDigitalChannelsTriggerLogic(state),
                    triggerStates: getDigitalChannelsTriggersStates(state),
                }),
            }),
        };

        telemetry.sendEvent('StartSampling', telemetryMetadata);

        let freeSpace: number | undefined;
        if (mode === 'DataLogger') {
            if (!fs.existsSync(sessionFolder)) {
                return {
                    ok: false,
                    error: 'temp_disk_missing',
                    message: `Temp Disk root folder '${sessionFolder}' does not exists. Change the root directory in the Temp Disk settings on the side panel.`,
                };
            }

            freeSpace = Math.max(
                0,
                await getFreeSpace(diskFullTrigger, sessionFolder),
            );

            if (freeSpace === 0) {
                return {
                    ok: false,
                    error: 'disk_full',
                    message:
                        'Disk is full. Unable to start sampling. Change the disk full trigger threshold or free up disk memory.',
                    freeSpace,
                };
            }
        }

        await dispatch(samplingStart());
        return { ok: true, freeSpace };
    };
