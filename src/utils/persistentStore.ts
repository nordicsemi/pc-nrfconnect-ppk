/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import {
    getAppDataDir,
    getPersistentStore,
} from '@nordicsemiconductor/pc-nrfconnect-shared';

import {
    type DigitalChannelTriggerLogic,
    type DigitalChannelTriggerStatesEnum,
    type TriggerCategory,
    type TriggerEdge,
    type TriggerType,
} from '../slices/triggerSlice';

const LAST_SAVE_DIR = 'lastSaveDir';
const SPIKE_FILTER_SAMPLES = 'spikeFilter.samples';
const SPIKE_FILTER_ALPHA = 'spikeFilter.alpha';
const SPIKE_FILTER_ALPHA5 = 'spikeFilter.alpha5';
const DIGITAL_CHANNELS_VISIBLE = 'digitalChannelsVisible';
const DIGITAL_CHANNELS = 'digitalChannels';
const DIGITAL_CHANNELS_TRIGGERS = 'digitalChannelsTriggers';
const TIMESTAMPS_VISIBLE = 'timestampsVisible';
const TRACE_VALUE_VISIBLE = 'traceValueVisible';
const VOLTAGE_REGULATOR_MAX_CAP_PPK2 = 'voltageRegulatorMaxCap';

const store = getPersistentStore<StoreSchema>({
    migrations: {
        '4.0.0': instance => {
            instance.set(VOLTAGE_REGULATOR_MAX_CAP_PPK2, 5000);
        },
    },
});

type SAMPLE_FREQUENCY = `sampleFreq-${number}`;
type DURATION_SECONDS = `durationSeconds-${number}`;

export interface SpikeFilter {
    samples: number;
    alpha: number;
    alpha5: number;
}

export type booleanTupleOf8 = [
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
];

export type digitalChannelStateTupleOf8 = [
    DigitalChannelTriggerStatesEnum,
    DigitalChannelTriggerStatesEnum,
    DigitalChannelTriggerStatesEnum,
    DigitalChannelTriggerStatesEnum,
    DigitalChannelTriggerStatesEnum,
    DigitalChannelTriggerStatesEnum,
    DigitalChannelTriggerStatesEnum,
    DigitalChannelTriggerStatesEnum,
];

export type TimeUnit = 's' | 'm' | 'h' | 'd' | 'inf';

interface StoreSchema {
    [LAST_SAVE_DIR]: string;
    [SPIKE_FILTER_SAMPLES]: number;
    [SPIKE_FILTER_ALPHA]: number;
    [SPIKE_FILTER_ALPHA5]: number;

    [DIGITAL_CHANNELS_VISIBLE]: boolean;
    [DIGITAL_CHANNELS]: booleanTupleOf8;
    [TIMESTAMPS_VISIBLE]: boolean;
    [TRACE_VALUE_VISIBLE]: boolean;

    [DIGITAL_CHANNELS_TRIGGERS]: digitalChannelStateTupleOf8;

    [VOLTAGE_REGULATOR_MAX_CAP_PPK2]: number;

    [maxSampleFrequency: SAMPLE_FREQUENCY]: number;
    [maxSampleFrequency: DURATION_SECONDS]: number;
}

export const getLastSaveDir = () => store.get(LAST_SAVE_DIR, getAppDataDir());
export const setLastSaveDir = (dir: string) => store.set('lastSaveDir', dir);

export const getSpikeFilter = (defaults: SpikeFilter): SpikeFilter => ({
    samples: store.get('spikeFilter.samples', defaults.samples),
    alpha: store.get('spikeFilter.alpha', defaults.alpha),
    alpha5: store.get('spikeFilter.alpha5', defaults.alpha5),
});
export const setSpikeFilter = ({ samples, alpha, alpha5 }: SpikeFilter) => {
    store.set('spikeFilter.samples', samples);
    store.set('spikeFilter.alpha', alpha);
    store.set('spikeFilter.alpha5', alpha5);
};

export const getDigitalChannels = () =>
    store.get(DIGITAL_CHANNELS, [
        true,
        true,
        false,
        false,
        false,
        false,
        false,
        false,
    ]);
export const setDigitalChannels = (digitalChannels: booleanTupleOf8) =>
    store.set(DIGITAL_CHANNELS, digitalChannels);

export const getDigitalChannelsVisible = () =>
    store.get(DIGITAL_CHANNELS_VISIBLE, true);
export const setDigitalChannelsVisible = (digitalChannelsVisible: boolean) =>
    store.set(DIGITAL_CHANNELS_VISIBLE, digitalChannelsVisible);

