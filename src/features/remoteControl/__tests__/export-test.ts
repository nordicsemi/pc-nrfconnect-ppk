/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import '../__testUtils__/operationMocks';

import fs from 'fs';
import os from 'os';
import path from 'path';

import exportChart, {
    formatDataForExport,
} from '../../../actions/exportChartAction';
import { DataManager } from '../../../globals';
import {
    contextFor,
    createTestStore,
    fakeData,
    openPpk,
    recordData,
    resetFakeData,
    START_MS,
    type TestStore,
} from '../__testUtils__/fakeApp';
import {
    enableDigitalChannels,
    fileData,
    pins,
    pinsDuring,
    samplesAre,
    selection,
} from '../__testUtils__/fakeSamples';
import { json, request, startTestServer } from '../__testUtils__/http';
import { closeHttpServer } from '../httpServer';
import { runOperation } from '../operation';
import downloadExport from '../operations/downloadExport';
import exportCsv, { csvRows } from '../operations/exportCsv';
import power from '../operations/power';

let store: TestStore;
let root: string;
let dir: string;
const run = (args: unknown) => runOperation(exportCsv, args, contextFor(store));
const files = () => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

// Fake timeouts only: the file system keeps working.
const ONLY_TIMERS: Parameters<typeof jest.useFakeTimers>[0] = {
    doNotFake: ['Date', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'],
};

beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    resetFakeData();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppk-export-test-'));
    jest.spyOn(os, 'tmpdir').mockReturnValue(root);
    dir = path.join(root, 'pc-nrfconnect-ppk-exports');
    store = createTestStore();
    enableDigitalChannels(store, 0);
    DataManager().setSamplesPerSecond(1000);
    recordData({ lastUs: 99_999_000 }); // 100 s at 1 kHz
    samplesAre(index => [index]);
});

afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
});

