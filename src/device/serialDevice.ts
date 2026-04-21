/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- TODO: Remove, only added for conservative refactoring to typescript */
/* eslint-disable @typescript-eslint/no-explicit-any -- TODO: Remove, only added for conservative refactoring to typescript */

import {
    type Device as SharedDevice,
    getAppDir,
    logger,
} from '@nordicsemiconductor/pc-nrfconnect-shared';
import { fork } from 'child_process';
import path from 'path';

import PPKCmd from '../constants';
import { type SpikeFilter } from '../utils/persistentStore';
import Device, { convertFloatToByteBuffer } from './abstractDevice';
import {
    type Mask,
    type modifiers,
    type SampleValues,
    type serialDeviceMessage,
} from './types';

/* eslint-disable no-bitwise */

const generateMask = (bits: number, pos: number): Mask => ({
    pos,
    mask: (2 ** bits - 1) << pos,
});
const MEAS_ADC = generateMask(14, 0);
const MEAS_RANGE = generateMask(3, 14);
const MEAS_COUNTER = generateMask(6, 18);
const MEAS_LOGIC = generateMask(8, 24);

const MAX_PAYLOAD_COUNTER = 0b111111; // 0x3f, 64 - 1
const DATALOSS_THRESHOLD = 500; // 500 * 10us = 5ms: allowed loss

const getMaskedValue = (value: number, { mask, pos }: Mask): number =>
    (value & mask) >> pos;

// TODO: How to implement onSampleCallback and open, they are defined in the deviceActions file
class SerialDevice extends Device {
    public modifiers: modifiers = {
        r: [1031.64, 101.65, 10.15, 0.94, 0.043],
        gs: [1, 1, 1, 1, 1],
        gi: [1, 1, 1, 1, 1],
        o: [0, 0, 0, 0, 0],
        s: [0, 0, 0, 0, 0],
        i: [0, 0, 0, 0, 0],
        ug: [1, 1, 1, 1, 1],
    };

    public adcSamplingTimeUs = 10;
    public resistors = { hi: 1.8, mid: 28, lo: 500 };
    public vdd = 5000;
    public vddRange = { min: 800, max: 5000 };
    public triggerWindowRange = { min: 1, max: 100 };
    public isRunningInitially = false;

    private adcMult = 1.8 / 163840;

    // This are all declared to make typescript aware of their existence.
    private spikeFilter;
    private path;
    private child;
    private parser: any;
    private expectedCounter: null | number;
    private dataLossCounter: number;
    private corruptedSamples: { value: number; bits: number }[];
    private rollingAvg: undefined | number;
    private rollingAvg4: undefined | number;
    private prevRange: undefined | number;
    private afterSpike: undefined | number;
    private consecutiveRangeSample: undefined | number;

    constructor(
        device: SharedDevice,
        onSampleCallback: (values: SampleValues) => void,
    ) {
        super(onSampleCallback);

        this.capabilities.maxContinuousSamplingTimeUs = this.adcSamplingTimeUs;
        this.capabilities.samplingTimeUs = this.adcSamplingTimeUs;
        this.capabilities.digitalChannels = true;
        this.capabilities.prePostTriggering = true;
        this.spikeFilter = {
            alpha: 0.18,
            alpha5: 0.06,
            samples: 3,
        };
        this.path = device.serialPorts?.at(0)?.comName;
        const workerFile =
            process.platform === 'darwin'
                ? 'serialDevice.darwin.js'
                : 'serialDevice.js';
        this.child = fork(path.resolve(getAppDir(), 'worker', workerFile));
        this.parser = null;
        this.resetDataLossCounter();

        this.child.on('message', (message: serialDeviceMessage) => {
            if (!this.parser) {
                console.error('Program logic error, parser is not set.');
                return;
            }

            if ('data' in message && message.data) {
                this.parser(Buffer.from(message.data));
                return;
            }
            if ('error' in message) {
                logger.error(message.error);
                return;
            }
            console.log(`message: ${JSON.stringify(message)}`);
        });
        this.child.on('close', code => {
            if (code) {
                console.log(`Child process exited with code ${code}`);
            } else {
                console.log('Child process cleanly exited');
            }
        });
        this.expectedCounter = null;
        this.dataLossCounter = 0;
        this.corruptedSamples = [];
    }

