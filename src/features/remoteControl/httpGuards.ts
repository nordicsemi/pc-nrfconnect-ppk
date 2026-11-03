/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { createHash, timingSafeEqual } from 'crypto';
import { type IncomingHttpHeaders, type IncomingMessage } from 'http';

import { isIpLiteral, isLoopbackIp } from './listen';

const isLoopbackName = (hostname: string) =>
    hostname === 'localhost' || isLoopbackIp(hostname);

// Hostname (lowercase, IPv6 in brackets) of a Host header, or undefined.
const hostnameOfHostHeader = (value: string | undefined) => {
    if (!value || /[/?#@\\\s]/.test(value)) return undefined;
    try {
        return new URL(`http://${value}`).hostname;
    } catch {
        return undefined;
    }
};

const isLoopbackOrigin = (origin: string) => {
    try {
        const url = new URL(origin);
        return url.protocol === 'http:' && isLoopbackName(url.hostname);
    } catch {
        return false; // includes the opaque origin "null"
    }
};

// DNS rebinding and cross-site request protection, applied to every path.
//
// - A request carrying an `Origin` header comes from a web page. It is only
//   accepted from a loopback `http:` origin, on every bind address: no
//   legitimate client of this API is a web page from elsewhere.
// - On a loopback bind the `Host` header must name a loopback host.
// - On any other bind without a token the `Host` header must be an IP
//   literal, because a DNS name may have been rebound by an attacker's page.
//   With a token any Host is accepted, the token protects the server.
//
// Returns a rejection message, or undefined when the request may pass.
export const checkHostOrigin = (
    bindHost: string,
    headers: IncomingHttpHeaders,
    tokenRequired: boolean,
) => {
    const { origin } = headers;
    if (origin !== undefined && !isLoopbackOrigin(origin)) {
        return `Origin ${origin} is not allowed`;
    }

    if (!isLoopbackIp(bindHost) && tokenRequired) return undefined;

    const hostname = hostnameOfHostHeader(headers.host);
    if (hostname === undefined) return 'Missing or invalid Host header';

    const allowed = isLoopbackIp(bindHost)
        ? isLoopbackName(hostname)
        : isIpLiteral(hostname);
    return allowed ? undefined : `Host ${headers.host} is not allowed`;
};

const digest = (value: string) => createHash('sha256').update(value).digest();

// True when no token is configured or the header carries exactly it.
export const checkBearer = (token: string, authorization?: string) => {
    if (token === '') return true;
    const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
    return match != null && timingSafeEqual(digest(match[1]), digest(token));
};

export const isJsonContentType = (contentType?: string) =>
    contentType?.split(';')[0].trim().toLowerCase() === 'application/json';

export class BodyTooLargeError extends Error {}

// Reads the request body as UTF-8. Stops reading and rejects with
// BodyTooLargeError as soon as it is known to exceed `limit` bytes.
export const readBody = (req: IncomingMessage, limit: number) =>
    new Promise<string>((resolve, reject) => {
        const tooLarge = () =>
            reject(new BodyTooLargeError(`Body exceeds ${limit} bytes`));

        if (Number(req.headers['content-length'] ?? 0) > limit) {
            req.pause();
            tooLarge();
            return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        const onData = (chunk: Buffer) => {
            size += chunk.length;
            if (size > limit) {
                req.off('data', onData);
                req.pause();
                tooLarge();
                return;
            }
            chunks.push(chunk);
        };
        req.on('data', onData);
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
