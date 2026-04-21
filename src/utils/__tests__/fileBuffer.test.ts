/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import fs from 'fs-extra';
import path from 'path';

import { FileBuffer } from '../FileBuffer';

jest.mock('../../features/recovery/SessionsListFileHandler', () => ({
    ReadSessions: jest.fn(() => []),
    WriteSessions: jest.fn(),
    AddSession: jest.fn(),
    RemoveSessionByFilePath: jest.fn(),
    ClearSessions: jest.fn(),
    SessionFlag: {
        NotRecovered: 0,
        Recovered: 1,
        PPK2Loaded: 2,
    },
}));

jest.mock('fs-extra', () => ({
    openSync: jest.fn(() => 1),
    mkdirSync: jest.fn(() => {}),
    existsSync: jest.fn(() => false),
    rmSync: jest.fn(() => {}),
    unlinkSync: jest.fn(() => {}),
    appendFile: jest.fn(
        () =>
            new Promise<void>(resolve => {
                setTimeout(() => resolve());
            }),
    ),
    fdatasyncSync: jest.fn(() => {}),
    read: jest.fn(
        (
            _fd: number,
            buffer: Uint8Array,
            _offset: number,
            length: number,
            position: fs.ReadPosition | null,
            callback: (
                err: NodeJS.ErrnoException | null,
                bytesRead: number,
                buffer: Uint8Array,
            ) => void,
        ) => {
            for (let i = 0; i < length; i += 1) {
                buffer[i] = Number(position) + i;
            }

            callback(null, length, buffer);
        },
    ),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const castToJest = (fn: any) => fn as jest.Mock<any, any, any>;

const mockFsRead = (cb?: () => number) => {
    castToJest(fs.read).mockImplementationOnce(
        (
            _fd: number,
            buffer: Uint8Array,
            offset: number,
            length: number,
            _position: fs.ReadPosition | null,
            callback: (
                err: NodeJS.ErrnoException | null,
                bytesRead: number,
                buffer: Uint8Array,
            ) => void,
        ) => {
            for (let i = 0; i < length; i += 1) {
                buffer[i] = offset + i;
            }

            const noOfBytesRead = cb?.() ?? length;
            callback(null, noOfBytesRead, buffer);
        },
    );
};

const readBuffer = Buffer.alloc(200);

describe('WriteBuffer', () => {
    const pageBufferSize = 10;
    const sessionFolder = path.join('session', 'folder');
    let fileBuffer = new FileBuffer(pageBufferSize, sessionFolder, 3, 3);
    beforeEach(() => {
        // we reset virtual filesystem before each test
        jest.clearAllMocks();
        fileBuffer = new FileBuffer(pageBufferSize, sessionFolder, 3, 3);
    });

    test('creates new folder for the session when data needs to be written', () => {
        fileBuffer.append(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
        expect(fs.mkdirSync).toBeCalledTimes(1);
        expect(fs.mkdirSync).toBeCalledWith(sessionFolder);
    });

    test('creates new session .raw file when data needs to be written', () => {
        fileBuffer.append(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
        expect(fs.openSync).toBeCalledTimes(1);
        expect(fs.openSync).toBeCalledWith(
            path.join(sessionFolder, 'session.raw'),
            'as+',
        );
    });

    test('clear session folder', () => {
        castToJest(fs.existsSync).mockImplementationOnce(() => true);
        fileBuffer.release();
        expect(fs.rmSync).toBeCalledTimes(1);
        expect(fs.rmSync).toBeCalledWith(
            path.join('session/folder'),
            expect.anything(),
        );
    });

    test('Save write buffer to file when buffer is erectly full', async () => {
        await fileBuffer.append(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));

        expect(fs.appendFile).toBeCalledTimes(1);
        expect(fs.appendFile).toBeCalledWith(
            1,
            Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
        );
    });

    test('No data is written if write buffer is not full', async () => {
        await fileBuffer.append(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8]));

        expect(fs.appendFile).toBeCalledTimes(0);
    });

    test('Save write buffer to file when buffer is full and only write the page size', async () => {
        await fileBuffer.append(
            Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
        );

        expect(fs.appendFile).toBeCalledTimes(1);
        expect(fs.appendFile).toBeCalledWith(
            1,
            Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
        );
    });

    test('Flush write current buffer to file and move to a new page', async () => {
        await fileBuffer.append(Buffer.from([0, 1, 2, 3, 4, 5]));
        await fileBuffer.flush();
        await fileBuffer.append(
            Buffer.from([6, 7, 6, 9, 10, 11, 12, 13, 14, 15]),
        );

        expect(fs.appendFile).toBeCalledTimes(2);
        expect(fs.appendFile).nthCalledWith(
            1,
            1,
            Buffer.from([0, 1, 2, 3, 4, 5]),
        );
        expect(fs.appendFile).nthCalledWith(
            2,
            1,
            Buffer.from([6, 7, 6, 9, 10, 11, 12, 13, 14, 15]),
        );
    });

    test('Reading empty buffer will not return nothing', async () => {
        const numberOfBytes = await fileBuffer.read(readBuffer, 0, 10);

        expect(fs.read).toBeCalledTimes(0);
        expect(numberOfBytes).toEqual(0);
    });

    test('Reading beyond the buffer size returns nothing', async () => {
        await fileBuffer.append(Buffer.from([0, 1, 2, 3, 4]));
        const numberOfBytes = await fileBuffer.read(readBuffer, 5, 1);

        expect(fs.read).toBeCalledTimes(0);
        expect(numberOfBytes).toEqual(0);
    });

    test('Reading return the expected bytes from active writePage', async () => {
        await fileBuffer.append(Buffer.from([0, 1, 2, 3, 4]));
        const numberOfBytes = await fileBuffer.read(readBuffer, 2, 3);

        expect(fs.read).toBeCalledTimes(0);
        expect(readBuffer.subarray(0, numberOfBytes)).toStrictEqual(
            Buffer.from([2, 3, 4]),
        );
    });

    test('Reading over two write buffers return the expected bytes from the writePage', async () => {
        await fileBuffer.append(
            Buffer.from([
                0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
                18, 19,
            ]),
        );
        const numberOfBytes = await fileBuffer.read(readBuffer, 9, 2);

        expect(fs.read).toBeCalledTimes(0);
        expect(readBuffer.subarray(0, numberOfBytes)).toStrictEqual(
            Buffer.from([9, 10]),
        );
    });

    test('Reading over all three write buffers return the expected bytes from the writePage', async () => {
        await fileBuffer.append(
            Buffer.from([
                0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
                18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 38, 29,
            ]),
        );
        const numberOfBytes = await fileBuffer.read(readBuffer, 9, 12);

        expect(fs.read).toBeCalledTimes(0);
        expect(readBuffer.subarray(0, numberOfBytes)).toStrictEqual(
            Buffer.from([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]),
        );
    });

    test('Reading live data', async () => {
        await fileBuffer.append(
            Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]),
        );
        const numberOfBytes = await fileBuffer.read(readBuffer, 10, 5);

        expect(fs.read).toBeCalledTimes(0);
        expect(readBuffer.subarray(0, numberOfBytes)).toStrictEqual(
            Buffer.from([10, 11, 12, 13, 14]),
        );
    });
});

