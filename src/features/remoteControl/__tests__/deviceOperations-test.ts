/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import '../__testUtils__/operationMocks';

import { logger } from '@nordicsemiconductor/pc-nrfconnect-shared';

import {
    setDeviceRunning,
    setPowerMode,
    updateRegulator,
} from '../../../actions/deviceActions';
import {
    samplingStartAction,
    setFileLoadedAction,
    setSavePending,
} from '../../../slices/appSlice';
import { toggleDigitalChannels } from '../../../slices/chartSlice';
import {
    moveVoltageRegulatorVdd,
    updateVoltageRegulatorMaxCapPPK2,
} from '../../../slices/voltageRegulatorSlice';
import {
    contextFor,
    createTestStore,
    fakeData,
    openPpk,
    recordData,
    resetFakeData,
    selectPpk,
    SERIAL_NUMBER,
    type TestStore,
} from '../__testUtils__/fakeApp';
import {
    enableDigitalChannels,
    pins,
    samplesAre,
} from '../__testUtils__/fakeSamples';
import { type Operation, type Origin, runOperation } from '../operation';
import listDevices from '../operations/listDevices';
import power from '../operations/power';
import sampling from '../operations/sampling';
import setMode from '../operations/setMode';
import setSampleRate from '../operations/setSampleRate';
import setVoltage from '../operations/setVoltage';
import status from '../operations/status';
import { setApiSession } from '../sessionOrigin';

jest.mock('../../../actions/samplingSessionActions', () => ({
    startSamplingSession: jest.fn(),
}));

let store: TestStore;
const run = (
    operation: Operation,
    args: unknown = {},
    origin: Origin = 'MCP',
) => runOperation(operation, args, contextFor(store, origin));
// A call from a client with `?max_mV=` in its URL.
const runLimited = (operation: Operation, args: unknown, maxMv?: number) =>
    runOperation(operation, args, { ...contextFor(store), maxMv });
const appState = () => store.getState().app;

beforeEach(() => {
    jest.clearAllMocks();
    resetFakeData();
    setApiSession(undefined);
    store = createTestStore();
});

describe('status', () => {
    it('reports no PPK and no data', async () => {
        expect(await run(status)).toEqual({
            status: 'ok',
            device_selected: false,
            serial_number: null,
            mode: null,
            voltage_mV: null,
            voltage_range_mV: { min: 1850, max: 3600 },
            output_on: null,
            sampling: false,
            sample_rate_hz: 100_000,
            duration_s: null,
            buffer: null,
            session_start_ts_ms: null,
            session_origin: null,
            save_pending: false,
            file_loaded: false,
            busy_op: null,
            digital: null,
            digital_mask: '0x03', // D0 and D1, the app's default
        });
    });

    it('reports the open PPK and the data in epoch ms', async () => {
        openPpk(store);
        store.dispatch(setSavePending(true));
        recordData({ startMs: 1_700_000_000_000, lastUs: 2_500_000 });

        expect(await run(status)).toEqual({
            status: 'ok',
            device_selected: true,
            serial_number: SERIAL_NUMBER,
            mode: 'source',
            voltage_mV: 3000,
            voltage_range_mV: { min: 800, max: 5000 },
            output_on: false,
            sampling: false,
            sample_rate_hz: 100_000,
            duration_s: null,
            buffer: {
                from_ts_ms: 1_700_000_000_000,
                to_ts_ms: 1_700_000_002_500,
            },
            session_start_ts_ms: 1_700_000_000_000,
            session_origin: 'ui',
            save_pending: true,
            file_loaded: false,
            busy_op: null,
            digital: null,
            digital_mask: '0x03', // D0 and D1, the app's default
        });
    });

    it('reports data without a start time (an old file) without timestamps', async () => {
        recordData({ startMs: null, lastUs: 1000 });
        expect(await run(status)).toMatchObject({
            buffer: null,
            session_start_ts_ms: null,
            session_origin: 'ui',
        });
    });

    it.each([
        ['lowered by the client max_mV', 5000, 3500, 3500],
        ['never raised above the cap by max_mV', 3100, 3500, 3100],
    ])(
        'reports the effective voltage range, %s',
        async (_, cap, maxMv, max) => {
            openPpk(store);
            store.dispatch(updateVoltageRegulatorMaxCapPPK2(cap));
            expect(await runLimited(status, {}, maxMv)).toMatchObject({
                voltage_range_mV: { min: 800, max },
            });
        },
    );

    describe('digital channels', () => {
        beforeEach(() => {
            // At the last sample (index 250000 at 100 kHz) D0, D2 and D7
            // high, before it the other way round.
            recordData({ lastUs: 2_500_000 });
            samplesAre(index => [0, pins(index === 250_000 ? 0x85 : 0x7a)]);
        });

        it('reports the state of the enabled ones at the last sample', async () => {
            enableDigitalChannels(store, 0b1000_0011);
            expect(await run(status)).toMatchObject({
                digital: '0x81',
                digital_mask: '0x83',
            });
            const [, from, to] = fakeData.getData.mock.calls[0];
            expect([from, to]).toEqual([2_500_000, 2_500_000]);
        });

        it('reports null without data', async () => {
            fakeData.bytes = 0;
            enableDigitalChannels(store, 0xff);
            expect(await run(status)).toMatchObject({
                digital: null,
                digital_mask: '0xFF',
            });
        });

        it.each([
            ['no channel is enabled', () => enableDigitalChannels(store, 0)],
            [
                'the digital channels are hidden',
                () => store.dispatch(toggleDigitalChannels()),
            ],
        ])('reports nothing when %s', async (_, disable) => {
            disable();
            const result = await run(status);
            expect(result).not.toHaveProperty('digital');
            expect(result).not.toHaveProperty('digital_mask');
        });
    });

    it('reports a session the API started as api', async () => {
        recordData({ folder: '/sessions/api', lastUs: 1000 });
        setApiSession('/sessions/api');
        expect(await run(status)).toMatchObject({ session_origin: 'api' });
    });
});

