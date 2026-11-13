/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { type AppThunk } from '@nordicsemiconductor/pc-nrfconnect-shared';
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { DataManager, microSecondsPerSecond } from '../globals';
import {
    type booleanTupleOf8,
    getDigitalChannels,
    getDigitalChannelsVisible,
    getTimestampsVisible,
    getTraceValueVisible,
    setDigitalChannels as persistDigitalChannels,
    setDigitalChannelsVisible as persistDigitalChannelsVisible,
    setTimestampsVisible as persistTimestampsVisible,
    setTraceValueVisible as persistTraceValueVisible,
} from '../utils/persistentStore';
import type { RootState } from '.';
import { getSampleFrequency } from './dataLoggerSlice';

export type RecordingMode = 'DataLogger' | 'Scope';

export interface ChartState {
    liveMode: boolean;
    fps: number;
    cursorBegin?: null | number;
    cursorEnd?: null | number;
    windowEnd: number;
    windowDuration: number;
    yMin?: null | number;
    yMax?: null | number;
    digitalChannels: booleanTupleOf8;
    digitalChannelsVisible: boolean;
    timestampsVisible: boolean;
    traceValueVisible: boolean;
    showSystemTime: boolean;
    yAxisLog: boolean;
    windowBeginLock: null | number;
    windowEndLock: null | number;
    showSettings: boolean;
    latestDataTimestamp: number;
    forceRerender: boolean;
    recordingMode?: RecordingMode;
}

const initialWindowDuration = 10 * microSecondsPerSecond;
const initialState = (): ChartState => ({
    liveMode: true,
    fps: 30,
    cursorBegin: null, // [microseconds]
    cursorEnd: null, // [microseconds]
    windowEnd: initialWindowDuration, // [microseconds]
    windowDuration: initialWindowDuration, // [microseconds]
    yMin: null,
    yMax: null,
    digitalChannels: getDigitalChannels(),
    digitalChannelsVisible: getDigitalChannelsVisible(),
    timestampsVisible: getTimestampsVisible(),
    traceValueVisible: getTraceValueVisible(),
    yAxisLog: false,
    windowBeginLock: null, // [microseconds]
    windowEndLock: null, // [microseconds]
    showSettings: false,
    latestDataTimestamp: 0,
    forceRerender: false,
    showSystemTime: false,
});

export const MIN_WINDOW_DURATION = 5e7;
export const MAX_WINDOW_DURATION = 1.2e13;
const Y_MIN = 0;
const Y_MAX = 1200000000;

