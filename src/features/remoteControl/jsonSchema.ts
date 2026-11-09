/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { zodToJsonSchema } from 'zod-to-json-schema';

// zod-to-json-schema's generic signature exceeds tsc's instantiation depth
// with zod 3.25; the result is a plain JSON schema object anyway.
export const toJsonSchema = zodToJsonSchema as (
    schema: unknown,
    options: { $refStrategy: 'none' },
) => Record<string, unknown>;
