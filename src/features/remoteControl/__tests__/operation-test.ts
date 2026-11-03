/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { z } from 'zod';

import { testContext } from '../__testUtils__/http';
import {
    defineOperation,
    type Operation,
    operationError,
    runOperation,
} from '../operation';

const context = () => ({ ...testContext(), origin: 'REST' as const });

describe('defineOperation', () => {
    it('rejects GET for an operation that is not read-only', () => {
        expect(() =>
            defineOperation({
                name: 'power',
                description: '',
                annotation: 'destructive',
                input: {},
                // @ts-expect-error GET is only typed for read operations
                rest: { method: 'GET', path: '/api/power' },
                handler: () => ({ status: 'ok' }),
            }),
        ).toThrow(/GET is only allowed for read operations/);
    });

    it('rejects a path parameter missing in the input', () => {
        expect(() =>
            defineOperation({
                name: 'download',
                description: '',
                annotation: 'read',
                mcp: false,
                input: {},
                rest: { method: 'GET', path: '/api/export/:name' },
                handler: () => ({ status: 'ok' }),
            }),
        ).toThrow(/path parameters name/);
    });

    it('reserves max_mV for the client limit of the server', () => {
        expect(() =>
            defineOperation({
                name: 'limit',
                description: '',
                annotation: 'read',
                input: { max_mV: z.number() },
                rest: { method: 'GET', path: '/api/limit' },
                handler: () => ({ status: 'ok' }),
            }),
        ).toThrow(/max_mV is reserved/);
    });
});

describe('runOperation', () => {
    const operation: Operation = defineOperation({
        name: 'set',
        description: '',
        annotation: 'control',
        input: { mV: z.number() },
        rest: { method: 'POST', path: '/api/set' },
        handler: ({ mV }) =>
            mV > 5000
                ? operationError('out_of_range', 'too high')
                : { status: 'ok', mV },
    });

    it('returns invalid_argument for unknown keys and wrong types', async () => {
        await expect(
            runOperation(operation, { mV: 1, x: 1 }, context()),
        ).resolves.toMatchObject({
            status: 'error',
            error: 'invalid_argument',
        });
        await expect(
            runOperation(operation, { mV: '1' }, context()),
        ).resolves.toMatchObject({ error: 'invalid_argument' });
    });

    it('passes the handler result through', async () => {
        await expect(
            runOperation(operation, { mV: 6000 }, context()),
        ).resolves.toEqual(operationError('out_of_range', 'too high'));
    });

    it('turns a thrown error into internal', async () => {
        const throwing: Operation = {
            ...operation,
            handler: () => {
                throw new Error('kaput');
            },
        };
        await expect(
            runOperation(throwing, { mV: 1 }, context()),
        ).resolves.toEqual(operationError('internal', 'kaput'));
    });
});