describe('list_devices', () => {
    it('lists the PPK2s only, with their ports and the selected one', async () => {
        const ppk2 = (serialNumber: string, comName: string) => ({
            id: serialNumber,
            serialNumber,
            usb: { device: { descriptor: { idProduct: 0xc00a } } },
            serialPorts: [{ comName }],
        });
        [
            ppk2(SERIAL_NUMBER, '/dev/ttyACM0'),
            ppk2('OTHER', '/dev/ttyACM2'),
            {
                id: 'DK',
                serialNumber: 'DK',
                usb: { device: { descriptor: { idProduct: 0x1051 } } },
            },
        ].forEach(payload =>
            store.dispatch({ type: 'device/addDevice', payload }),
        );
        selectPpk(store);

        expect(await run(listDevices)).toEqual({
            status: 'ok',
            devices: [
                {
                    serial_number: SERIAL_NUMBER,
                    ports: ['/dev/ttyACM0'],
                    selected: true,
                },
                {
                    serial_number: 'OTHER',
                    ports: ['/dev/ttyACM2'],
                    selected: false,
                },
            ],
        });
    });
});

const controlCalls: [string, Operation, unknown][] = [
    ['set_voltage', setVoltage, { mV: 3000 }],
    ['power on', power, { on: true }],
    ['power off', power, { on: false }],
    ['set_mode', setMode, { mode: 'ampere' }],
    ['set_sample_rate', setSampleRate, { hz: 1000 }],
    ['sampling start', sampling, { start: true }],
    ['sampling stop', sampling, { start: false }],
];

describe('no_device', () => {
    it.each(controlCalls)(
        '%s answers no_device without a PPK',
        async (_, op, args) => {
            const before = appState();
            expect(await run(op, args)).toMatchObject({
                status: 'error',
                error: 'no_device',
                message: 'No PPK is selected; select one in the app',
            });
            expect(appState()).toEqual(before);
        },
    );

    it.each(controlCalls)(
        '%s answers no_device while the PPK is connecting',
        async (_, op, args) => {
            selectPpk(store);
            expect(await run(op, args)).toMatchObject({
                error: 'no_device',
                message: 'The PPK is still connecting',
            });
        },
    );
});

describe('file_loaded', () => {
    it.each(controlCalls)(
        '%s is refused while a file is loaded',
        async (_, op, args) => {
            openPpk(store);
            store.dispatch(setFileLoadedAction('/data/old.ppk2'));
            const before = appState();
            expect(await run(op, args)).toMatchObject({ error: 'file_loaded' });
            expect(appState()).toEqual(before);
        },
    );
});

