/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { fileNameSchema, openExport } from '../exportFiles';
import { defineOperation, operationError, RawResponse } from '../operation';

export default defineOperation({
    name: 'download_export',
    description: 'Downloads a file written by export_csv.',
    annotation: 'read',
    mcp: false,
    responseContentType: 'text/csv',
    input: {
        name: fileNameSchema.refine(
            name => name.toLowerCase().endsWith('.csv'),
            'must end with .csv',
        ),
    },
    rest: { method: 'GET', path: '/api/export/:name' },
    queue: 'none',
    handler: async ({ name }) => {
        const opened = await openExport(name);
        if (!opened) {
            return operationError('not_found', `There is no export ${name}`);
        }
        return new RawResponse(
            'text/csv; charset=utf-8',
            opened.handle.createReadStream(),
            {
                'Content-Disposition': `attachment; filename="${name}"`,
                'Content-Length': String(opened.size),
            },
        );
    },
});