export const getTimestampsVisible = () => store.get(TIMESTAMPS_VISIBLE, false);
export const setTimestampsVisible = (timestampsVisible: boolean) =>
    store.set(TIMESTAMPS_VISIBLE, timestampsVisible);

export const getTraceValueVisible = () => store.get(TRACE_VALUE_VISIBLE, false);
export const setTraceValueVisible = (traceValueVisible: boolean) =>
    store.set(TRACE_VALUE_VISIBLE, traceValueVisible);

export const getSampleFreq = (maxSampleFreq: number) =>
    store.get(`sampleFreq-${maxSampleFreq}`, maxSampleFreq);
export const setSampleFreq = (maxSampleFreq: number, sampleFreq: number) =>
    store.set(`sampleFreq-${maxSampleFreq}`, sampleFreq);

export const getDuration = (maxSampleFreq: number, defaultValue: number) =>
    store.get(`duration-${maxSampleFreq}`, defaultValue);
export const setDuration = (maxSampleFreq: number, duration: number) => {
    store.set(`duration-${maxSampleFreq}`, duration);
};

export const getPreferredSessionLocation = (defaultValue: string) =>
    store.get(`session-root-folder`, defaultValue);
export const setPreferredSessionLocation = (path: string) => {
    store.set(`session-root-folder`, path);
};

export const getDiskFullTrigger = (defaultValue: number) =>
    store.get(`disk-full-trigger`, defaultValue);
export const setDiskFullTrigger = (sizeInMb: number) => {
    store.set(`disk-full-trigger`, sizeInMb);
};

export const getTriggerLevel = (defaultValue: number) =>
    store.get(`trigger-level-ua`, defaultValue);
export const setTriggerLevel = (value: number) => {
    store.set(`trigger-level-ua`, value);
};
export const getRecordingLength = (defaultValue: number) =>
    store.get(`recording-length-ms`, defaultValue);
export const setRecordingLength = (value: number) => {
    store.set(`recording-length-ms`, value);
};
export const getTriggerOffset = (defaultValue: number) =>
    store.get(`trigger-offset-ms`, defaultValue);
export const setTriggerOffset = (value: number) => {
    store.set(`trigger-offset-ms`, value);
};
export const getTriggerCategory = (defaultValue: TriggerCategory) =>
    store.get(`trigger-category`, defaultValue);
export const setTriggerCategory = (value: TriggerCategory) => {
    store.set(`trigger-category`, value);
};
export const getTriggerType = (defaultValue: TriggerType) =>
    store.get(`trigger-mode-type`, defaultValue);
export const setTriggerType = (value: TriggerType) => {
    store.set(`trigger-mode-type`, value);
};
export const getTriggerEdge = (defaultValue: TriggerEdge) =>
    store.get(`trigger-edge`, defaultValue);
export const setTriggerEdge = (value: TriggerEdge) => {
    store.set(`trigger-edge`, value);
};
export const getDigitalChannelsTriggerLogic = (
    defaultValue: DigitalChannelTriggerLogic,
) => store.get(`digital-channels-trigger-logic`, defaultValue);
export const setDigitalChannelsTriggerLogic = (
    value: DigitalChannelTriggerLogic,
) => {
    store.set(`digital-channels-trigger-logic`, value);
};
export const getDigitalChannelsTriggers = (
    defaultValue: digitalChannelStateTupleOf8,
) => store.get(DIGITAL_CHANNELS_TRIGGERS, defaultValue);
export const setDigitalChannelsTriggers = (
    triggers: digitalChannelStateTupleOf8,
) => store.set(DIGITAL_CHANNELS_TRIGGERS, triggers);

export const getDurationUnit = (
    maxSampleFreq: number,
    defaultValue: TimeUnit,
) => store.get(`durationUnit-${maxSampleFreq}`, defaultValue);
export const setDurationUnit = (maxSampleFreq: number, timeUnit: TimeUnit) => {
    store.set(`durationUnit-${maxSampleFreq}`, timeUnit);
};

export const getVoltageRegulatorMaxCapPPK2 = (defaultMaxCap: number) =>
    store.get(VOLTAGE_REGULATOR_MAX_CAP_PPK2, defaultMaxCap);
export const setVoltageRegulatorMaxCapPPK2 = (maxCap: number) =>
    store.set(VOLTAGE_REGULATOR_MAX_CAP_PPK2, maxCap);

export const getDoNotAskStartAndClear = (defaultValue: boolean) =>
    store.get(`start-and-clear-data`, defaultValue);

export const setDoNotAskStartAndClear = (value: boolean) => {
    store.set(`start-and-clear-data`, value);
};