describe('export_csv', () => {
    it('writes the window as CSV into a new private directory', async () => {
        const result = await run({
            from_ts_ms: START_MS + 1000,
            to_ts_ms: START_MS + 1002,
            name: 'run',
        });
        const file = path.join(dir, 'run.csv');
        const content =
            'Timestamp(ms),Current(uA)\n1000,1000.000\n1001,1001.000\n1002,1002.000\n';
        expect(result).toEqual({
            status: 'ok',
            path: file,
            name: 'run.csv',
            rows: 3,
            bytes: content.length,
            from_ts_ms: START_MS + 1000,
            to_ts_ms: START_MS + 1002,
            session_start_ts_ms: START_MS,
        });
        expect(fs.readFileSync(file, 'utf8')).toBe(content);
        expect(files()).toEqual(['run.csv']);
        // eslint-disable-next-line no-bitwise
        expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    });

    it('reads in batches of 100000 samples', async () => {
        recordData({ lastUs: 299_999_000 }); // 300 s at 1 kHz
        const result = await run({
            from_ts_ms: START_MS,
            to_ts_ms: START_MS + 249_999,
        });
        expect(result).toMatchObject({ rows: 250_000 });
        expect(
            fakeData.getData.mock.calls.map(([, from, to]) => [from, to]),
        ).toEqual([
            [0, 99_999_000],
            [100_000_000, 199_999_000],
            [200_000_000, 249_999_000],
        ]);
    });

    it('writes rows byte for byte like the export of the app', () => {
        DataManager().setSamplesPerSecond(100_000);
        const values = [
            0,
            -1.5,
            NaN,
            1234.5678,
            1e-7,
            -0,
            3.4e38,
            NaN,
            0.0005,
            99999.9995,
            -123456.789,
            7,
        ];
        const data = fileData(values.map(value => [value]));
        const start = 1_234_567;
        const { content, rows } = csvRows(start, data, false);
        expect(content).toBe(
            formatDataForExport(start, data.getAllCurrentData(), null, [
                true,
                true,
                false,
                false,
            ]),
        );
        expect(rows).toBe(10);
    });

    it('writes digital rows byte for byte like the export of the app with separate pin fields', () => {
        DataManager().setSamplesPerSecond(100_000);
        const data = fileData([
            [0, pins(0)],
            [-1.5, pins(0xff)],
            [NaN, pins(0x01)],
            [1234.5678, pins(0xa5)],
            [7, pinsDuring(0x0f, 0x3c)], // X on D4, D5, D0, D1
            [0.0005, 0], // no state
        ]);
        const start = 1_234_567;
        const { content, rows } = csvRows(start, data, true);
        expect(content).toBe(
            formatDataForExport(
                start,
                data.getAllCurrentData(),
                data.getAllBitData(),
                [true, true, false, true],
            ),
        );
        expect(content).toMatch(/,X,X,1,1,X,X,0,0\n/);
        expect(rows).toBe(5);
    });

    it('adds the digital columns with a digital channel enabled, as the export of the app', async () => {
        enableDigitalChannels(store, 0x04);
        samplesAre(index => [
            index === 1002 ? NaN : index / 8,
            index === 1003 ? pinsDuring(0x81, 0x01) : pins(index % 256),
        ]);
        const result = await run({
            from_ts_ms: START_MS + 1000,
            to_ts_ms: START_MS + 1004,
            name: 'digital',
        });
        const content = fs.readFileSync(path.join(dir, 'digital.csv'), 'utf8');
        expect(result).toMatchObject({ rows: 4, bytes: content.length });
        expect(content.split('\n').slice(0, 2)).toEqual([
            'Timestamp(ms),Current(uA),D0,D1,D2,D3,D4,D5,D6,D7',
            '1000,125.000,0,0,0,1,0,1,1,1', // 1000 % 256 = 0b11101000
        ]);

        const uiFile = path.join(root, 'ui.csv');
        await store.dispatch(
            exportChart(
                uiFile,
                1_000_000,
                1_004_000,
                [true, true, false, true],
                () => {},
                () => {},
                { current: false },
            ),
        );
        expect(content).toBe(fs.readFileSync(uiFile, 'utf8'));
    });

    it('selects the window in the chart', async () => {
        await run({ from_ts_ms: START_MS + 1000, to_ts_ms: START_MS + 1002 });
        expect(selection(store.getState())).toEqual({
            begin: 1_000_000,
            end: 1_002_000,
        });
    });

    it.each(['a/b', '../x', '..', 'a\\b', 'CON', 'con.csv', '', '.hidden'])(
        'rejects the name %p and writes nothing',
        async name => {
            expect(await run({ last_s: 1, name })).toMatchObject({
                error: 'invalid_argument',
            });
            expect(files()).toEqual([]);
        },
    );

    it('never overwrites an existing file', async () => {
        fs.mkdirSync(dir, { mode: 0o700 });
        fs.writeFileSync(path.join(dir, 'run.csv'), 'keep');
        expect(await run({ last_s: 1, name: 'run.csv' })).toMatchObject({
            error: 'exists',
        });
        expect(fs.readFileSync(path.join(dir, 'run.csv'), 'utf8')).toBe('keep');
        expect(fakeData.getData).not.toHaveBeenCalled();
    });

    it('never overwrites a file that appears during the export', async () => {
        fakeData.getData.mockImplementation(() => {
            fs.writeFileSync(path.join(dir, 'run.csv'), 'keep');
            return Promise.resolve(fileData([[1]]));
        });
        expect(await run({ last_s: 0.001, name: 'run' })).toMatchObject({
            error: 'exists',
        });
        expect(fs.readFileSync(path.join(dir, 'run.csv'), 'utf8')).toBe('keep');
        expect(files()).toEqual(['run.csv']);
    });

    describe('without hard links', () => {
        const linkFails = (code = 'EPERM') =>
            jest
                .spyOn(fs.promises, 'link')
                .mockRejectedValue(Object.assign(new Error('link'), { code }));

        it('does not copy after another error', async () => {
            linkFails('EACCES');
            expect(await run({ last_s: 1, name: 'run' })).toMatchObject({
                error: 'internal',
            });
            expect(files()).toEqual([]);
        });

        it('copies the file instead', async () => {
            linkFails();
            expect(
                await run({
                    from_ts_ms: START_MS + 1000,
                    to_ts_ms: START_MS + 1001,
                    name: 'run',
                }),
            ).toMatchObject({ status: 'ok', name: 'run.csv', rows: 2 });
            expect(fs.readFileSync(path.join(dir, 'run.csv'), 'utf8')).toBe(
                'Timestamp(ms),Current(uA)\n1000,1000.000\n1001,1001.000\n',
            );
            expect(files()).toEqual(['run.csv']);
        });

        it('never overwrites a file that appears during the export', async () => {
            linkFails();
            fakeData.getData.mockImplementation(() => {
                fs.writeFileSync(path.join(dir, 'run.csv'), 'keep');
                return Promise.resolve(fileData([[1]]));
            });
            expect(await run({ last_s: 0.001, name: 'run' })).toMatchObject({
                error: 'exists',
            });
            expect(fs.readFileSync(path.join(dir, 'run.csv'), 'utf8')).toBe(
                'keep',
            );
            expect(files()).toEqual(['run.csv']);
        });
    });

    it('gives default names that do not collide', async () => {
        jest.useFakeTimers({
            now: new Date('2026-10-31T12:00:00.123Z'),
            doNotFake: [
                'setTimeout',
                'clearTimeout',
                'setInterval',
                'clearInterval',
                'nextTick',
                'queueMicrotask',
                'hrtime',
                'performance',
            ],
        });
        expect(await run({ last_s: 1 })).toMatchObject({
            name: 'ppk-20261031T120000.csv',
        });
        expect(await run({ last_s: 1 })).toMatchObject({
            name: 'ppk-20261031T120000-2.csv',
        });
    });

    it('rejects a window of more than 10 M samples', async () => {
        DataManager().setSamplesPerSecond(100_000);
        recordData({ lastUs: 200_000_000 });
        expect(await run({ last_s: 150 })).toMatchObject({
            error: 'out_of_range',
            message: expect.stringContaining('at most 100 s'),
        });
        expect(files()).toEqual([]);
    });

    it('answers no_data for a window of gaps only and leaves no file', async () => {
        fakeData.getData.mockResolvedValue(fileData([[NaN], [NaN]]));
        expect(await run({ last_s: 0.001 })).toMatchObject({
            error: 'no_data',
        });
        expect(files()).toEqual([]);
    });

    it('answers data_changed when the data change between batches', async () => {
        samplesAre(index => [index]);
        const first = fakeData.getData.getMockImplementation();
        fakeData.getData.mockImplementationOnce((...args: unknown[]) => {
            fakeData.folder = '/sessions/new';
            return first?.(...args);
        });
        expect(await run({ last_s: 20 })).toMatchObject({
            error: 'data_changed',
        });
        expect(files()).toEqual([]);
    });

    it('answers internal when reading fails and leaves no file', async () => {
        fakeData.getData.mockRejectedValue(new Error('read failed'));
        expect(await run({ last_s: 1 })).toEqual({
            status: 'error',
            error: 'internal',
            message: 'read failed',
        });
        expect(files()).toEqual([]);
    });

    it('times out on a hung read, cleans up at once and frees the queue', async () => {
        jest.useFakeTimers(ONLY_TIMERS);
        openPpk(store);
        fakeData.getData.mockReturnValue(new Promise(() => {}));
        const answer = run({ last_s: 1, name: 'hung' });
        await jest.advanceTimersByTimeAsync(50_000);
        const queued = runOperation(power, { on: true }, contextFor(store));

        await jest.advanceTimersByTimeAsync(10_000);
        expect(await answer).toMatchObject({ error: 'timeout' });
        expect(await queued).toMatchObject({ status: 'ok' });
        // The queue is free only once the export cleaned up.
        expect(files()).toEqual([]);
    });

    it('refuses a directory open to others', async () => {
        fs.mkdirSync(dir, { mode: 0o755 });
        fs.chmodSync(dir, 0o755);
        expect(await run({ last_s: 1 })).toMatchObject({
            error: 'internal',
            message: expect.stringContaining('is not private'),
        });
        expect(files()).toEqual([]);
        // eslint-disable-next-line no-bitwise
        expect(fs.statSync(dir).mode & 0o777).toBe(0o755);
    });

    it('refuses a directory that is a symlink', async () => {
        const elsewhere = fs.mkdtempSync(path.join(root, 'elsewhere-'));
        fs.chmodSync(elsewhere, 0o700);
        fs.symlinkSync(elsewhere, dir);
        expect(await run({ last_s: 1 })).toMatchObject({ error: 'internal' });
        expect(fs.readdirSync(elsewhere)).toEqual([]);
    });
});

