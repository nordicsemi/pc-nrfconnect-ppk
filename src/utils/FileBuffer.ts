/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { logger } from '@nordicsemiconductor/pc-nrfconnect-shared';
import fs from 'fs-extra';
import path from 'path';

import {
    AddSession,
    RemoveSessionByFilePath,
    SessionFlag,
} from '../features/recovery/SessionsListFileHandler';
import {
    fullOverlap,
    overlaps,
    type Page,
    type Range,
    readFromCachedData,
    WriteBuffer,
} from './WriteBuffer';

export class FileBuffer {
    #readPages: Page[] = [];

    #writeBuffer: WriteBuffer | undefined;
    #numberOfReadPages = 20;
    #fileHandle: number | undefined;
    #filePath: string;
    #bufferPageSize: number;
    fileOperationTasks: (() => Promise<void>)[] = [];
    #fileBusy = false;
    #beforeUnload: (event: BeforeUnloadEvent) => Promise<void>;
    #bufferingListeners: ((event: Promise<void>) => void)[] = [];
    #fileWriteListeners: (() => void)[] = [];
    #freePageBuffers: Uint8Array[] = [];
    #bufferingRequests: Promise<void>[] = [];
    #cancelBufferOperations: WeakMap<Promise<void>, AbortController> =
        new WeakMap();
    #firstWriteTime: number | undefined; // only needed for read only
    #fileSize: number | undefined; // only needed for read only
    samplingRate: number | undefined;
    #autoClean: boolean;

    constructor(
        bufferPageSize: number,
        filePath: fs.PathLike,
        numberOfWritePages = 14,
        numberOfReadPages = 2,
        firstWriteTime: number | undefined = undefined,
        autoClean = true,
    ) {
        if (numberOfWritePages < 2) {
            throw new Error('numberOfWritePages cannot be less then 2');
        }

        if (numberOfReadPages < 1) {
            throw new Error('numberOfReadPages cannot be less then 1');
        }

        this.#autoClean = autoClean;

        this.#numberOfReadPages = numberOfReadPages;

        this.#bufferPageSize = bufferPageSize;

        // loading from existing session
        this.#filePath = path.join(filePath.toString(), 'session.raw');
        if (fs.existsSync(filePath)) {
            logger.debug(
                `Loading temporary ppk session file sessionFile ${filePath}`,
            );
            this.#fileSize = fs.statSync(this.#filePath).size;
            this.#fileHandle = fs.openSync(this.#filePath, 'r');
            this.#firstWriteTime = firstWriteTime;
        } else {
            this.#writeBuffer = new WriteBuffer(
                bufferPageSize,
                numberOfWritePages,
                this.#writeActivePage.bind(this),
                {
                    push: (buffer: Uint8Array) =>
                        this.#freePageBuffers.push(buffer),
                    get: () => this.#getFreeBufferPage(),
                },
                0,
                firstWriteTime,
            );
        }