    resetDataLossCounter() {
        this.expectedCounter = null;
        this.dataLossCounter = 0;
        this.corruptedSamples = [];
    }

    getAdcResult(range: number, adcVal: number): number {
        const resultWithoutGain =
            (adcVal - this.modifiers.o[range]) *
            (this.adcMult / this.modifiers.r[range]);
        let adc =
            this.modifiers.ug[range] *
            (resultWithoutGain *
                (this.modifiers.gs[range] * resultWithoutGain +
                    this.modifiers.gi[range]) +
                (this.modifiers.s[range] * (this.currentVdd / 1000) +
                    this.modifiers.i[range]));

        const prevRollingAvg4 = this.rollingAvg4;
        const prevRollingAvg = this.rollingAvg;

        this.rollingAvg =
            this.rollingAvg === undefined
                ? adc
                : this.spikeFilter.alpha * adc +
                  (1.0 - this.spikeFilter.alpha) * this.rollingAvg;
        this.rollingAvg4 =
            this.rollingAvg4 === undefined
                ? adc
                : this.spikeFilter.alpha5 * adc +
                  (1.0 - this.spikeFilter.alpha5) * this.rollingAvg4;

        if (this.prevRange === undefined) {
            this.prevRange = range;
        }

        if (this.prevRange !== range || this.afterSpike! > 0) {
            if (this.prevRange !== range) {
                // number of measurements after the spike which still to be averaged
                this.consecutiveRangeSample = 0;
                this.afterSpike = this.spikeFilter.samples;
            } else {
                this.consecutiveRangeSample! += 1;
            }
            // Use previous rolling average if within first two samples of range 4
            if (range === 4) {
                if (this.consecutiveRangeSample! < 2) {
                    this.rollingAvg4 = prevRollingAvg4;
                    this.rollingAvg = prevRollingAvg;
                }
                adc = this.rollingAvg4!;
            } else {
                adc = this.rollingAvg;
            }
            // adc = range === 4 ? this.rollingAvg4 : this.rollingAvg;
            this.afterSpike! -= 1;
        }
        this.prevRange = range;

        return adc;
    }

    start() {
        this.child.send({ open: this.path });
        return this.getMetadata();
    }

    parseMeta(meta: any) {
        Object.entries(this.modifiers).forEach(
            ([modifierKey, modifierArray]) => {
                Array.from(modifierArray).forEach((modifier, index) => {
                    modifierArray[index] =
                        meta[`${modifierKey}${index}`] || modifier;
                });
            },
        );
        return meta;
    }

    stop() {
        this.child.kill();
    }

    sendCommand(cmd: PPKCmd) {
        if (cmd.constructor !== Array) {
            this.emit(
                'error',
                'Unable to issue command',
                'Command is not an array',
            );
            return undefined;
        }
        if (cmd[0] === PPKCmd.AverageStart) {
            this.rollingAvg = undefined;
            this.rollingAvg4 = undefined;
            this.prevRange = undefined;
            this.consecutiveRangeSample = 0;
            this.afterSpike = 0;
        }
        this.child.send({ write: cmd });
        return Promise.resolve(cmd.length);
    }

    dataLossReport(missingSamples: number) {
        if (
            this.dataLossCounter < DATALOSS_THRESHOLD &&
            this.dataLossCounter + missingSamples >= DATALOSS_THRESHOLD
        ) {
            logger.error(
                'Data loss detected. See https://github.com/nordicsemi/pc-nrfconnect-ppk/blob/main/doc/docs/troubleshooting.md#data-loss-with-ppk2',
            );
        }
        this.dataLossCounter += missingSamples;
    }

