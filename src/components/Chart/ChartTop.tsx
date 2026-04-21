/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React, { type MutableRefObject } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Dialog,
    InfoDialog,
    Toggle,
} from '@nordicsemiconductor/pc-nrfconnect-shared';
import { type BigNumber, type Fraction, unit } from 'mathjs';

import { isSamplingRunning } from '../../slices/appSlice';
import {
    getChartYAxisRange,
    getLiveModeFPS,
    setShowSettings,
    showChartSettings,
    toggleYAxisLock,
    toggleYAxisLog,
} from '../../slices/chartSlice';
import { dataLoggerState } from '../../slices/dataLoggerSlice';
import { isDataLoggerPane } from '../../utils/panes';
import { type AmpereChartJS } from './AmpereChart';
import ChartOptions from './ChartOptions';

type TimeWindowButton = {
    label: string;
    zoomToWindow: (duration: number | BigNumber | Fraction) => void;
};
const TimeWindowButton = ({ label, zoomToWindow }: TimeWindowButton) => (
    <button
        type="button"
        className="tw-h-5 tw-w-12 tw-min-w-[3rem] tw-border tw-border-solid tw-border-gray-200 tw-bg-white tw-text-xs tw-text-gray-700 hover:tw-bg-gray-50 active:enabled:tw-bg-gray-50 lg:tw-w-16"
        onClick={() => zoomToWindow(unit(label).to('us').toNumeric())}
    >
        {label}
    </button>
);

type ChartTop = {
    onLiveModeChange: (live: boolean) => void;
    live: boolean;
    zoomToWindow: (windowDuration: number | BigNumber | Fraction) => void;
    chartRef: MutableRefObject<AmpereChartJS | null>;
    windowDuration: number;
};

const ChartTop = ({
    onLiveModeChange,
    live,
    zoomToWindow,
    chartRef,
    windowDuration,
}: ChartTop) => {
    const dispatch = useDispatch();
    const { maxFreqLog10, sampleFreqLog10 } = useSelector(dataLoggerState);
    const samplingRunning = useSelector(isSamplingRunning);
    const fps = useSelector(getLiveModeFPS);
    const dataLoggerPane = useSelector(isDataLoggerPane);
    const { yMin, yMax } = useSelector(getChartYAxisRange);
    const yAxisLock = yMin != null && yMax != null;

    const timeWindowLabels = [
        '10ms',
        '100ms',
        '1s',
        '3s',
        '10s',
        '1min',
        '10min',
        '1h',
        '6h',
        '1day',
        '1week',
    ].slice(maxFreqLog10 - sampleFreqLog10, maxFreqLog10 - sampleFreqLog10 + 6);

    return (
        <div className="tw-relative tw-flex tw-w-full tw-flex-row tw-flex-wrap tw-justify-between tw-gap-y-2 tw-py-2 tw-pl-[4.3rem] tw-pr-[1.8rem]">
            <button
                className="tw-h-5.5 tw-absolute tw-left-8 tw-flex tw-w-fit tw-border-none tw-bg-white tw-text-gray-700 hover:tw-bg-gray-50"
                type="button"
                title="Y-Axis Settings"
                onClick={() => dispatch(setShowSettings(true))}
            >
                <span className="mdi mdi-cog" />
            </button>
            <div className="tw-w-38 tw-order-1 tw-flex tw-items-center tw-gap-x-4">
                <Toggle
                    title="Enable in order to explicitly set the start and end of the y-axis"
                    label="Lock Y-axis"
                    onToggle={() => {
                        if (yAxisLock) {
                            dispatch(
                                toggleYAxisLock({
                                    yMin: null,
                                    yMax: null,
                                }),
                            );
                            zoomToWindow(windowDuration);
                        } else {
                            const { min, max } = chartRef.current?.scales
                                ?.yScale ?? {
                                min: null,
                                max: null,
                            };
                            dispatch(
                                toggleYAxisLock({
                                    yMin: min,
                                    yMax: max,
                                }),
                            );
                        }
                    }}
                    isToggled={yMin != null && yMax != null}
                    variant="primary"
                />
            </div>

            {dataLoggerPane && (
                <>
                    <div className="tw-order-2 tw-flex tw-w-full tw-flex-row tw-justify-center tw-gap-x-2 tw-place-self-start xl:tw-order-1 xl:tw-w-fit xl:tw-place-self-auto">
                        {timeWindowLabels.map(label => (
                            <TimeWindowButton
                                label={label}
                                key={label}
                                zoomToWindow={zoomToWindow}
                            />
                        ))}
                    </div>
                    <div className="tw-w-38 tw-order-1 tw-flex tw-flex-row tw-justify-end">
                        <Toggle
                            label={`${live && fps > 0 ? `(${fps} FPS) ` : ''}LIVE VIEW`}
                            onToggle={onLiveModeChange}
                            isToggled={live}
                            variant="primary"
                            disabled={!samplingRunning}
                        />
                    </div>
                </>
            )}

            <ChartSettingsDialog
                zoomToWindow={zoomToWindow}
                chartRef={chartRef}
                windowDuration={windowDuration}
            />
        </div>
    );
};

const ChartSettingsDialog = ({
    zoomToWindow,
    chartRef,
    windowDuration,
}: {
    zoomToWindow: (windowDuration: number | BigNumber | Fraction) => void;
    chartRef: MutableRefObject<AmpereChartJS | null>;
    windowDuration: number;
}) => {
    const dispatch = useDispatch();
    const showSettings = useSelector(showChartSettings);
    const { yMin, yMax, yAxisLog } = useSelector(getChartYAxisRange);

    const yAxisLock = yMin != null && yMax != null;

    return (
        <InfoDialog
            title="Chart Settings"
            headerIcon="cog"
            isVisible={showSettings}
            onHide={() => dispatch(setShowSettings(false))}
        >
            <Dialog.Body>
                <div className="tw-w-1/3 tw-py-2">
                    <Toggle
                        title="Enable in order to make the scale on the y-axis logarithmic"
                        label="Logarithmic Y-axis"
                        onToggle={() => {
                            dispatch(toggleYAxisLog());
                        }}
                        isToggled={yAxisLog}
                        variant="primary"
                    />
                </div>
                <div>
                    <div className="tw-w-1/3 tw-py-2">
                        <Toggle
                            title="Enable in order to explicitly set the start and end of the y-axis"
                            label="Lock Y-axis"
                            onToggle={() => {
                                if (yAxisLock) {
                                    dispatch(
                                        toggleYAxisLock({
                                            yMin: null,
                                            yMax: null,
                                        }),
                                    );
                                    zoomToWindow(windowDuration);
                                } else {
                                    const { min, max } = chartRef.current
                                        ?.scales?.yScale ?? {
                                        min: null,
                                        max: null,
                                    };
                                    dispatch(
                                        toggleYAxisLock({
                                            yMin: min,
                                            yMax: max,
                                        }),
                                    );
                                }
                            }}
                            isToggled={yMin != null && yMax != null}
                            variant="primary"
                        />
                    </div>
                    <ChartOptions />
                </div>
            </Dialog.Body>
        </InfoDialog>
    );
};

export default ChartTop;