describe('set_voltage', () => {
    it('moves the slider and updates the regulator', async () => {
        openPpk(store);
        expect(await run(setVoltage, { mV: 2500 })).toEqual({
            status: 'ok',
            voltage_mV: 2500,
        });
        expect(appState().voltageRegulator).toMatchObject({
            vdd: 2500,
            currentVDD: 2500,
        });
        expect(updateRegulator).toHaveBeenCalledTimes(1);
        expect(logger.info).toHaveBeenCalledWith('[MCP] Voltage 2500 mV');
    });

    it('answers wrong_mode in ampere mode', async () => {
        openPpk(store, { mode: 'ampere' });
        const before = appState();
        expect(await run(setVoltage, { mV: 2500 })).toMatchObject({
            error: 'wrong_mode',
        });
        expect(updateRegulator).not.toHaveBeenCalled();
        expect(appState()).toEqual(before);
    });

    const refuses = async (mV: number, range: unknown, maxMv?: number) => {
        const before = appState();
        expect(await runLimited(setVoltage, { mV }, maxMv)).toMatchObject({
            status: 'error',
            error: 'out_of_range',
            voltage_range_mV: range,
        });
        expect(updateRegulator).not.toHaveBeenCalled();
        expect(appState()).toEqual(before);
    };

    it('rejects, never clamps, below the app minimum', async () => {
        openPpk(store);
        await refuses(799, { min: 800, max: 5000 });
    });

    it('rejects above the stored voltage cap', async () => {
        openPpk(store);
        store.dispatch(updateVoltageRegulatorMaxCapPPK2(3100));
        await refuses(3101, { min: 800, max: 3100 });
        expect(await run(setVoltage, { mV: 3100 })).toMatchObject({
            status: 'ok',
        });
    });

    it('rejects above the client max_mV, with the effective range', async () => {
        openPpk(store);
        await refuses(3001, { min: 800, max: 3000 }, 3000);
        expect(await runLimited(setVoltage, { mV: 3001 }, 3000)).toMatchObject({
            message: '3001 mV is outside the allowed range 800..3000 mV',
        });
        expect(await runLimited(setVoltage, { mV: 3000 }, 3000)).toMatchObject({
            status: 'ok',
        });
    });

    it('never lets the client max_mV raise the cap', async () => {
        openPpk(store);
        store.dispatch(updateVoltageRegulatorMaxCapPPK2(3100));
        await refuses(3101, { min: 800, max: 3100 }, 4000);
    });

    it('rejects everything when max_mV is below the app minimum', async () => {
        openPpk(store);
        await refuses(800, null, 700);
        expect(await runLimited(status, {}, 700)).toMatchObject({
            voltage_range_mV: null,
        });
    });

    it('fails closed when a bound is not a number', async () => {
        openPpk(store);
        store.dispatch(updateVoltageRegulatorMaxCapPPK2(NaN));
        expect(await run(status)).toMatchObject({ voltage_range_mV: null });
        await refuses(3000, null);
    });

    it('answers out_of_range in the REST status mapping too', async () => {
        openPpk(store);
        expect(await run(setVoltage, { mV: 9000 }, 'REST')).toMatchObject({
            error: 'out_of_range',
        });
        expect(logger.info).toHaveBeenCalledWith(
            expect.stringMatching(
                /^\[REST\] set_voltage refused \(out_of_range\)/,
            ),
        );
    });
});

describe('power', () => {
    it.each(['source', 'ampere'] as const)(
        'switches the DUT power in %s mode',
        async mode => {
            openPpk(store, { mode });
            expect(await run(power, { on: false })).toEqual({
                status: 'ok',
                output_on: false,
            });
            expect(await run(power, { on: true }, 'REST')).toEqual({
                status: 'ok',
                output_on: true,
            });
            expect(setDeviceRunning).toHaveBeenNthCalledWith(1, false);
            expect(setDeviceRunning).toHaveBeenNthCalledWith(2, true);
            expect(logger.info).toHaveBeenCalledWith('[MCP] DUT power OFF');
            expect(logger.info).toHaveBeenCalledWith('[REST] DUT power ON');
        },
    );
});