const chartSlice = createSlice({
    name: 'chart',
    initialState: initialState(),
    reducers: {
        resetChartTime: state => {
            state.latestDataTimestamp = 0;
        },
        setYMax: (state, action: PayloadAction<{ yMax: number }>) => {
            state.yMax = action.payload.yMax;
        },
        setYMin: (state, action: PayloadAction<{ yMin: number }>) => {
            state.yMin = action.payload.yMin;
        },
        triggerForceRerender: state => {
            state.forceRerender = !state.forceRerender;
        },
        chartCursorAction: (
            state,
            action: PayloadAction<{
                cursorBegin: null | number;
                cursorEnd: null | number;
            }>,
        ) => {
            const end =
                action.payload.cursorEnd != null
                    ? Math.max(
                          0,
                          Math.min(
                              DataManager().getTimestamp(),
                              action.payload.cursorEnd,
                          ),
                      )
                    : null;
            const begin =
                action.payload.cursorBegin != null
                    ? Math.min(
                          Math.max(0, action.payload.cursorBegin),
                          DataManager().getTimestamp(),
                      )
                    : null;

            state.cursorBegin = begin;
            state.cursorEnd = end;
        },
        chartWindow(
            state,
            action: PayloadAction<{
                windowEnd: number;
                windowDuration: number;
                yMin?: null | number;
                yMax?: null | number;
            }>,
        ) {
            let { yMin, yMax } = action.payload;

            if (yMin != null && yMax != null) {
                const p0 = Math.max(0, Y_MIN - yMin);
                const p1 = Math.max(0, yMax - Y_MAX);
                if (p0 * p1 === 0) {
                    yMin = yMin - p1 + p0;
                    yMax = yMax - p1 + p0;
                }
            }

            let { windowEnd, windowDuration } = action.payload;
            let windowBegin = Math.max(0, windowEnd - windowDuration);

            const { windowBeginLock, windowEndLock } = state;

            if (windowBeginLock !== null) {
                windowBegin = Math.max(windowBeginLock, windowBegin);
                windowEnd = windowBegin - (windowEndLock ?? 0);
                windowDuration = windowEnd - windowBegin;
            }

            if (windowEnd > DataManager().getTimestamp()) {
                windowEnd = Math.max(
                    windowDuration,
                    DataManager().getTimestamp(),
                );
            }

            return {
                ...state,
                windowEnd,
                windowDuration,
                yMin: yMin ?? state.yMin,
                yMax: yMax ?? state.yMax,
            };
        },
        panWindow(state, { payload: windowCenter }: PayloadAction<number>) {
            const windowEnd = windowCenter + state.windowDuration / 2;

            if (Number.isNaN(windowEnd)) return;

            state.windowEnd = windowEnd;
            state.liveMode = windowEnd >= DataManager().getTimestamp();
        },
        chartTrigger(
            state,
            action: PayloadAction<{
                windowBegin: number;
                windowEnd: number;
                windowDuration: number;
            }>,
        ) {
            const { windowBegin, windowEnd, windowDuration } = action.payload;

            return {
                ...state,
                windowBegin,
                windowEnd,
                windowDuration,
                initialWindowDuration,
                windowBeginLock: windowBegin,
                windowEndLock: windowEnd,
            };
        },
        setDigitalChannels(
            state,
            action: PayloadAction<{ digitalChannels: booleanTupleOf8 }>,
        ) {
            const { digitalChannels } = action.payload;
            persistDigitalChannels(digitalChannels);
            return { ...state, digitalChannels };
        },
        toggleDigitalChannels: state => {
            const newVisibilityValue = !state.digitalChannelsVisible;
            persistDigitalChannelsVisible(newVisibilityValue);
            state.digitalChannelsVisible = newVisibilityValue;
        },
        toggleTimestamps: state => {
            const newVisibilityValue = !state.timestampsVisible;
            persistTimestampsVisible(newVisibilityValue);
            state.timestampsVisible = newVisibilityValue;
        },
        toggleTraceValue: state => {
            const newVisibilityValue = !state.traceValueVisible;
            persistTraceValueVisible(newVisibilityValue);
            state.traceValueVisible = newVisibilityValue;
        },
        toggleYAxisLock(
            state,
            action: PayloadAction<{ yMin: number | null; yMax: number | null }>,
        ) {
            return {
                ...state,
                yMin: action.payload?.yMin,
                yMax: action.payload?.yMax,
            };
        },
        toggleYAxisLog: state => {
            state.yAxisLog = !state.yAxisLog;
        },
        chartWindowLockAction: state => {
            state.windowBeginLock = Math.max(
                0,
                state.windowEnd - state.windowDuration,
            );
            state.windowEndLock = state.windowEnd;
        },
        chartWindowUnLockAction: state => {
            state.windowBeginLock = null;
            state.windowEndLock = null;
        },
        setShowSettings: (state, action: PayloadAction<boolean>) => {
            state.showSettings = action.payload;
        },
        setLatestDataTimestamp: (state, action: PayloadAction<number>) => {
            state.latestDataTimestamp = action.payload;
        },
        setLiveMode: (state, action: PayloadAction<boolean>) => {
            state.liveMode = action.payload;
        },
        setFPS: (state, action: PayloadAction<number>) => {
            state.fps = action.payload;
        },
        setShowSystemTime: (state, action: PayloadAction<boolean>) => {
            state.showSystemTime = action.payload;
        },
        setRecordingMode: (state, action: PayloadAction<RecordingMode>) => {
            state.recordingMode = action.payload;
        },
        clearRecordingMode: state => {
            state.recordingMode = undefined;
        },
    },
});

const calculateDuration = (
    sampleFrequency: number,
    windowDuration: number,
): number =>
    Math.min(
        MAX_WINDOW_DURATION / sampleFrequency,
        Math.max(MIN_WINDOW_DURATION / sampleFrequency, windowDuration),
    );

