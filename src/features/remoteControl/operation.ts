/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import {
    type AppDispatch,
    logger,
} from '@nordicsemiconductor/pc-nrfconnect-shared';
import { type Readable } from 'stream';
import { z } from 'zod';

import { type RootState } from '../../slices';
import { abortable } from './abortable';
import { MAX_MV_PARAM } from './clientVoltageLimit';
import { controlQueue } from './controlQueue';

// How an operation affects the app, mapped to MCP tool annotations:
// - `read`: only reads state,
// - `control`: changes state, nothing that cannot be undone,
// - `destructive`: may cut power to the device under test or similar.
export type Annotation = 'read' | 'control' | 'destructive';

export const mcpAnnotations = {
    read: { readOnlyHint: true, openWorldHint: false },
    control: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
    },
    destructive: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
    },
} as const satisfies Record<Annotation, object>;

// Error codes an operation may return, with the HTTP status REST answers
// with. Adding a code forces choosing its status.
export const errorHttpStatus = {
    invalid_argument: 400,
    out_of_range: 400,
    not_found: 404,
    wrong_mode: 409,
    unsaved_data: 409,
    already_running: 409,
    exists: 409,
    no_data: 409,
    file_loaded: 409,
    sampling_running: 409,
    temp_disk_missing: 409,
    disk_full: 409,
    data_changed: 409,
    cancelled: 409,
    internal: 500,
    no_device: 503,
    busy: 503,
    timeout: 504,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof errorHttpStatus;

// A type, not an interface, to be assignable to MCP's structuredContent.
// Some errors carry context, e.g. the allowed range or the actual state.
export type OperationError = {
    status: 'error';
    error: ErrorCode;
    message: string;
} & Record<string, unknown>;

export type OperationResult =
    | ({ status: 'ok' } & Record<string, unknown>)
    | OperationError;

export const operationError = (
    error: ErrorCode,
    message: string,
    details: Record<string, unknown> = {},
): OperationError => ({ ...details, status: 'error', error, message });

// A non-JSON REST response, e.g. a file download.
export class RawResponse {
    constructor(
        readonly contentType: string,
        readonly body: Buffer | Readable,
        readonly headers: Record<string, string> = {},
    ) {}
}

export type Origin = 'MCP' | 'REST';

export interface OperationContext {
    getState: () => RootState;
    dispatch: AppDispatch;
    // The Redux store's subscribe: listener called after every dispatch.
    subscribe: (listener: () => void) => () => void;
    // Which API the call came through, e.g. for `[MCP]` log prefixes.
    origin: Origin;
    // Aborted when the call times out or its server stops; long handlers
    // stop and clean up.
    signal: AbortSignal;
    // True when the call may switch the DUT power on (see `powersOn`) and
    // the power was switched off since it was made: a handler that turns
    // the power on checks it afterwards and switches the power off again.
    poweredOff: () => boolean;
    // The `max_mV` of the client's URL, if given: lowers the highest voltage
    // this call may set or switch on (see effectiveVoltageRange).
    maxMv?: number;
}

// What the servers provide; runOperation adds the rest per call.
export type ServerContext = Omit<
    OperationContext,
    'origin' | 'signal' | 'poweredOff'
> & {
    // Aborted when the server stops: its queued calls never run, its
    // running ones are aborted.
    stopSignal?: AbortSignal;
};
// What a server passes to runOperation for one call.
export type CallContext = ServerContext & Pick<OperationContext, 'origin'>;

// A check of the state (and the arguments and the call, e.g. its maxMv)
// before the handler runs: the error to answer with, or undefined when the
// call may go on. Method syntax keeps the arguments bivariant, so that every
// operation is an `Operation`.
export type Guard<Args = never> = {
    check(
        state: RootState,
        args: Args,
        context: OperationContext,
    ): OperationError | undefined;
}['check'];

type RestPath = `/api/${string}`;

type QueueMode = 'serial' | 'none';
type QueueModeOf<Args> = { of(args: Args): QueueMode }['of'];

interface OperationBase<Shape extends z.ZodRawShape, A extends Annotation> {
    // MCP tool name, without a `ppk_` prefix (clients add the server name).
    name: string;
    description: string;
    annotation: A;
    // Arguments, validated the same way for MCP and REST: unknown keys are
    // rejected. REST takes them from the JSON body (POST) or the query (GET),
    // plus `:name` path parameters; number and boolean fields are converted
    // from their string form there. Checks across fields belong in the
    // handler, which returns `invalid_argument` for them.
    input: Shape;
    // GET is only allowed for read operations.
    rest: {
        method: A extends 'read' ? 'GET' | 'POST' : 'POST';
        path: RestPath;
    };
    // Media type of the 200 response, for the OpenAPI document; JSON unless
    // the handler returns a RawResponse of another type.
    responseContentType?: string;
    // Calls run one at a time ('serial', the default) or alongside
    // everything else ('none', e.g. cheap reads of the state); may depend
    // on the arguments.
    queue?: QueueMode | QueueModeOf<z.infer<z.ZodObject<Shape>>>;
    // A call answered with `timeout` after this long; default 10 s.
    timeoutMs?: number;
    // True for a call that may switch the DUT power on: a power off
    // (controlQueue.powerOff) cancels it while it is queued.
    powersOn?(args: z.infer<z.ZodObject<Shape>>): boolean;
    // Checked in order, when the call runs, before the handler; the first
    // error is the answer.
    guards?: readonly Guard<z.infer<z.ZodObject<Shape>>>[];
}

// What an operation is written as; defineOperation turns it into one.
// An operation exposed both as an MCP tool and a REST endpoint.
export interface JsonOperationSpec<
    Shape extends z.ZodRawShape = z.ZodRawShape,
    A extends Annotation = Annotation,
> extends OperationBase<Shape, A> {
    mcp?: true;
    handler(
        args: z.infer<z.ZodObject<Shape>>,
        context: OperationContext,
    ): OperationResult | Promise<OperationResult>;
}

// A REST-only endpoint, which may answer with a raw (non-JSON) body.
export interface RestOnlyOperationSpec<
    Shape extends z.ZodRawShape = z.ZodRawShape,
    A extends Annotation = Annotation,
> extends OperationBase<Shape, A> {
    mcp: false;
    handler(
        args: z.infer<z.ZodObject<Shape>>,
        context: OperationContext,
    ): OperationResult | RawResponse | Promise<OperationResult | RawResponse>;
}

// Computed once by defineOperation, used on every request.
interface Compiled {
    // The arguments schema; unknown keys are rejected.
    readonly schema: z.ZodTypeAny;
    // Matches `rest.path`, capturing the path parameters in order.
    readonly pathPattern: RegExp;
    readonly pathParameters: readonly string[];
}

export type JsonOperation<
    Shape extends z.ZodRawShape = z.ZodRawShape,
    A extends Annotation = Annotation,
> = JsonOperationSpec<Shape, A> & Compiled;

export type RestOnlyOperation<
    Shape extends z.ZodRawShape = z.ZodRawShape,
    A extends Annotation = Annotation,
> = RestOnlyOperationSpec<Shape, A> & Compiled;

export type Operation<
    Shape extends z.ZodRawShape = z.ZodRawShape,
    A extends Annotation = Annotation,
> = JsonOperation<Shape, A> | RestOnlyOperation<Shape, A>;

const escapeRegExp = (text: string) =>
    text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Checks what the types cannot catch (e.g. a loosely typed spec) and
// precomputes the validation schema and the path matcher.
export function defineOperation<
    Shape extends z.ZodRawShape,
    A extends Annotation,
>(spec: JsonOperationSpec<Shape, A>): JsonOperation<Shape, A>;
export function defineOperation<
    Shape extends z.ZodRawShape,
    A extends Annotation,
>(spec: RestOnlyOperationSpec<Shape, A>): RestOnlyOperation<Shape, A>;
export function defineOperation(
    spec: JsonOperationSpec | RestOnlyOperationSpec,
): Operation {
    const { name, annotation, rest, input } = spec;
    if (rest.method === 'GET' && annotation !== 'read') {
        throw new Error(
            `Operation ${name}: GET is only allowed for read operations`,
        );
    }
    if (MAX_MV_PARAM in input) {
        throw new Error(
            `Operation ${name}: ${MAX_MV_PARAM} is reserved for the client's voltage limit`,
        );
    }
    const pathParameters = [...rest.path.matchAll(/:(\w+)/g)].map(
        ([, parameter]) => parameter,
    );
    const missing = pathParameters.filter(p => !(p in input));
    if (missing.length > 0) {
        throw new Error(
            `Operation ${name}: path parameters ${missing.join(', ')} are missing in input`,
        );
    }
    const pattern = rest.path.split(/:\w+/).map(escapeRegExp).join('([^/]+)');
    return {
        ...spec,
        schema: z.object(input).strict(),
        pathPattern: new RegExp(`^${pattern}$`),
        pathParameters,
    };
}

const formatIssues = (error: z.ZodError) =>
    error.issues
        .map(issue =>
            issue.path.length > 0
                ? `${issue.path.join('.')}: ${issue.message}`
                : issue.message,
        )
        .join('; ');

export const DEFAULT_TIMEOUT_MS = 10_000;
export const QUEUE_WAIT_MS = 15_000;

// Runs the guards and the handler; an exception becomes an `internal`
// error.
const settle = async (
    operation: Operation,
    args: unknown,
    context: OperationContext,
): Promise<OperationResult | RawResponse> => {
    try {
        const state = context.getState();
        const refused = operation.guards?.reduce<OperationError | undefined>(
            (found, guard) => found ?? guard(state, args as never, context),
            undefined,
        );
        if (refused) return refused;
        return await operation.handler(args as never, context);
    } catch (error) {
        return operationError(
            'internal',
            error instanceof Error ? error.message : String(error),
        );
    }
};

const powerSwitchedOff = () =>
    operationError(
        'cancelled',
        'Cancelled: the DUT power was switched off while this call was queued',
    );
const serverStopped = () =>
    operationError('cancelled', 'Cancelled: the server was stopped');

// Answers `timeout` after timeoutMs (or `cancelled` when the server stops)
// and aborts the handler, which may go on running; `running` settles only
// when the handler itself is done.
const withTimeout = (
    operation: Operation,
    args: unknown,
    context: CallContext & Pick<OperationContext, 'poweredOff'>,
) => {
    const timeout = new AbortController();
    const timeoutMs = operation.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const { stopSignal } = context;
    const signal = stopSignal
        ? AbortSignal.any([timeout.signal, stopSignal])
        : timeout.signal;
    const running = settle(operation, args, { ...context, signal });
    // `running` never rejects: only the abort does.
    const answer = abortable(running, signal)
        .catch(() =>
            stopSignal?.aborted
                ? serverStopped()
                : operationError(
                      'timeout',
                      `${operation.name} did not finish within ${timeoutMs / 1000} s`,
                  ),
        )
        .finally(() => clearTimeout(timer));
    return { answer, running };
};

const queueMode = (operation: Operation, args: unknown): QueueMode =>
    typeof operation.queue === 'function'
        ? operation.queue(args as never)
        : (operation.queue ?? 'serial');

const execute = async (
    operation: Operation,
    args: unknown,
    context: CallContext,
): Promise<OperationResult | RawResponse> => {
    if (context.stopSignal?.aborted) return serverStopped();
    if (queueMode(operation, args) === 'none') {
        return withTimeout(operation, args, {
            ...context,
            poweredOff: () => false,
        }).answer;
    }
    const slot = await controlQueue.acquire(
        { name: operation.name, origin: context.origin },
        {
            waitMs: QUEUE_WAIT_MS,
            powersOn: operation.powersOn?.(args as never) ?? false,
            signal: context.stopSignal,
        },
    );
    if (slot === 'stopped') return serverStopped();
    if (slot === 'busy') {
        return operationError(
            'busy',
            `Another call is still running (${controlQueue.busyOp?.name}); try again later`,
        );
    }
    if (slot === 'cancelled') return powerSwitchedOff();
    // A power off after the call left the queue, before it got here:
    // powerOff() did not find it among the waiting calls.
    if (slot.poweredOff()) {
        slot.release();
        return powerSwitchedOff();
    }
    const { answer, running } = withTimeout(operation, args, {
        ...context,
        poweredOff: slot.poweredOff,
    });
    // The queue stays locked until the handler is really done, also after
    // a timeout, so that no two handlers ever overlap.
    running.finally(slot.release);
    return answer;
};

// Calls of operations that are not read-only are logged when refused, so
// the human sees what an agent tried.
const logRefusal = (
    operation: Operation,
    origin: Origin,
    result: OperationResult | RawResponse,
) => {
    if (
        operation.annotation !== 'read' &&
        !(result instanceof RawResponse) &&
        result.status === 'error' &&
        result.error !== 'invalid_argument'
    ) {
        logger.info(
            `[${origin}] ${operation.name} refused (${result.error}): ${result.message}`,
        );
    }
};

// Validates the arguments and runs the handler: queued, with a timeout and
// an abort signal (see the spec fields). Never throws: an exception from the
// handler becomes an `internal` error. Only a REST-only operation can answer
// with a RawResponse.
export function runOperation(
    operation: JsonOperation,
    rawArgs: unknown,
    context: CallContext,
): Promise<OperationResult>;
export function runOperation(
    operation: Operation,
    rawArgs: unknown,
    context: CallContext,
): Promise<OperationResult | RawResponse>;
export async function runOperation(
    operation: Operation,
    rawArgs: unknown,
    context: CallContext,
): Promise<OperationResult | RawResponse> {
    const parsed = operation.schema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
        return operationError('invalid_argument', formatIssues(parsed.error));
    }
    const result = await execute(operation, parsed.data, context);
    logRefusal(operation, context.origin, result);
    return result;
}
