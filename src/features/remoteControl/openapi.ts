/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { version } from '../../../package.json';
import { MAX_MV_PARAM } from './clientVoltageLimit';
import { toJsonSchema } from './jsonSchema';
import { errorHttpStatus, type Operation } from './operation';

export const OPENAPI_PATH = '/api/openapi.json';

type JsonObject = Record<string, unknown>;

const errorRef = { $ref: '#/components/schemas/Error' };

// Taken on every request, see clientVoltageLimit.ts.
const maxMvParameter = {
    name: MAX_MV_PARAM,
    in: 'query',
    required: false,
    description:
        "This client's own voltage limit in mV: lowers the highest voltage set_voltage and power may set or switch on, never raises the voltage limit set in the app. A guard against slips, not a security boundary. An invalid value is answered with 400.",
    schema: { type: 'integer', minimum: 1 },
};
const maxMvRef = { $ref: `#/components/parameters/${MAX_MV_PARAM}` };

const jsonResponse = (description: string, schema: JsonObject) => ({
    description,
    content: { 'application/json': { schema } },
});

const errorDescriptions: Record<number, string> = {
    400: 'Invalid arguments (invalid_argument, out_of_range)',
    401: 'Missing or wrong bearer token',
    403: 'Host or Origin not allowed',
    404: 'Not found',
    409: 'Not possible in the current state of the app',
    500: 'Internal error',
    503: 'No device selected, or another call is still running',
    504: 'The call timed out',
};

// The statuses REST can answer with: every error status of an operation,
// 401 only with a token (otherwise nothing is checked), 404 only where a
// path names a resource.
const errorStatuses = (hasPathParams: boolean, hasToken: boolean) =>
    [
        ...new Set([
            ...Object.values<number>(errorHttpStatus),
            403,
            ...(hasToken ? [401] : []),
        ]),
    ]
        .filter(code => code !== 404 || hasPathParams)
        .sort();

interface Described {
    method: 'get' | 'post';
    path: string;
    operationId: string;
    description: string;
    // Arguments as a JSON schema, without the path parameters.
    parameters: JsonObject[];
    requestBody?: JsonObject;
    contentType: string;
    pathParams: boolean;
}

const fromOperation = (operation: Operation): Described => {
    const { properties = {}, required = [] } = toJsonSchema(operation.schema, {
        $refStrategy: 'none',
    }) as { properties?: JsonObject; required?: string[] };
    const isPath = (name: string) => operation.pathParameters.includes(name);
    const parameter = (name: string, location: 'path' | 'query') => ({
        name,
        in: location,
        required: location === 'path' || required.includes(name),
        schema: properties[name],
    });
    const rest = Object.keys(properties).filter(name => !isPath(name));
    const pathParameters = operation.pathParameters.map(name =>
        parameter(name, 'path'),
    );
    const isGet = operation.rest.method === 'GET';
    const bodyRequired = required.filter(name => !isPath(name));

    return {
        method: isGet ? 'get' : 'post',
        path: operation.rest.path.replace(/:(\w+)/g, '{$1}'),
        operationId: operation.name,
        description: operation.description,
        parameters: [
            ...pathParameters,
            ...(isGet ? rest.map(name => parameter(name, 'query')) : []),
            maxMvRef,
        ],
        requestBody: isGet
            ? undefined
            : {
                  required: bodyRequired.length > 0,
                  content: {
                      'application/json': {
                          schema: {
                              type: 'object',
                              properties: Object.fromEntries(
                                  rest.map(name => [name, properties[name]]),
                              ),
                              required: bodyRequired,
                              additionalProperties: false,
                          },
                      },
                  },
              },
        contentType: operation.responseContentType ?? 'application/json',
        pathParams: operation.pathParameters.length > 0,
    };
};

const openApiOperation: Described = {
    method: 'get',
    path: OPENAPI_PATH,
    operationId: 'get_openapi',
    description:
        'This OpenAPI document, generated from the operations the server has registered.',
    parameters: [maxMvRef],
    contentType: 'application/json',
    pathParams: false,
};

const toPathItem = (
    {
        method,
        operationId,
        description,
        parameters,
        requestBody,
        ...rest
    }: Described,
    hasToken: boolean,
) => ({
    [method]: {
        operationId,
        summary: description.split(/(?<=\.)\s/)[0],
        description,
        parameters,
        ...(requestBody && { requestBody }),
        responses: {
            200:
                rest.contentType === 'application/json'
                    ? jsonResponse('Success', {
                          type: 'object',
                          required: ['status'],
                          properties: { status: { const: 'ok' } },
                      })
                    : {
                          description: 'Success',
                          content: {
                              [rest.contentType]: {
                                  schema: { type: 'string' },
                              },
                          },
                      },
            ...Object.fromEntries(
                errorStatuses(rest.pathParams, hasToken).map(code => [
                    code,
                    jsonResponse(errorDescriptions[code], errorRef),
                ]),
            ),
        },
    },
});

// The OpenAPI 3.1 description of the REST API, built from the registered
// operations, so that it cannot drift from what the server does.
// `serverUrl` is where the request came to; `hasToken` whether a bearer
// token is required.
export const buildOpenApiDocument = (
    operations: readonly Operation[],
    { serverUrl, hasToken }: { serverUrl: string; hasToken: boolean },
) => {
    const paths: Record<string, JsonObject> = {};
    [...operations.map(fromOperation), openApiOperation].forEach(described => {
        paths[described.path] = {
            ...paths[described.path],
            ...toPathItem(described, hasToken),
        };
    });
    return {
        openapi: '3.1.0',
        info: { title: 'Power Profiler remote control', version },
        servers: [{ url: serverUrl }],
        paths,
        components: {
            parameters: { [MAX_MV_PARAM]: maxMvParameter },
            schemas: {
                Error: {
                    type: 'object',
                    required: ['status', 'error', 'message'],
                    properties: {
                        status: { const: 'error' },
                        error: {
                            type: 'string',
                            description:
                                'Error code, e.g. invalid_argument, wrong_mode, busy',
                        },
                        message: { type: 'string' },
                    },
                    additionalProperties: true,
                },
            },
            ...(hasToken && {
                securitySchemes: {
                    bearerAuth: { type: 'http', scheme: 'bearer' },
                },
            }),
        },
        ...(hasToken && { security: [{ bearerAuth: [] }] }),
    };
};
