/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import {
    formatHostPort,
    isIpLiteral,
    isLoopbackIp,
    parseListen,
} from '../listen';

describe('parseListen', () => {
    it.each([
        ['8098', '127.0.0.1', 8098],
        [' 8098 ', '127.0.0.1', 8098],
        ['127.0.0.1:8098', '127.0.0.1', 8098],
        ['0.0.0.0:8098', '0.0.0.0', 8098],
        ['localhost:1', '127.0.0.1', 1],
        ['LocalHost:65535', '127.0.0.1', 65535],
        ['[::1]:8098', '::1', 8098],
        ['[::]:8098', '::', 8098],
        ['[FE80::1]:80', 'fe80::1', 80],
    ])('parses %s', (value, host, port) => {
        expect(parseListen(value)).toEqual({ host, port });
    });

    it.each([
        '',
        'abc',
        'host:',
        ':8098',
        '::1:8098',
        '[::1]',
        '[nope]:8098',
        '127.0.0.1:70000',
        '127.0.0.1:65536',
        '127.0.0.1:-1',
        '127.0.0.256:8098',
        'example.com:8098',
        '127.0.0.1:8098:1',
        '0',
        '127.0.0.1:0',
    ])('rejects %p', value => {
        expect(() => parseListen(value)).toThrow(Error);
    });

    it('accepts port 0 only when allowed', () => {
        expect(parseListen('127.0.0.1:0', { allowPortZero: true })).toEqual({
            host: '127.0.0.1',
            port: 0,
        });
    });
});

describe('address helpers', () => {
    it.each([
        ['127.0.0.1', true],
        ['127.1.2.3', true],
        ['::1', true],
        ['[::1]', true],
        ['::ffff:127.0.0.1', true],
        ['0.0.0.0', false],
        ['192.168.1.1', false],
        ['::', false],
        ['localhost', false],
    ])('isLoopbackIp(%s) is %s', (host, expected) => {
        expect(isLoopbackIp(host)).toBe(expected);
    });

    it.each([
        ['10.0.0.1', true],
        ['[fe80::1]', true],
        ['localhost', false],
        ['evil.example', false],
    ])('isIpLiteral(%s) is %s', (host, expected) => {
        expect(isIpLiteral(host)).toBe(expected);
    });

    it('brackets IPv6 in host:port', () => {
        expect(formatHostPort({ host: '::1', port: 1 })).toBe('[::1]:1');
        expect(formatHostPort({ host: '127.0.0.1', port: 1 })).toBe(
            '127.0.0.1:1',
        );
    });
});
