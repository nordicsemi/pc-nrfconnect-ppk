/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { type ServerResponse } from 'http';
import { pipeline } from 'stream';
import { z } from 'zod';

import { MAX_MV_PARAM } from './clientVoltageLimit';
import { canWrite, sendJson } from './httpResponse';
import {
    errorHttpStatus,
    type Operation,
    operationError,
    RawResponse,
    runOperation,
    type ServerContext,
} from './operation';

const sendRaw = (res: ServerResponse, raw: RawResponse) => {
    if (!canWrite(res)) {
        if (!Buffer.isBuffer(raw.body)) raw.body.destroy();
        return;
    }
    res.writeHead(200, { ...raw.headers, 'Content-Type': raw.contentType });
    if (Buffer.isBuffer(raw.body)) {
        res.end(raw.body);
    } else {
        // Unlike pipe(), destroys the source (e.g. an open file) when the
        // client goes away, and the response when the source fails.
        pipeline(raw.body, res, () => {});
    }
};

export interface RestRoute {
    operation: Operation;
    params: Record<string, string>;
}

export type RouteMatch =
    | { found: true; route: RestRoute }
    | { found: false; allowed: string[] };

const decodePathSegment = (segment: string) => {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment; // malformed escape: left for validation to reject
    }
};

// Finds the operation for a method and path. When the path exists but not
// for this method, `allowed` lists the methods it does take (for 405).
export const matchRoute = (
    operations: readonly Operation[],
    method: string,
    pathname: string,
): RouteMatch => {
    const allowed: string[] = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const operation of operations) {
        const match = operation.pathPattern.exec(pathname);
        if (match) {
            if (operation.rest.method !== method) {
                allowed.push(operation.rest.method);
            } else {
                const params = Object.fromEntries(
                    operation.pathParameters.map((name, i) => [
                        name,
                        decodePathSegment(match[i + 1]),
                    ]),
                );
                return { found: true, route: { operation, params } };
            }
        }
    }
    return { found: false, allowed };
};

const unwrap = (schema: z.ZodTypeAny): z.ZodTypeAny => {
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
        return unwrap(schema.unwrap());
    }
    if (schema instanceof z.ZodDefault) return unwrap(schema.removeDefault());
    // A refinement or transform takes what its inner schema takes; a pipeline
    // takes what its first schema takes.
    if (schema instanceof z.ZodEffects) return unwrap(schema.innerType());
    // eslint-disable-next-line no-underscore-dangle -- no public accessor
    if (schema instanceof z.ZodPipeline) return unwrap(schema._def.in);
    return schema;
};

// Converts query and path strings to numbers/booleans where the schema says so.
const coerceStrings = (
    shape: z.ZodRawShape,
    values: Record<string, string | string[]>,
) =>
    Object.fromEntries(
        Object.entries(values).map(([key, value]) => {
            const field = shape[key] ? unwrap(shape[key]) : undefined;
            if (typeof value !== 'string' || !field) return [key, value];
            if (field instanceof z.ZodNumber && value.trim() !== '') {
                const number = Number(value);
                return [key, Number.isNaN(number) ? value : number];
            }
            if (field instanceof z.ZodBoolean) {
                if (value === 'true') return [key, true];
                if (value === 'false') return [key, false];
            }
            return [key, value];
        }),
    );

// The query arguments of a GET; max_mV is the client's voltage limit, which
// the server has taken already (it is never an argument, see
// defineOperation).
const queryObject = (searchParams: URLSearchParams) => {
    const result: Record<string, string | string[]> = {};
    searchParams.forEach((value, key) => {
        if (key === MAX_MV_PARAM) return;
        const existing = result[key];
        if (existing === undefined) result[key] = value;
        else result[key] = [existing, value].flat();
    });
    return result;
};

// Runs a REST route. `body` is the parsed JSON body of a POST, undefined for
// GET (whose arguments come from the query).
export const handleRestRoute = async (
    res: ServerResponse,
    { operation, params }: RestRoute,
    searchParams: URLSearchParams,
    body: unknown,
    context: ServerContext,
) => {
    const fromStrings = coerceStrings(operation.input, {
        ...(operation.rest.method === 'GET' ? queryObject(searchParams) : {}),
        ...params,
    });
    let args: unknown = fromStrings;
    if (operation.rest.method === 'POST') {
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            sendJson(
                res,
                400,
                operationError(
                    'invalid_argument',
                    'The body must be a JSON object',
                ),
            );
            return;
        }
        args = { ...body, ...fromStrings };
    }

    const result = await runOperation(operation, args, {
        ...context,
        origin: 'REST',
    });
    if (result instanceof RawResponse) {
        sendRaw(res, result);
    } else if (result.status === 'ok') {
        sendJson(res, 200, result);
    } else {
        sendJson(res, errorHttpStatus[result.error], result);
    }
};
