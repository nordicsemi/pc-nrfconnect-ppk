/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';

// The one directory exports are written to and downloaded from. Not per
// port: REST must be able to download what MCP exported.
export const exportDirectory = () =>
    path.join(os.tmpdir(), 'pc-nrfconnect-ppk-exports');

export class UnsafeDirectoryError extends Error {}

const isPrivate = (stats: fs.Stats) =>
    stats.isDirectory() &&
    !stats.isSymbolicLink() &&
    (process.platform === 'win32' ||
        // eslint-disable-next-line no-bitwise -- permission bits
        (stats.uid === process.getuid?.() && (stats.mode & 0o077) === 0));

// The export directory, created private (0700) if missing. Throws
// UnsafeDirectoryError for one that is a symlink, someone else's or open
// to others: it is never chmod-ed then.
export const privateExportDirectory = async (create: boolean) => {
    const dir = exportDirectory();
    if (create) {
        try {
            await fs.promises.mkdir(dir, { mode: 0o700 });
            await fs.promises.chmod(dir, 0o700); // the umask may drop bits
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
    }
    const stats = await fs.promises.lstat(dir);
    if (!isPrivate(stats)) {
        throw new UnsafeDirectoryError(
            `The export directory ${dir} is not private (a directory owned by this user, mode 0700)`,
        );
    }
    return dir;
};

// A bare file name: no separators, no leading dot (temporary files start
// with one), no Windows device name.
const BARE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

export const fileNameSchema = z
    .string()
    .regex(BARE_NAME, 'must be a bare file name of letters, digits, . _ -')
    .refine(
        name => !WINDOWS_DEVICE.test(name.split('.')[0]),
        'must not be a reserved device name',
    );

export const withCsvExtension = (name: string) =>
    name.toLowerCase().endsWith('.csv') ? name : `${name}.csv`;

// ppk-YYYYMMDDTHHMMSS.csv like the app's export dialog, then -2, -3, … on
// collisions.
export const defaultExportNames = function* defaultExportNames(now: Date) {
    const stamp = now.toISOString().replace(/[-:.]/g, '').slice(0, 15);
    yield `ppk-${stamp}.csv`;
    for (let n = 2; n <= 100; n += 1) yield `ppk-${stamp}-${n}.csv`;
};

export const temporaryName = (name: string) =>
    `.${name}.${randomUUID()}.partial`;

export const exists = async (file: string) => {
    try {
        await fs.promises.lstat(file);
        return true;
    } catch {
        return false;
    }
};

// link() errors of a file system without (more) hard links.
const NO_HARD_LINK = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EMLINK']);

// Publishes a finished file under its final name; never overwrites (link
// and the exclusive copy fail with EEXIST). Copies where hard links do not
// work (e.g. FAT, network file systems); unlike a link, a copy is not
// atomic: while it runs, the final name holds a partial file. Resolves to
// false if the name is taken.
export const publish = async (temporary: string, final: string) => {
    try {
        await fs.promises.link(temporary, final).catch(error => {
            if (!NO_HARD_LINK.has(error.code)) throw error;
            return fs.promises.copyFile(
                temporary,
                final,
                fs.constants.COPYFILE_EXCL,
            );
        });
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw error;
    }
};

// Opens an exported file for download, or undefined when there is none.
// Only a regular file directly in the export directory, no symlink, and
// the same file that was checked (no swap between lstat and open).
export const openExport = async (name: string) => {
    let dir: string;
    try {
        dir = await privateExportDirectory(false);
    } catch {
        return undefined;
    }
    const file = path.join(dir, name);
    let checked: fs.Stats;
    try {
        checked = await fs.promises.lstat(file);
    } catch {
        return undefined;
    }
    // Defence in depth: isFile, O_NOFOLLOW and the dev/ino check below each
    // reject a symlink alone; only dev/ino is tested on its own.
    if (!checked.isFile()) return undefined;
    const handle = await fs.promises
        // O_NOFOLLOW: defence in depth (missing on Windows), see isFile above.
        // eslint-disable-next-line no-bitwise -- open flags
        .open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
        .catch(() => undefined);
    if (!handle) return undefined;
    const opened = await handle.stat();
    // The tested symlink/swap guard; isFile and O_NOFOLLOW are extra layers.
    if (opened.dev !== checked.dev || opened.ino !== checked.ino) {
        await handle.close();
        return undefined;
    }
    return { handle, size: opened.size };
};
