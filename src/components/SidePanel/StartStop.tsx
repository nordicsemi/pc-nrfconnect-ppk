/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    type AppDispatch,
    ConfirmationDialog,
    logger,
    StartStopButton,
    telemetry,
} from '@nordicsemiconductor/pc-nrfconnect-shared';
import { unit } from 'mathjs';

import { samplingStop } from '../../actions/deviceActions';
import { startSamplingSession } from '../../actions/samplingSessionActions';
import { DataManager } from '../../globals';
import {
    appState,
    getDiskFullTrigger,
    getSessionRootFolder,
    isSavePending,
} from '../../slices/appSlice';
import { getRecordingMode } from '../../slices/chartSlice';
import {
    dataLoggerState,
    getSampleFrequency,
} from '../../slices/dataLoggerSlice';
import { convertTimeToSeconds, formatDuration } from '../../utils/duration';
import {
    calcFileSize,
    getFreeSpace,
    remainingTime as calcRemainingTime,
} from '../../utils/fileUtils';
import { isDataLoggerPane } from '../../utils/panes';
import {
    getDoNotAskStartAndClear,
    setDoNotAskStartAndClear,
} from '../../utils/persistentStore';

const fmtOpts = { notation: 'fixed' as const, precision: 1 };

const calcFileSizeString = (sampleFreq: number, durationSeconds: number) => {
    const bytes = sampleFreq * durationSeconds * 6;
    return calcFileSize(bytes, fmtOpts);
};

export default () => {
    const dispatch = useDispatch<AppDispatch>();

    const onWriteListener = useRef<() => void>();
    const dataLoggerPane = useSelector(isDataLoggerPane);
    const recordingMode = useSelector(getRecordingMode);
    const { samplingRunning } = useSelector(appState);
    const { duration, durationUnit } = useSelector(dataLoggerState);
    const sampleFreq = useSelector(getSampleFrequency);
    const savePending = useSelector(isSavePending);
    const sessionFolder = useSelector(getSessionRootFolder);
    const diskFullTrigger = useSelector(getDiskFullTrigger);

    const sampleIndefinitely = durationUnit === 'inf';

    const startButtonTooltip = `Start sampling at ${unit(sampleFreq, 'Hz')
        .format(fmtOpts)
        .replace('.0', '')}`;

    const startStopTitle = !samplingRunning ? startButtonTooltip : undefined;

    const [showDialog, setShowDialog] = useState(false);

    const startAndClear = async () => {
        setShowDialog(false);

        const result = await dispatch(startSamplingSession());

        if (result.freeSpace !== undefined) setFreeSpace(result.freeSpace);

        if (!result.ok) {
            if (result.error === 'temp_disk_missing') {
                logger.error(result.message);
            } else {
                logger.warn(result.message);
            }
            return;
        }

        onWriteListener.current?.();
        onWriteListener.current = DataManager().onFileWrite(() => {
            getFreeSpace(diskFullTrigger, sessionFolder).then(s => {
                setFreeSpace(Math.max(0, s));
            });
        });
    };

    const [freeSpace, setFreeSpace] = useState<number>(0);

    useEffect(() => {
        if (!dataLoggerPane) return;

        const action = () => {
            getFreeSpace(diskFullTrigger, sessionFolder).then(space => {
                setFreeSpace(Math.max(0, space));
            });
        };
        action();
        const timerId = setInterval(action, 5000);
        return () => {
            clearInterval(timerId);
        };
    }, [dataLoggerPane, diskFullTrigger, sessionFolder]);

    const [remainingTime, setRemainingTime] = useState<number>(0);

    useEffect(() => {
        setRemainingTime(calcRemainingTime(freeSpace, sampleFreq));
    }, [freeSpace, sampleFreq]);

    return (
        <>
            <div className="tw-flex tw-flex-col tw-gap-2">
                <StartStopButton
                    title={startStopTitle}
                    startText="Start"
                    stopText="Stop"
                    onClick={async () => {
                        if (samplingRunning) {
                            onWriteListener.current?.();
                            dispatch(samplingStop());
                            telemetry.sendEvent('StopSampling', {
                                mode: recordingMode,
                                duration: DataManager().getTimestamp(),
                                samplesPerSecond:
                                    DataManager().getSamplesPerSecond(),
                            });
                            return;
                        }

                        if (
                            DataManager().getTimestamp() > 0 &&
                            !getDoNotAskStartAndClear(false) &&
                            savePending
                        ) {
                            setShowDialog(true);
                        } else {
                            await startAndClear();
                        }
                    }}
                    showIcon
                    variant="secondary"
                    started={samplingRunning}
                />
                {dataLoggerPane && (
                    <div className="tw-border tw-border-solid tw-border-gray-200 tw-p-2 tw-text-[10px] tw-text-gray-400">
                        {!sampleIndefinitely && (
                            <div>
                                {`Estimated disk space required ${calcFileSizeString(
                                    sampleFreq,
                                    convertTimeToSeconds(
                                        duration,
                                        durationUnit,
                                    ),
                                )}. Current available space ${calcFileSize(
                                    freeSpace,
                                )}`}
                            </div>
                        )}
                        {sampleIndefinitely && (
                            <div>
                                {`Estimated space limit ~${formatDuration(
                                    remainingTime,
                                )} at ${calcFileSizeString(
                                    sampleFreq,
                                    convertTimeToSeconds(1, 'h'),
                                )}/h. Available disk space ${calcFileSize(
                                    freeSpace,
                                )}`}
                            </div>
                        )}
                    </div>
                )}
            </div>
            <ConfirmationDialog
                confirmLabel="Yes"
                cancelLabel="No"
                onConfirm={startAndClear}
                onCancel={() => {
                    setShowDialog(false);
                }}
                onOptional={async () => {
                    setDoNotAskStartAndClear(true);
                    await startAndClear();
                }}
                optionalLabel="Yes, don't ask again"
                isVisible={showDialog}
            >
                You have unsaved data and this will be lost. Are you sure you
                want to proceed?
            </ConfirmationDialog>
        </>
    );
};
