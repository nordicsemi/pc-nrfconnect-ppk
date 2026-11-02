/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import {
    logger,
    setCurrentPane,
} from '@nordicsemiconductor/pc-nrfconnect-shared';
import { z } from 'zod';

import { samplingStop } from '../../../actions/deviceActions';
import { startSamplingSession } from '../../../actions/samplingSessionActions';
import { DataManager } from '../../../globals';
import { isSamplingRunning, isSavePending } from '../../../slices/appSlice';
import {
    dataLoggerState,
    updateDuration,
    updateDurationUnit,
} from '../../../slices/dataLoggerSlice';
import { isDataLoggerPane, Panes } from '../../../utils/panes';
import { hasData } from '../dataSnapshot';
import { requireControllable } from '../guards';
import { defineOperation, operationError } from '../operation';
import { durationSeconds, toUiDuration } from '../samplingDuration';
import { sessionOrigin, setApiSession } from '../sessionOrigin';

const describeDuration = (seconds: number | null) =>
    seconds === null ? 'unlimited' : `${seconds} s`;

export default defineOperation({
    name: 'sampling',
    description:
        'Starts (start=true) or stops (start=false) sampling in the Data Logger, like the Start/Stop button; switches the app to the Data Logger pane. ' +
        'duration_s sets "Sample for" in the app: a number of seconds, null for unlimited, absent leaves the setting unchanged. ' +
        'Starting clears the previous data. It is refused with unsaved_data when they are unsaved data recorded in the app (not by the API); discard_unsaved=true discards them. ' +
        'The previous data are cleared also when the start then fails with temp_disk_missing or disk_full; discarded_unsaved in the answer (ok or error) tells whether unsaved data were discarded. ' +
        'Stopping when not sampling is ok with was_running=false.',
    annotation: 'control',
    input: {
        start: z.boolean(),
        discard_unsaved: z.boolean().optional(),
        duration_s: z.number().int().positive().nullable().optional(),
    },
    rest: { method: 'POST', path: '/api/sampling' },
    timeoutMs: 30_000,
    guards: [
        (_state, args) =>
            !args.start &&
            (args.discard_unsaved !== undefined ||
                args.duration_s !== undefined)
                ? operationError(
                      'invalid_argument',
                      'discard_unsaved and duration_s only go with start=true',
                  )
                : undefined,
        requireControllable,
    ],
    handler: async (
        { start, discard_unsaved: discardUnsaved, duration_s: durationS },
        { getState, dispatch, subscribe, origin },
    ) => {
        const state = getState();
        if (!start) {
            const wasRunning = isSamplingRunning(state);
            if (wasRunning) {
                logger.info(`[${origin}] Sampling stop`);
                await dispatch(samplingStop());
            }
            return { status: 'ok', was_running: wasRunning };
        }

        // All checks come before any change of the state.
        if (isSamplingRunning(state)) {
            return operationError('already_running', 'Sampling is running');
        }
        const unsavedFromApp = isSavePending(state) && sessionOrigin() === 'ui';
        if (unsavedFromApp && discardUnsaved !== true) {
            return operationError(
                'unsaved_data',
                'There are unsaved data recorded in the app; save them in the app or pass discard_unsaved=true to discard them',
            );
        }
        const uiDuration =
            typeof durationS === 'number' ? toUiDuration(durationS) : undefined;
        if (typeof durationS === 'number' && !uiDuration) {
            return operationError(
                'out_of_range',
                `${durationS} s cannot be set in the app: give at most 3600 s, or whole minutes, hours or days (at most 3600 of them)`,
            );
        }
        const discarded = isSavePending(state) && hasData();

        // From the checks above to the subscription there must be no await:
        // no other start may slip in between unnoticed. Every new session
        // folder seen until the start is done is recorded; with more than
        // one, the session is not claimed for the API.
        const before = DataManager().getSessionFolder();
        const seen = new Set<string>();
        const unsubscribe = subscribe(() => {
            const folder = DataManager().getSessionFolder();
            if (folder !== undefined && folder !== before) seen.add(folder);
        });
        try {
            if (!isDataLoggerPane(state)) {
                dispatch(setCurrentPane(Panes.DATA_LOGGER));
            }
            if (durationS === null) {
                dispatch(updateDurationUnit('inf'));
            } else if (uiDuration) {
                dispatch(updateDuration(uiDuration.value));
                dispatch(updateDurationUnit(uiDuration.unit));
            }
            if (durationS !== undefined) {
                logger.info(
                    `[${origin}] Sample for ${describeDuration(durationS)}`,
                );
            }
            logger.info(
                `[${origin}] Sampling start${
                    unsavedFromApp
                        ? ', discarding unsaved data recorded in the app'
                        : ''
                }`,
            );

            const result = await dispatch(startSamplingSession());
            if (!result.ok) {
                // The start clears the data before it checks the disk.
                return operationError(result.error, result.message, {
                    discarded_unsaved: discarded,
                });
            }

            const folder = DataManager().getSessionFolder();
            setApiSession(
                seen.size === 1 && folder !== undefined && seen.has(folder)
                    ? folder
                    : undefined,
            );
            const after = getState();
            return {
                status: 'ok',
                sampling: isSamplingRunning(after),
                sample_rate_hz: dataLoggerState(after).sampleFreq,
                duration_s: durationSeconds(after),
                discarded_unsaved: discarded,
            };
        } finally {
            unsubscribe();
        }
    },
});
