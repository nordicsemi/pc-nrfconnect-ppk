/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { isIP, isIPv4, isIPv6 } from 'net';

export const DEFAULT_LISTEN_HOST = '127.0.0.1';

export interface ListenAddress {
    // IP literal to bind to; IPv6 without brackets.
    host: string;
    port: number;
}

// Parses a listen address in the form `[host:]port`.
//
// The host is an IPv4 literal, an IPv6 literal in brackets (`[::1]:8098`) or
// `localhost`, which is normalised to `127.0.0.1` so that `localhost:8098` and
// `127.0.0.1:8098` are recognised as the same listener. A missing host means
// `127.0.0.1`. Port 0 (an ephemeral port) is only accepted when
// `allowPortZero` is set, which only tests do.
//
// Throws an Error with a user-readable message when the value is invalid.
export const parseListen = (
    value: string,
    { allowPortZero = false } = {},
): ListenAddress => {
    const match = /^(?:\[([^\]]*)\]:|([^:[\]]+):)?(\d{1,5})$/.exec(
        value.trim(),
    );
    if (!match) {
        throw new Error(
            `Invalid listen address "${value}", expected [host:]port, e.g. 127.0.0.1:8098 or [::1]:8098`,
        );
    }
    const [, bracketed, plain, portText] = match;

    const port = Number(portText);
    if (port > 65535 || (port === 0 && !allowPortZero)) {
        throw new Error(
            `Invalid port in listen address "${value}", expected 1-65535`,
        );
    }

    if (bracketed !== undefined) {
        if (!isIPv6(bracketed)) {
            throw new Error(`Invalid IPv6 address in "${value}"`);
        }
        return { host: bracketed.toLowerCase(), port };
    }

    if (plain === undefined) return { host: DEFAULT_LISTEN_HOST, port };
    if (plain.toLowerCase() === 'localhost') {
        return { host: DEFAULT_LISTEN_HOST, port };
    }
    if (!isIPv4(plain)) {
        throw new Error(
            `Invalid host in listen address "${value}", expected an IP address or localhost`,
        );
    }
    return { host: plain, port };
};

const stripBrackets = (host: string) =>
    host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

// True for 127.0.0.0/8, ::1 and ::ffff:127.x; accepts bracketed IPv6.
export const isLoopbackIp = (host: string) => {
    const ip = stripBrackets(host).toLowerCase();
    if (isIPv4(ip)) return ip.startsWith('127.');
    if (isIPv6(ip)) {
        if (ip === '::1') return true;
        const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
        return mapped != null && mapped[1].startsWith('127.');
    }
    return false;
};

// True for IP literals (bracketed IPv6 allowed), false for DNS names.
export const isIpLiteral = (host: string) => isIP(stripBrackets(host)) !== 0;

export const formatHostPort = ({ host, port }: ListenAddress) =>
    isIPv6(host) ? `[${host}]:${port}` : `${host}:${port}`;