describe('GET /api/export/:name', () => {
    let server: Awaited<ReturnType<typeof startTestServer>>;

    beforeEach(async () => {
        server = await startTestServer({ operations: [downloadExport] });
        await run({ from_ts_ms: START_MS, to_ts_ms: START_MS + 1, name: 'a' });
    });
    afterEach(() => closeHttpServer(server.server));

    const get = (name: string) =>
        request(server.port, { path: `/api/export/${name}` });

    it('downloads an export', async () => {
        const response = await get('a.csv');
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe(
            'text/csv; charset=utf-8',
        );
        expect(response.headers['content-disposition']).toBe(
            'attachment; filename="a.csv"',
        );
        expect(response.body).toBe(
            'Timestamp(ms),Current(uA)\n0,0.000\n1,1.000\n',
        );
    });

    it.each(['..%2Fa.csv', '%2Fetc%2Fpasswd', '.a.csv.partial', 'a.txt'])(
        'refuses %s',
        async name => {
            expect((await get(name)).status).toBe(400);
        },
    );

    it('answers 404 for a missing file', async () => {
        const response = await get('missing.csv');
        expect(response.status).toBe(404);
        expect(json(response)).toMatchObject({
            error: 'not_found',
        });
    });

    it('does not follow a symlink in the directory', async () => {
        const outside = path.join(root, 'secret.csv');
        fs.writeFileSync(outside, 'secret');
        fs.symlinkSync(outside, path.join(dir, 'link.csv'));
        expect((await get('link.csv')).status).toBe(404);
    });

    it('refuses a file swapped between the check and the open', async () => {
        const other = path.join(root, 'other.csv');
        fs.writeFileSync(other, 'other');
        const { lstat } = fs.promises;
        jest.spyOn(fs.promises, 'lstat').mockImplementation(file =>
            String(file).endsWith('a.csv') ? lstat(other) : lstat(file),
        );
        expect((await get('a.csv')).status).toBe(404);
    });

    it('refuses to serve from a directory open to others', async () => {
        fs.chmodSync(dir, 0o755);
        expect((await get('a.csv')).status).toBe(404);
    });
});