        this.#beforeUnload = async (event: BeforeUnloadEvent) => {
            if (event.returnValue) return;
            await this.close(false);
            this.release();
        };

        if (this.#autoClean) {
            window.addEventListener('beforeunload', this.#beforeUnload);
        }
    }

    #getPages() {
        return [...this.#readPages, ...(this.#writeBuffer?.getPages() ?? [])];
    }

    #writeActivePage() {
        return new Promise<void>((resolve, reject) => {
            const writeBuffer = this.#writeBuffer;
            if (!writeBuffer) {
                reject(new Error('Unable to write. Readonly mode.'));
                return;
            }

            // new session
            if (!this.#fileHandle) {
                const sessionDir = this.getSessionFolder();
                if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir);

                logger.debug(
                    `Creating temporary ppk session file sessionFile ${
                        this.#filePath
                    }`,
                );
                this.#fileHandle = fs.openSync(this.#filePath, 'as+');

                AddSession(
                    Date.now(),
                    this.samplingRate ? this.samplingRate : 100000,
                    SessionFlag.NotRecovered,
                    this.#filePath,
                );
            }

            const writePages = writeBuffer.getPages();
            if (writePages.length === 0) {
                resolve();
                return;
            }
            const activePage = writePages[writePages.length - 1];

            if (activePage.bytesWritten === activePage.page.length) {
                this.fileOperationTasks.push(() => {
                    if (!this.#fileHandle)
                        throw new Error('Invalid File handle');
                    return fs
                        .appendFile(this.#fileHandle, activePage.page)
                        .finally(() => {
                            this.#fileWriteListeners.forEach(l => l());
                            resolve();
                        });
                });
            } else {
                this.fileOperationTasks.push(() => {
                    if (!this.#fileHandle)
                        throw new Error('Invalid File handle');

                    return fs
                        .appendFile(
                            this.#fileHandle,
                            activePage.page.subarray(
                                0,
                                activePage.bytesWritten,
                            ),
                        )
                        .finally(() => {
                            this.#fileWriteListeners.forEach(l => l());
                            resolve();
                        });
                });

                writeBuffer.switchPage();
            }
            this.#executeFileOperation();
        });
    }

    async #executeFileOperation() {
        if (this.fileOperationTasks.length === 0 || this.#fileBusy) return;

        const nextTask = this.fileOperationTasks[0];
        this.fileOperationTasks.splice(0, 1);

        this.#fileBusy = true;
        try {
            await nextTask();
        } catch {
            // do nothing
        }

        this.#fileBusy = false;
        this.#executeFileOperation();
    }

    append(data: Uint8Array) {
        const writeBuffer = this.#writeBuffer;
        if (!writeBuffer) {
            throw new Error('Unable to write. Readonly mode.');
        }
        return writeBuffer.append(data);
    }

    getSessionInBytes() {
        return (
            this.#writeBuffer?.getBytesWritten() ??
            this.#fileSize ??
            fs.statSync(this.#filePath).size
        );
    }

    #readRange = (
        buffer: Uint8Array,
        bytesToRead: number,
        fileOffset: number,
        beforeRun?: () => void,
        abortController?: AbortController,
    ) =>
        new Promise<number>(res => {
            const fileHandle = this.#fileHandle;
            if (!fileHandle) {
                throw new Error(
                    'Unable to read data from file. File was never created',
                );
            }

            this.fileOperationTasks.push(
                () =>
                    new Promise<void>((resolve, reject) => {
                        if (abortController?.signal.aborted) {
                            reject();
                            return;
                        }

                        beforeRun?.();

                        fs.read(
                            fileHandle,
                            buffer,
                            0,
                            bytesToRead,
                            fileOffset,
                            (_, bytesRead) => {
                                resolve();
                                res(bytesRead);
                            },
                        );
                    }),
            );
            this.#executeFileOperation();
        });

    #bufferPage = (page: Page, startAddress: number) => {
        const cancelOperation = new AbortController();

        const bufferingRequest = this.#readRange(
            page.page,
            page.page.length,
            startAddress,
            undefined,
            cancelOperation,
        ).then(bytesRead => {
            page.bytesWritten = bytesRead;
            page.startAddress = startAddress;
            this.#cancelBufferOperations.delete(bufferingRequest);
        });

        cancelOperation.signal.addEventListener('abort', () => {
            this.#cancelBufferOperations.delete(bufferingRequest);

            const index = this.#bufferingRequests.findIndex(
                r => bufferingRequest === r,
            );

            if (index !== -1) {
                this.#bufferingRequests.splice(index, 1);
            }
        });

        this.#cancelBufferOperations.set(bufferingRequest, cancelOperation);
        this.#bufferingRequests.push(bufferingRequest);

        this.#bufferingListeners.forEach(cb => {
            cb(bufferingRequest);
        });

        bufferingRequest.finally(() => {
            const index = this.#bufferingRequests.findIndex(
                r => bufferingRequest === r,
            );

            if (index !== -1) {
                this.#bufferingRequests.splice(index, 1);
            }
        });

        return bufferingRequest;
    };

    #calculateIdealReadBufferRange(
        startOffset: number,
        endOffset: number,
        bias?: 'start' | 'end',
    ): Range {
        const writeBufferRange = this.#writeBuffer?.getBufferRange();

        const normalizedBeforeOffset =
            Math.trunc(startOffset / this.#bufferPageSize) *
            this.#bufferPageSize;
        const normalizedAfterOffset =
            Math.ceil(endOffset / this.#bufferPageSize) * this.#bufferPageSize -
            1;

        if (bias === 'start') {
            return {
                start: Math.max(
                    0,
                    Math.min(
                        normalizedBeforeOffset -
                            this.#numberOfReadPages * this.#bufferPageSize,
                        writeBufferRange?.start ?? Infinity,
                    ),
                ),
                end: Math.min(
                    this.getSessionInBytes() - 1,
                    normalizedAfterOffset,
                    (writeBufferRange?.start ?? Infinity) - 1,
                ),
            };
        }

        if (bias === 'end') {
            return {
                start: Math.max(
                    0,
                    Math.min(
                        normalizedBeforeOffset,
                        writeBufferRange?.start ?? Infinity,
                    ),
                ),
                end: Math.min(
                    this.getSessionInBytes() - 1,
                    normalizedAfterOffset +
                        this.#numberOfReadPages * this.#bufferPageSize,
                    (writeBufferRange?.start ?? Infinity) - 1,
                ),
            };
        }

        return {
            start: Math.max(
                0,
                Math.min(
                    normalizedBeforeOffset -
                        Math.ceil(this.#numberOfReadPages / 2) *
                            this.#bufferPageSize,
                    writeBufferRange?.start ?? Infinity,
                ),
            ),
            end: Math.min(
                this.getSessionInBytes() - 1,
                (writeBufferRange?.start ?? Infinity) - 1,
                normalizedAfterOffset +
                    Math.ceil(this.#numberOfReadPages / 2) *
                        this.#bufferPageSize,
            ),
        };
    }

    #updateReadPages(
        beforeOffset: number,
        afterOffset: number,
        bias?: 'start' | 'end',
    ) {
        const idealBufferRange = this.#calculateIdealReadBufferRange(
            beforeOffset,
            afterOffset,
            bias,
        );

        if (idealBufferRange.start >= idealBufferRange.end) {
            return;
        }

        this.#readPages = this.#readPages.filter(p => {
            const keep = overlaps(idealBufferRange, {
                start: p.startAddress,
                end: p.startAddress + p.bytesWritten - 1,
            });

            if (!keep && p.page.length === this.#bufferPageSize) {
                this.#freePageBuffers.push(p.page);
            }

            return keep;
        });

        const endOffFileOffset = this.getSessionInBytes() - 1;

        for (
            let i = idealBufferRange.start;
            i < idealBufferRange.end;
            i += this.#bufferPageSize
        ) {
            const missing =
                this.#getPages().findIndex(p =>
                    fullOverlap(
                        {
                            start: p.startAddress,
                            end: p.startAddress + p.bytesWritten - 1,
                        },
                        {
                            start: i,
                            end: Math.min(
                                i + this.#bufferPageSize - 1,
                                endOffFileOffset,
                            ),
                        },
                    ),
                ) === -1;

            if (missing) {
                const newReadPage = {
                    page: this.#getFreeBufferPage(),
                    startAddress: 0,
                    bytesWritten: 0,
                };
                this.#bufferPage(newReadPage, i)
                    .then(() => {
                        this.#readPages.push(newReadPage);
                    })
                    .catch(() => {
                        this.#freePageBuffers.push(newReadPage.page);
                    });
            }
        }
    }

    #getFreeBufferPage() {
        return (
            this.#freePageBuffers.pop() ?? Buffer.alloc(this.#bufferPageSize)
        );
    }

    #readFromCachedData(
        buffer: Buffer,
        byteOffset: number,
        numberOfBytesToRead: number,
        bias?: 'start' | 'end',
    ) {
        readFromCachedData(
            this.#getPages(),
            buffer,
            byteOffset,
            numberOfBytesToRead,
        );

        Promise.allSettled(this.#bufferingRequests).then(() =>
            this.#updateReadPages(
                byteOffset,
                byteOffset + numberOfBytesToRead,
                bias,
            ),
        );
    }

    async read(
        buffer: Buffer,
        byteOffset: number,
        numberOfBytesToRead: number,
        bias?: 'start' | 'end',
        onLoading?: (loading: boolean) => void,
    ) {
        if (buffer.length < numberOfBytesToRead) {
            throw new Error('Buffer is too small');
        }

        if (byteOffset >= this.getSessionInBytes()) {
            return 0;
        }

        try {
            this.#readFromCachedData(
                buffer,
                byteOffset,
                numberOfBytesToRead,
                bias,
            );

            return numberOfBytesToRead;
        } catch {
            // cache miss we need to read
        }

        onLoading?.(true);

        this.#bufferingRequests.forEach(op => {
            this.#cancelBufferOperations.get(op)?.abort();
        });

        let bytesRead = await this.#readRange(
            buffer,
            numberOfBytesToRead,
            byteOffset,
        );

        // The active write page may not yet be flushed to disk; supplement
        // any short read from the in-memory write buffer.
        if (bytesRead < numberOfBytesToRead && this.#writeBuffer) {
            const supplementOffset = byteOffset + bytesRead;
            const supplementLength = numberOfBytesToRead - bytesRead;
            try {
                readFromCachedData(
                    this.#writeBuffer.getPages(),
                    buffer.subarray(bytesRead),
                    supplementOffset,
                    supplementLength,
                );
                bytesRead = numberOfBytesToRead;
            } catch {
                // write buffer doesn't cover this range either
            }
        }

        const normalizedBegin =
            Math.ceil(byteOffset / this.#bufferPageSize) * this.#bufferPageSize;
        const normalizedEnd =
            Math.trunc((byteOffset + bytesRead) / this.#bufferPageSize) *
                this.#bufferPageSize -
            1;

        if (normalizedEnd + 1 - normalizedBegin >= this.#bufferPageSize) {
            const offset = normalizedBegin - byteOffset;

            // split read data into pages
            for (
                let i = normalizedBegin;
                i < normalizedEnd;
                i += this.#bufferPageSize
            ) {
                const page = this.#getFreeBufferPage();

                buffer.copy(
                    page,
                    0,
                    offset + i - normalizedBegin,
                    offset + i + this.#bufferPageSize - normalizedBegin - 1,
                );

                const newPage = {
                    page,
                    startAddress: i,
                    bytesWritten: this.#bufferPageSize,
                };
                this.#readPages.push(newPage);
            }
        }

        Promise.allSettled(this.#bufferingRequests).then(() =>
            this.#updateReadPages(
                byteOffset,
                byteOffset + numberOfBytesToRead,
                bias,
            ),
        );

        onLoading?.(false);

        return bytesRead;
    }

    async flush() {
        if (this.#writeBuffer) {
            await this.#writeActivePage();
            if (this.#fileHandle) {
                fs.fdatasyncSync(this.#fileHandle);
            }
        }
    }

    async close(flush = true) {
        if (this.#fileHandle) {
            if (flush) await this.flush();
            fs.closeSync(this.#fileHandle);
            this.#fileHandle = undefined;
        }
    }

    release() {
        window.removeEventListener('beforeunload', this.#beforeUnload);
        if (fs.existsSync(this.#filePath)) {
            const dir = path.parse(this.#filePath).dir;
            logger.debug(`Deleting temporary ppk session at ${dir}`);
            fs.unlinkSync(this.#filePath);
            fs.rmSync(dir, { recursive: true, force: true });
            RemoveSessionByFilePath(this.#filePath, () => {});
        }
    }

    getSessionFolder() {
        return path.parse(this.#filePath).dir;
    }

    getFirstWriteTime() {
        return this.#writeBuffer?.getFirstWriteTime() ?? this.#firstWriteTime;
    }

    clearStartSystemTime() {
        this.#writeBuffer?.clearStartSystemTime(); // only to be cleared for old PPK files
        this.#firstWriteTime = undefined;
    }

    onBuffering(listener: (bufferEvent: Promise<void>) => void) {
        this.#bufferingListeners.push(listener);

        // report existing buffering events
        this.#bufferingRequests.forEach(listener);

        return () => {
            const index = this.#bufferingListeners.findIndex(
                l => l === listener,
            );

            if (index !== -1) {
                this.#bufferingListeners.splice(index, 1);
            }
        };
    }

    onFileWrite(listener: () => void) {
        this.#fileWriteListeners.push(listener);

        return () => {
            const index = this.#fileWriteListeners.findIndex(
                l => l === listener,
            );

            if (index !== -1) {
                this.#fileWriteListeners.splice(index, 1);
            }
        };
    }
}
