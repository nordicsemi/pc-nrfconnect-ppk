/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

// The jest environment of the app: jsdom, as from the shared config. Only for
// the remote control tests it adds what Electron's renderer has and jsdom
// lacks: the Fetch API (used by the MCP transport and the MCP client in tests)
// and crypto.randomUUID, borrowed from Node. Those tests also resolve
// packages with Node's export conditions, as esbuild bundles the app's Node
// code, not jsdom's "browser" ones (the MCP client would otherwise get an
// ESM-only browser build of a dependency). A file pragma cannot select this
// instead: jest only reads the first comment, which is the license header.

const { TestEnvironment } = require('jest-environment-jsdom');
const { randomUUID } = require('crypto');
const path = require('path');

const REMOTE_CONTROL_DIR = `${path.sep}features${path.sep}remoteControl${path.sep}`;

const FETCH_GLOBALS = [
    'fetch',
    'Request',
    'Response',
    'Headers',
    'ReadableStream',
    'WritableStream',
    'TransformStream',
    'TextEncoder',
    'TextDecoder',
    'TextDecoderStream',
];

class AppTestEnvironment extends TestEnvironment {
    constructor(config, context) {
        super(config, context);
        this.withFetch = context.testPath.includes(REMOTE_CONTROL_DIR);
        if (this.withFetch) {
            this.customExportConditions = ['node', 'node-addons'];
        }
    }

    async setup() {
        await super.setup();
        if (!this.withFetch) return;

        FETCH_GLOBALS.forEach(name => {
            if (this.global[name] === undefined) {
                this.global[name] = globalThis[name];
            }
        });
        // Node's fetch only takes its own AbortSignal, not jsdom's.
        this.global.AbortController = AbortController;
        this.global.AbortSignal = AbortSignal;
        if (this.global.crypto.randomUUID === undefined) {
            this.global.crypto.randomUUID = randomUUID;
        }
    }
}

module.exports = AppTestEnvironment;