export const chartWindowAction =
    (
        windowEnd: number,
        windowDuration: number,
        yMin?: number | null,
        yMax?: number | null,
    ): AppThunk<RootState> =>
    (dispatch, getState) => {
        const sampleFreq = getSampleFrequency(getState());
        const duration = calculateDuration(sampleFreq, windowDuration);

        dispatch(
            chartWindow({
                windowEnd,
                windowDuration: duration,
                yMin,
                yMax,
            }),
        );

        if (windowEnd >= DataManager().getTimestamp()) {
            dispatch(setLiveMode(true));
        }
    };

export const animationAction =
    (): AppThunk<RootState> => (dispatch, getState) => {
        dispatch(setLatestDataTimestamp(DataManager().getTimestamp()));
        if (isLiveMode(getState())) {
            dispatch(scrollToEnd());
        }
    };

export const resetCursor = () =>
    chartCursorAction({ cursorBegin: null, cursorEnd: null });

export const scrollToEnd = (): AppThunk<RootState> => (dispatch, getState) =>
    dispatch(
        chartWindowAction(
            Math.max(
                DataManager().getTimestamp(),
                getWindowDuration(getState()),
            ),
            getWindowDuration(getState()),
        ),
    );

export const resetCursorAndChart = (): AppThunk<RootState> => dispatch => {
    dispatch(scrollToEnd());
    dispatch(resetCursor());
};

export const getWindowDuration = (state: RootState) =>
    state.app.chart.windowDuration;
export const showChartSettings = (state: RootState) =>
    state.app.chart.showSettings;
export const getChartXAxisRange = (state: RootState) => {
    const windowEnd = Math.max(
        state.app.chart.liveMode
            ? DataManager().getTimestamp()
            : state.app.chart.windowEnd,
        state.app.chart.windowDuration,
    );

    const windowDuration = state.app.chart.windowDuration;
    const windowBegin = Math.max(0, windowEnd - windowDuration);

    return {
        xAxisMax: state.app.chart.latestDataTimestamp,
        windowEnd,
        windowBegin,
        windowDuration,
        windowBeginLock: state.app.chart.windowBeginLock,
        windowEndLock: state.app.chart.windowEndLock,
    };
};
export const getChartYAxisRange = (state: RootState) => {
    let yMin = state.app.chart.yMin;
    if (state.app.chart.yMin == null) {
        yMin =
            state.app.chart.latestDataTimestamp === 0
                ? 0
                : state.app.chart.yMin;
    }
    return {
        yMax: state.app.chart.yMax,
        yMin,
        yAxisLog: state.app.chart.yAxisLog,
        yAxisLock: state.app.chart.yMax != null && yMin != null,
    };
};

export const getCursorRange = (state: RootState) => ({
    cursorBegin: state.app.chart.cursorBegin,
    cursorEnd: state.app.chart.cursorEnd,
});

export const getChartDigitalChannelInfo = (state: RootState) => ({
    digitalChannels: state.app.chart.digitalChannels,
    digitalChannelsVisible: state.app.chart.digitalChannelsVisible,
});

export const isLiveMode = (state: RootState) =>
    state.app.chart.liveMode && state.app.app.samplingRunning;
export const getLiveModeFPS = (state: RootState) => state.app.chart.fps;
export const isTimestampsVisible = (state: RootState) =>
    state.app.chart.timestampsVisible;
export const isTraceValueVisible = (state: RootState) =>
    state.app.chart.traceValueVisible;
export const showSystemTime = (state: RootState) =>
    state.app.chart.showSystemTime;

export const isSessionActive = (state: RootState) =>
    state.app.chart.latestDataTimestamp !== 0;

export const getForceRerender = (state: RootState) =>
    state.app.chart.forceRerender;

export const getRecordingMode = (state: RootState) =>
    state.app.chart.recordingMode;

export const {
    setLatestDataTimestamp,
    panWindow,
    chartCursorAction,
    chartTrigger,
    chartWindow,
    chartWindowLockAction,
    chartWindowUnLockAction,
    setDigitalChannels,
    setYMin,
    setYMax,
    toggleDigitalChannels,
    toggleTimestamps,
    toggleTraceValue,
    toggleYAxisLock,
    toggleYAxisLog,
    setShowSettings,
    setLiveMode,
    setFPS,
    resetChartTime,
    triggerForceRerender,
    setShowSystemTime,
    setRecordingMode,
    clearRecordingMode,
} = chartSlice.actions;

export default chartSlice.reducer;