describe('ReadBuffers', () => {
    const pageBufferSize = 2;
    const sessionFolder = path.join('session', 'folder');
    let fileBuffer = new FileBuffer(pageBufferSize, sessionFolder, 3, 4);
    beforeEach(async () => {
        // we reset virtual filesystem before each test
        jest.clearAllMocks();
        fileBuffer = new FileBuffer(pageBufferSize, sessionFolder, 3, 4);
        await fileBuffer.append(Buffer.from([0, 1, 2, 3, 4, 5])); // fill write buffers
    });

    test('Reading over all three write buffers return the expected bytes from the writePage', async () => {
        const numberOfBytes = await fileBuffer.read(readBuffer, 0, 6);

        expect(fs.read).toBeCalledTimes(0);
        expect(readBuffer.subarray(0, numberOfBytes)).toStrictEqual(
            Buffer.from([0, 1, 2, 3, 4, 5]),
        );
    });

    test('Reading over all three write buffers after first page is cleared', async () => {
        await fileBuffer.append(Buffer.from([6, 7])); // write buffer will now loose the first byte
        const numberOfBytes = await fileBuffer.read(readBuffer, 2, 6);

        expect(fs.read).toBeCalledTimes(0);
        expect(readBuffer.subarray(0, numberOfBytes)).toStrictEqual(
            Buffer.from([2, 3, 4, 5, 6, 7]),
        );
    });

    test('Reading over all three write buffers and one miss forcing read from file', async () => {
        await fileBuffer.append(Buffer.from([6])); // write buffer will now loose the first byte

        mockFsRead();
        const numberOfBytes = await fileBuffer.read(readBuffer, 0, 7);

        expect(fs.read).toBeCalledTimes(1);
        expect(readBuffer.subarray(0, numberOfBytes)).toStrictEqual(
            Buffer.from([0, 1, 2, 3, 4, 5, 6]),
        );
    });

    test('Buffering read exact page size reads', async () => {
        const bufferingEvents: Promise<void>[] = [];

        fileBuffer.onBuffering(buffering => {
            bufferingEvents.push(buffering);
        });

        await fileBuffer.append(
            Buffer.from([
                6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
            ]),
        ); // write buffer will now loose the first bytes

        await fileBuffer.read(readBuffer, 6, 2);
        expect(bufferingEvents.length).toBe(4);
        await Promise.all(bufferingEvents);
        expect(fs.read).toBeCalledTimes(5);
        expect(fs.read).nthCalledWith(
            1,
            1, // file handle
            expect.anything(),
            0,
            pageBufferSize,
            6,
            expect.anything(),
        ); // Data we want to read
        expect(fs.read).nthCalledWith(
            2,
            1, // file handle
            expect.anything(),
            0,
            pageBufferSize,
            2,
            expect.anything(),
        ); // Page Before
        expect(fs.read).nthCalledWith(
            3,
            1, // file handle
            expect.anything(),
            0,
            pageBufferSize,
            4,
            expect.anything(),
        ); // Page Before
        expect(fs.read).nthCalledWith(
            4,
            1, // file handle
            expect.anything(),
            0,
            pageBufferSize,
            8,
            expect.anything(),
        ); // Page After
        expect(fs.read).nthCalledWith(
            5,
            1, // file handle
            expect.anything(),
            0,
            pageBufferSize,
            10,
            expect.anything(),
        ); // Page After
    });

    test('Buffering read non exact page size reads', async () => {
        const bufferingEvents: Promise<void>[] = [];

        fileBuffer.onBuffering(buffering => {
            bufferingEvents.push(buffering);
        });

        await fileBuffer.append(
            Buffer.from([
                6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
                23,
            ]),
        ); // write buffer will no longer covert the first few bytes

        await fileBuffer.read(readBuffer, 5, 4);
        expect(bufferingEvents.length).toBe(6);
        await Promise.all(bufferingEvents);
        expect(fs.read).toBeCalledTimes(7);
        expect(fs.read).nthCalledWith(
            1,
            1, // file handle
            expect.anything(),
            0,
            4,
            5,
            expect.anything(),
        ); // Data we want to read
        expect(fs.read).nthCalledWith(
            2,
            1, // file handle
            expect.anything(),
            0,
            pageBufferSize,
            0,
            expect.anything(),
        ); // Page Before
        expect(fs.read).nthCalledWith(
            3,
            1, // file handle
            expect.anything(),
            0,
            pageBufferSize,
            2,
            expect.anything(),
        ); // Page After
        expect(fs.read).nthCalledWith(
            4,
            1, // file handle
            expect.anything(),
            0,
            pageBufferSize,
            4,
            expect.anything(),
        ); // Page Before
        expect(fs.read).nthCalledWith(
            5,
            1, // file handle
            expect.anything(),
            0,
            pageBufferSize,
            8,
            expect.anything(),
        ); // Page After
        expect(fs.read).nthCalledWith(
            6,
            1, // file handle
            expect.anything(),
            0,
            pageBufferSize,
            10,
            expect.anything(),
        ); // Page After
        expect(fs.read).nthCalledWith(
            7,
            1, // file handle
            expect.anything(),
            0,
            pageBufferSize,
            12,
            expect.anything(),
        ); // Page After
    });

    test('Buffer right after read cache hit', async () => {
        const bufferingEvents: Promise<void>[] = [];

        fileBuffer.onBuffering(buffering => {
            bufferingEvents.push(buffering);
        });

        await fileBuffer.append(
            Buffer.from([
                6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
            ]),
        ); // write buffer will only cover the last 4 bytes

        await fileBuffer.read(readBuffer, 6, 2); // read and buffer from 4-9
        expect(bufferingEvents.length).toBe(4);
        await Promise.all(bufferingEvents);
        expect(fs.read).nthCalledWith(
            2,
            1, // file handle
            expect.anything(),
            0,
            2,
            2, // offset
            expect.anything(),
        );
        expect(fs.read).nthCalledWith(
            3,
            1, // file handle
            expect.anything(),
            0,
            2,
            4, // offset
            expect.anything(),
        );
        expect(fs.read).nthCalledWith(
            4,
            1, // file handle
            expect.anything(),
            0,
            2,
            8, // offset
            expect.anything(),
        );
        expect(fs.read).nthCalledWith(
            5,
            1, // file handle
            expect.anything(),
            0,
            2,
            10, // offset
            expect.anything(),
        );
        expect(fs.read).toBeCalledTimes(5);
        await fileBuffer.read(readBuffer, 8, 2); // read and buffer from 4-9
        expect(fs.read).toBeCalledTimes(6); // read one buffer to the right
        expect(fs.read).nthCalledWith(
            6,
            1, // file handle
            expect.anything(),
            0,
            2,
            12, // offset
            expect.anything(),
        ); // Buffer right
    });

    test('Short disk read is supplemented from in-memory write buffer', async () => {
        // After beforeEach: 6 bytes written [0,1,2,3,4,5], 3 write pages full.
        // Append one more byte to push the oldest write page out of cache.
        await fileBuffer.append(Buffer.from([6]));
        // Write buffer now holds pages [2,3], [4,5], [6].
        // Page [0,1] was evicted — only on disk.

        // Mock fs.read to return a short read: only 6 bytes of 7 requested,
        // simulating the unflushed write page not yet on disk.
        castToJest(fs.read).mockImplementationOnce(
            (
                _fd: number,
                buffer: Uint8Array,
                _offset: number,
                _length: number,
                position: fs.ReadPosition | null,
                callback: (
                    err: NodeJS.ErrnoException | null,
                    bytesRead: number,
                    buffer: Uint8Array,
                ) => void,
            ) => {
                const shortRead = 6;
                for (let i = 0; i < shortRead; i += 1) {
                    buffer[i] = Number(position) + i;
                }
                callback(null, shortRead, buffer);
            },
        );

        const numberOfBytes = await fileBuffer.read(readBuffer, 0, 7);

        expect(fs.read).toBeCalledTimes(1);
        expect(numberOfBytes).toEqual(7);
        expect(readBuffer.subarray(0, numberOfBytes)).toStrictEqual(
            Buffer.from([0, 1, 2, 3, 4, 5, 6]),
        );
    });
});
