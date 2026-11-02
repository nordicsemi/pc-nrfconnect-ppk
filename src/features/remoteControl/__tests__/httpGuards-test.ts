/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { checkBearer, checkHostOrigin, isJsonContentType } from '../httpGuards';

describe('checkHostOrigin', () => {
    it('rejects a missing Host on a loopback bind', () => {
        expect(checkHostOrigin('127.0.0.1', {}, false)).toBeDefined();
    });

    it('rejects a missing Host on a non-loopback bind without a token', () => {
        expect(checkHostOrigin('0.0.0.0', {}, false)).toBeDefined();
    });

    it('accepts a missing Host on a non-loopback bind with a token', () => {
        expect(checkHostOrigin('0.0.0.0', {}, true)).toBeUndefined();
    });

    it('applies the loopback rules to an IPv6 loopback bind', () => {
        expect(
            checkHostOrigin('::1', { host: 'evil.example' }, false),
        ).toBeDefined();
        expect(
            checkHostOrigin('::1', { host: '[::1]:8098' }, false),
        ).toBeUndefined();
    });

    it.each(['[::1', 'localhost:abc', 'a b', 'x/y'])(
        'rejects the malformed Host %p',
        host => {
            expect(checkHostOrigin('127.0.0.1', { host }, false)).toBeDefined();
        },
    );
});

describe('checkBearer', () => {
    it('passes everything without a token', () => {
        expect(checkBearer('', undefined)).toBe(true);
    });

    it.each([
        [undefined, false],
        ['', false],
        ['Bearer', false],
        ['Bearer ', false],
        ['Bearer abc', true],
        ['bearer abc', true],
        ['BEARER   abc', true],
        ['Bearer abcd', false],
        ['Bearer ab', false],
        ['Token abc', false],
    ])('header %p is %s', (header, expected) => {
        expect(checkBearer('abc', header)).toBe(expected);
    });
});

describe('isJsonContentType', () => {
    it.each([
        ['application/json', true],
        ['application/json; charset=utf-8', true],
        ['APPLICATION/JSON', true],
        ['application/jsonx', false],
        ['text/plain', false],
        [undefined, false],
    ])('%p is %s', (value, expected) => {
        expect(isJsonContentType(value)).toBe(expected);
    });
});