    handleRawDataSet(adcValue: number) {
        try {
            const currentMeasurementRange = Math.min(
                getMaskedValue(adcValue, MEAS_RANGE),
                this.modifiers.r.length,
            );
            const counter = getMaskedValue(adcValue, MEAS_COUNTER);
            const adcResult = getMaskedValue(adcValue, MEAS_ADC) * 4;
            const bits = getMaskedValue(adcValue, MEAS_LOGIC);
            const value =
                this.getAdcResult(currentMeasurementRange, adcResult) * 1e6;

            if (this.expectedCounter === null) {
                this.expectedCounter = counter;
            } else if (
                this.corruptedSamples.length > 0 &&
                counter === this.expectedCounter
            ) {
                while (this.corruptedSamples.length > 0) {
                    this.onSampleCallback(this.corruptedSamples.shift()!);
                }
                this.corruptedSamples = [];
            } else if (this.corruptedSamples.length > 4) {
                const missingSamples =
                    (counter - this.expectedCounter + MAX_PAYLOAD_COUNTER) &
                    MAX_PAYLOAD_COUNTER;
                this.dataLossReport(missingSamples);
                for (let i = 0; i < missingSamples; i += 1) {
                    this.onSampleCallback({});
                }
                this.expectedCounter = counter;
                this.corruptedSamples = [];
            } else if (this.expectedCounter !== counter) {
                this.corruptedSamples.push({ value, bits });
            }

            this.expectedCounter += 1;
            this.expectedCounter &= MAX_PAYLOAD_COUNTER;
            // Only fire the event, if the buffer data is valid
            this.onSampleCallback({ value, bits });
        } catch (err: unknown) {
            // TODO: This does not consistently handle all possibilites
            // Even though we expect all err to be instance of Error we should
            // probably also include an else and potentially log it to ensure all
            // branches are considered.
            if (err instanceof Error) {
                console.log(err.message, 'original value', adcValue);
            }
            // to keep timestamp consistent, undefined must be emitted
            this.onSampleCallback({});
        }
    }

    remainder: Buffer = Buffer.alloc(0);

    parseMeasurementData(buf: Buffer) {
        const sampleSize = 4;
        let ofs = this.remainder.length;
        const first = Buffer.concat(
            [this.remainder, buf.subarray(0, sampleSize - ofs)],
            sampleSize,
        );
        ofs = sampleSize - ofs;
        this.handleRawDataSet(first.readUIntLE(0, sampleSize));
        for (; ofs <= buf.length - sampleSize; ofs += sampleSize) {
            this.handleRawDataSet(buf.readUIntLE(ofs, sampleSize));
        }
        this.remainder = buf.subarray(ofs);
    }

    getMetadata() {
        let metadata = '';
        return (
            new Promise(resolve => {
                this.parser = (data: Buffer) => {
                    metadata = `${metadata}${data}`;
                    if (metadata.includes('END')) {
                        // hopefully we have the complete string, HW is the last line
                        this.parser = this.parseMeasurementData.bind(this);
                        resolve(metadata);
                    }
                };
                this.sendCommand([PPKCmd.GetMetadata]);
            })
                // convert output string json:
                .then(meta => {
                    // TODO: Is this the best way to handle this?
                    // What if typeof meta is not 'string', even though we never expect it,
                    // shouldn't we handle it anyway. And how should then handle it?
                    if (typeof meta === 'string') {
                        return meta
                            .replace('END', '')
                            .trim()
                            .toLowerCase()
                            .replace(/-nan/g, 'null')
                            .replace(/\n/g, ',\n"')
                            .replace(/: /g, '": ');
                    }
                })
                .then(meta => `{"${meta}}`)
                // resolve with parsed object:
                .then(JSON.parse)
        );
    }

    // Capability methods

    ppkSetPowerMode(isSmuMode: boolean): Promise<unknown> {
        return this.sendCommand([PPKCmd.SetPowerMode, isSmuMode ? 2 : 1])!;
    }

    ppkSetUserGains(range: number, gain: number): Promise<unknown> {
        this.modifiers.ug[range] = gain;
        return this.sendCommand([
            PPKCmd.SetUserGains,
            range,
            ...convertFloatToByteBuffer(gain),
        ])!;
    }

    ppkSetSpikeFilter(spikeFilter: SpikeFilter): void {
        this.spikeFilter = {
            ...this.spikeFilter,
            ...spikeFilter,
        };
    }

    ppkAverageStart() {
        this.resetDataLossCounter();
        return super.ppkAverageStart();
    }
}

export default SerialDevice;
