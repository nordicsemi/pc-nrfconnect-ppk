/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

// The import plugin's resolver does not follow package "exports" maps, which
// TypeScript and esbuild do.
/* eslint-disable import/no-unresolved */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
    CallToolRequestSchema,
    type CallToolResult,
    ErrorCode as McpErrorCode,
    ListToolsRequestSchema,
    McpError,
    type Tool,
} from '@modelcontextprotocol/sdk/types.js';
/* eslint-enable import/no-unresolved */
import { type IncomingMessage, type ServerResponse } from 'http';

import { version } from '../../../package.json';
import { canWrite } from './httpResponse';
import { toJsonSchema } from './jsonSchema';
import {
    type JsonOperation,
    mcpAnnotations,
    type Operation,
    type OperationResult,
    runOperation,
    type ServerContext,
} from './operation';

export const MCP_SERVER_NAME = 'ppk';

const isMcpOperation = (operation: Operation): operation is JsonOperation =>
    operation.mcp !== false;

const toTool = (operation: JsonOperation): Tool => {
    const { $schema: _schema, ...inputSchema } = toJsonSchema(
        operation.schema,
        { $refStrategy: 'none' },
    );
    return {
        name: operation.name,
        description: operation.description,
        inputSchema: { ...inputSchema, type: 'object' },
        annotations: mcpAnnotations[operation.annotation],
    };
};

const toCallToolResult = (result: OperationResult): CallToolResult => ({
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
    isError: result.status === 'error',
});

const createMcpServer = (
    operations: readonly Operation[],
    context: ServerContext,
    instructions?: string,
) => {
    const tools = operations.filter(isMcpOperation);
    const server = new Server(
        { name: MCP_SERVER_NAME, version },
        { capabilities: { tools: {} }, instructions },
    );
    server.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: tools.map(toTool),
    }));
    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        const operation = tools.find(tool => tool.name === params.name);
        if (!operation) {
            throw new McpError(
                McpErrorCode.InvalidParams,
                `Unknown tool: ${params.name}`,
            );
        }
        const result = await runOperation(operation, params.arguments, {
            ...context,
            origin: 'MCP',
        });
        return toCallToolResult(result);
    });
    return server;
};

// Headers passed on to the SDK. Host, Origin and Authorization are checked
// before; an allow-list keeps the behaviour the same in Electron's renderer,
// where Chromium's Request silently drops "forbidden" headers, and in Node.
const FORWARDED_HEADERS = [
    'accept',
    'content-type',
    'mcp-protocol-version',
    'mcp-session-id',
    'last-event-id',
];

// `path` is the parsed path and query: req.url may be in absolute form.
const toWebRequest = (req: IncomingMessage, path: string, body: string) => {
    const headers = new Headers();
    FORWARDED_HEADERS.forEach(name => {
        const value = req.headers[name];
        if (typeof value === 'string') headers.set(name, value);
    });
    return new Request(`http://localhost${path}`, {
        method: req.method,
        headers,
        body: req.method === 'POST' ? body : undefined,
    });
};

// Handles one MCP request statelessly: a fresh server and transport per
// request, closed after the response. JSON responses only (no SSE), so the
// response is buffered and written in one go.
export const handleMcpRequest = async (
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    body: string,
    {
        operations,
        context,
        instructions,
    }: {
        operations: readonly Operation[];
        context: ServerContext;
        instructions?: string;
    },
) => {
    const server = createMcpServer(operations, context, instructions);
    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    });
    try {
        await server.connect(transport);
        const response = await transport.handleRequest(
            toWebRequest(req, path, body),
        );
        const payload = Buffer.from(await response.arrayBuffer());
        if (!canWrite(res)) return;
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(payload);
    } finally {
        await Promise.allSettled([transport.close(), server.close()]);
    }
};
