/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { type Operation } from '../operation';
import downloadExport from './downloadExport';
import exportCsv from './exportCsv';
import listDevices from './listDevices';
import power from './power';
import sampling from './sampling';
import setMode from './setMode';
import setSampleRate from './setSampleRate';
import setVoltage from './setVoltage';
import stats from './stats';
import status from './status';
import trace from './trace';

// Every operation of the remote control API, in tools/list order.
const operations: readonly Operation[] = [
    status,
    listDevices,
    setVoltage,
    power,
    setMode,
    setSampleRate,
    sampling,
    stats,
    trace,
    exportCsv,
    downloadExport,
];

export default operations;