describe('power on above the allowed voltage', () => {
    // The slider (vdd) moved down to a lowered cap without being applied:
    // the regulator still gives currentVDD.
    const moveSlider = (mV: number) =>
        store.dispatch(moveVoltageRegulatorVdd(mV));

    it.each([
        ['the cap was lowered below it', 2900, undefined, undefined],
        [
            'the applied voltage is above the cap, the slider not',
            2900,
            undefined,
            2900,
        ],
        ['above the client max_mV', 5000, 2999, undefined],
    ])('is refused in source mode when %s', async (_, cap, maxMv, slider) => {
        openPpk(store);
        store.dispatch(updateVoltageRegulatorMaxCapPPK2(cap));
        if (slider !== undefined) moveSlider(slider);
        const voltage = appState().voltageRegulator.currentVDD;
        const max = Math.min(cap, maxMv ?? Infinity);
        expect(voltage).toBeGreaterThan(max);

        expect(await runLimited(power, { on: true }, maxMv)).toMatchObject({
            status: 'error',
            error: 'out_of_range',
            message: `The current voltage ${voltage} mV exceeds the allowed maximum ${max} mV; set_voltage first`,
            voltage_mV: voltage,
            voltage_range_mV: { min: 800, max },
        });
        expect(setDeviceRunning).not.toHaveBeenCalled();
        expect(appState().app.deviceRunning).toBe(false);
    });

    it('is refused when no voltage is allowed', async () => {
        openPpk(store);
        expect(await runLimited(power, { on: true }, 700)).toMatchObject({
            error: 'out_of_range',
            voltage_range_mV: null,
        });
        expect(setDeviceRunning).not.toHaveBeenCalled();
    });

    it('is allowed at the maximum', async () => {
        openPpk(store);
        const voltage = appState().voltageRegulator.currentVDD;
        expect(await runLimited(power, { on: true }, voltage)).toEqual({
            status: 'ok',
            output_on: true,
        });
    });

    it('does not limit ampere mode or switching off', async () => {
        openPpk(store, { mode: 'ampere' });
        store.dispatch(updateVoltageRegulatorMaxCapPPK2(2900));
        expect(await run(power, { on: false })).toMatchObject({ status: 'ok' });
        expect(await run(power, { on: true })).toMatchObject({ status: 'ok' });
        openPpk(store);
        expect(await run(power, { on: false })).toMatchObject({ status: 'ok' });
    });
});

describe('set_mode', () => {
    it('switches the mode', async () => {
        openPpk(store);
        expect(await run(setMode, { mode: 'ampere' })).toEqual({
            status: 'ok',
            mode: 'ampere',
            output_on: true,
            changed: true,
        });
        expect(setPowerMode).toHaveBeenCalledWith(false);
    });

    it('leaves the current mode alone, not switching the DUT off', async () => {
        openPpk(store, { mode: 'ampere' });
        expect(await run(setMode, { mode: 'ampere' })).toEqual({
            status: 'ok',
            mode: 'ampere',
            output_on: true,
            changed: false,
        });
        expect(setPowerMode).not.toHaveBeenCalled();
    });

    it('answers sampling_running while sampling', async () => {
        openPpk(store);
        store.dispatch(samplingStartAction());
        const before = appState();
        expect(await run(setMode, { mode: 'ampere' })).toMatchObject({
            error: 'sampling_running',
        });
        expect(setPowerMode).not.toHaveBeenCalled();
        expect(appState()).toEqual(before);
    });
});

describe('set_sample_rate', () => {
    it('sets a power of ten', async () => {
        openPpk(store);
        expect(await run(setSampleRate, { hz: 1000 })).toEqual({
            status: 'ok',
            sample_rate_hz: 1000,
        });
        expect(appState().dataLogger.sampleFreq).toBe(1000);
        expect(logger.info).toHaveBeenCalledWith('[MCP] Sample rate 1000 Hz');
    });

    it.each([300, 0, 1_000_000])('rejects %d Hz', async hz => {
        openPpk(store);
        const before = appState();
        expect(await run(setSampleRate, { hz })).toMatchObject({
            error: 'out_of_range',
            message: expect.stringContaining('1, 10, 100, 1000, 10000, 100000'),
        });
        expect(appState()).toEqual(before);
    });

    it('answers sampling_running while sampling', async () => {
        openPpk(store);
        store.dispatch(samplingStartAction());
        expect(await run(setSampleRate, { hz: 1000 })).toMatchObject({
            error: 'sampling_running',
        });
        expect(appState().dataLogger.sampleFreq).toBe(100_000);
    });
});

describe('logging', () => {
    it('does not log invalid arguments', async () => {
        openPpk(store);
        expect(await run(setVoltage, { mV: 'high' })).toMatchObject({
            error: 'invalid_argument',
        });
        expect(logger.info).not.toHaveBeenCalled();
    });
});
