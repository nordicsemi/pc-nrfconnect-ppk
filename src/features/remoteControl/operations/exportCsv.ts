/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { logger } from '@nordicsemiconductor/pc-nrfconnect-shared';
import fs from 'fs';
import path from 'path';

import {
    type FileData,
    getSamplesPerSecond,
    indexToTimestamp,
} from '../../../globals';
import { csvBitFields, enabledDigitalMask } from '../digital';
import {
    defaultExportNames,
    exists,
    fileNameSchema,
    privateExportDirectory,
    publish,
    temporaryName,
    UnsafeDirectoryError,
    withCsvExtension,
} from '../exportFiles';
import { defineOperation, operationError } from '../operation';
import {
    epochRange,
    resolveWindow,
    type SampleWindow,
    SELECTION_DESCRIPTION,
    selectWindow,
    WINDOW_DESCRIPTION,
    windowInput,
    windowSamples,
} from '../timeWindow';
import { forEachBatch } from '../windowBatches';

export const MAX_EXPORT_SAMPLES = 10_000_000;
const HEADER = 'Timestamp(ms),Current(uA)';
const DIGITAL_HEADER = ',D0,D1,D2,D3,D4,D5,D6,D7';

export const csvHeader = (digital: boolean) =>
    `${HEADER}${digital ? DIGITAL_HEADER : ''}\n`;

// The rows of a batch whose first sample has the index `start`, exactly as
// formatDataForExport writes timestamp and current, and with `digital` the
// digital logic pins as separate fields (samples without a value, NaN, are
// left out). Pure ASCII: the length is the byte count.
export const csvRows = (
    start: number,
    data: Pick<FileData, 'getLength' | 'getCurrentData' | 'getBitData'>,
    digital: boolean,
) => {
    let content = '';
    let rows = 0;
    const length = data.getLength();
    for (let n = 0; n < length; n += 1) {
        const value = data.getCurrentData(n);
        if (!Number.isNaN(value)) {
            const bits = digital ? csvBitFields(data.getBitData(n)) : '';
            content += `${indexToTimestamp(n + start) / 1000},${value.toFixed(3)}${bits}\n`;
            rows += 1;
        }
    }
    return { content, rows };
};

// Writes the window as CSV, in batches, to an open temporary file. Returns
// the rows written, or the error to answer with.
const writeWindow = async (
    handle: fs.promises.FileHandle,
    window: SampleWindow,
    signal: AbortSignal,
    digital: boolean,
) => {
    const header = csvHeader(digital);
    await handle.write(header);
    let rows = 0;
    let bytes = header.length;
    const changed = await forEachBatch(
        window,
        signal,
        'during the export',
        async (start, data) => {
            const batch = csvRows(start, data, digital);
            // Not raced against the abort: cleanup waits for a running write.
            await handle.write(batch.content);
            rows += batch.rows;
            bytes += batch.content.length;
        },
    );
    if (changed) return changed;
    if (rows === 0) {
        return operationError('no_data', 'There is no sample in the window');
    }
    return { rows, bytes };
};

// Publishes the file under the first name not taken yet.
const publishAsFirstFree = async (
    temporary: string,
    dir: string,
    [name, ...others]: string[],
): Promise<string | undefined> => {
    if (name === undefined) return undefined;
    return (await publish(temporary, path.join(dir, name)))
        ? name
        : publishAsFirstFree(temporary, dir, others);
};

const removeQuietly = (file: string) =>
    fs.promises.unlink(file).catch(() => {});

export default defineOperation({
    name: 'export_csv',
    description:
        'Exports a window of the recorded data as CSV (Timestamp(ms) since the session start, Current(uA)) into the export directory of the app, and returns the path. ' +
        'With digital channels enabled in the app (Display options), the columns D0..D7 follow, as in the export of the app with the digital logic pins as separate fields: 0, 1, X (toggled within the sample) or - (no state), for all eight channels. ' +
        'The optional name is a bare file name (.csv is added); an existing file is never overwritten. ' +
        `Remote REST clients download the file with GET /api/export/<name>. ${WINDOW_DESCRIPTION} ${SELECTION_DESCRIPTION} ` +
        `At most ${MAX_EXPORT_SAMPLES.toLocaleString('en')} samples; the call times out after 60 s.`,
    annotation: 'control',
    input: { ...windowInput, name: fileNameSchema.optional() },
    rest: { method: 'POST', path: '/api/export' },
    timeoutMs: 60_000,
    handler: async (
        { name, ...windowArgs },
        { signal, origin, getState, dispatch },
    ) => {
        const window = resolveWindow(windowArgs);
        if ('status' in window) return window;
        if (windowSamples(window) > MAX_EXPORT_SAMPLES) {
            const maxSeconds = MAX_EXPORT_SAMPLES / getSamplesPerSecond();
            return operationError(
                'out_of_range',
                `The window has more than ${MAX_EXPORT_SAMPLES} samples; at the current sample rate export at most ${maxSeconds} s at once`,
            );
        }

        let dir: string;
        try {
            dir = await privateExportDirectory(true);
        } catch (error) {
            if (!(error instanceof UnsafeDirectoryError)) throw error;
            return operationError('internal', error.message);
        }
        const names = name
            ? [withCsvExtension(name)]
            : [...defaultExportNames(new Date())];
        if (name && (await exists(path.join(dir, names[0])))) {
            return operationError('exists', `${names[0]} already exists`);
        }

        const temporary = path.join(dir, temporaryName(names[0]));
        const handle = await fs.promises.open(temporary, 'wx', 0o600);
        try {
            const written = await writeWindow(
                handle,
                window,
                signal,
                enabledDigitalMask(getState()) !== 0,
            );
            await handle.close();
            if ('status' in written) return written;

            const published = await publishAsFirstFree(temporary, dir, names);
            if (!published) {
                return operationError('exists', `${names[0]} already exists`);
            }
            const file = path.join(dir, published);
            logger.info(`[${origin}] Exported CSV to ${file}`);
            selectWindow(dispatch, window);
            return {
                status: 'ok',
                path: file,
                name: published,
                ...written,
                ...epochRange(window),
            };
        } finally {
            await handle.close().catch(() => {});
            await removeQuietly(temporary);
        }
    },
});
