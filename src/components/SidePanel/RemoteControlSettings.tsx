/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Button,
    Group,
    newCopiedFlashMessage,
    newErrorFlashMessage,
    Toggle,
} from '@nordicsemiconductor/pc-nrfconnect-shared';
import { randomBytes } from 'crypto';
import { clipboard } from 'electron';

import {
    isExposed,
    listenError,
    mcpJsonSnippet,
    openApiUrl,
} from '../../features/remoteControl/clientConfig';
import { type PartStatus } from '../../features/remoteControl/RemoteControl';
import {
    getRemoteControlConfig,
    getRemoteControlStatus,
    setMcpEnabled,
    setMcpListen,
    setRestEnabled,
    setRestListen,
    setToken,
} from '../../features/remoteControl/remoteControlSlice';
import { voltageRegulatorState } from '../../slices/voltageRegulatorSlice';

const inputClass =
    'tw-w-full tw-border tw-border-solid tw-border-gray-400 tw-bg-transparent tw-px-1 tw-text-xs';

// A text field that only commits on blur or Enter, never per keystroke.
const CommitInput = ({
    label,
    value,
    onCommit,
    validate,
    type = 'text',
}: {
    label: string;
    value: string;
    onCommit: (value: string) => void;
    validate?: (value: string) => string | undefined;
    type?: 'text' | 'password';
}) => {
    const [draft, setDraft] = useState(value);
    const [error, setError] = useState<string>();

    useEffect(() => {
        setDraft(value);
        setError(undefined);
    }, [value]);

    const commit = () => {
        const text = draft.trim();
        const problem = validate?.(text);
        setError(problem);
        if (!problem && text !== value) onCommit(text);
    };

    return (
        <div className="tw-flex tw-flex-col tw-gap-0.5 tw-text-xs">
            <input
                aria-label={label}
                className={`${inputClass} ${error ? 'tw-border-red' : ''}`}
                type={type}
                value={draft}
                spellCheck={false}
                onChange={event => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={event => event.key === 'Enter' && commit()}
            />
            {error && (
                <span role="alert" className="tw-text-red">
                    {error}
                </span>
            )}
        </div>
    );
};

const StatusLine = ({ status }: { status: PartStatus }) => {
    if (status.state === 'error') {
        return <span className="tw-text-xs tw-text-red">{status.message}</span>;
    }
    return (
        <span className="tw-text-xs tw-text-gray-400">
            {status.state === 'running'
                ? `Running on ${status.url}`
                : 'Stopped'}
        </span>
    );
};

const Part = ({
    title,
    enabled,
    listen,
    status,
    onEnabled,
    onListen,
}: {
    title: string;
    enabled: boolean;
    listen: string;
    status: PartStatus;
    onEnabled: (enabled: boolean) => void;
    onListen: (listen: string) => void;
}) => (
    <div className="tw-flex tw-flex-col tw-gap-1">
        <Toggle
            label={title}
            isToggled={enabled}
            onToggle={onEnabled}
            variant="primary"
        />
        <CommitInput
            label={`${title} listen address`}
            value={listen}
            onCommit={onListen}
            validate={listenError}
        />
        <StatusLine status={status} />
    </div>
);

// Electron's clipboard works without window focus, unlike navigator.clipboard.
const useCopy = () => {
    const dispatch = useDispatch();
    return (text: string) => {
        try {
            clipboard.writeText(text);
            dispatch(newCopiedFlashMessage());
        } catch (error) {
            dispatch(
                newErrorFlashMessage(
                    `Could not copy to the clipboard: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                ),
            );
        }
    };
};

// The API has no voltage setting of its own: the cap in Advanced
// Configuration limits it, max_mV in a client's URL limits one client more.
const VoltageLimit = () => {
    const { maxCap } = useSelector(voltageRegulatorState);
    return (
        <span className="tw-text-xs tw-text-gray-400">
            Voltage limit: {maxCap} mV (set in Advanced Configuration). Add{' '}
            <code>?max_mV=</code> to the URL of an agent to limit it further.
        </span>
    );
};

const TokenField = ({ token }: { token: string }) => {
    const dispatch = useDispatch();
    const [visible, setVisible] = useState(false);
    const copy = useCopy();

    return (
        <div className="tw-flex tw-flex-col tw-gap-1">
            <span className="tw-text-xs">Token</span>
            <CommitInput
                label="Token"
                type={visible ? 'text' : 'password'}
                value={token}
                onCommit={value => dispatch(setToken(value))}
            />
            <div className="tw-grid tw-grid-cols-2 tw-gap-1">
                <Button
                    className="tw-w-full"
                    variant="secondary"
                    onClick={() => setVisible(!visible)}
                >
                    {visible ? 'Hide' : 'Show'}
                </Button>
                <Button
                    className="tw-w-full"
                    variant="secondary"
                    onClick={() =>
                        dispatch(setToken(randomBytes(16).toString('hex')))
                    }
                >
                    Generate
                </Button>
                <Button
                    className="tw-w-full"
                    variant="secondary"
                    disabled={!token}
                    onClick={() => copy(token)}
                >
                    Copy
                </Button>
                <Button
                    className="tw-w-full"
                    variant="secondary"
                    disabled={!token}
                    onClick={() => dispatch(setToken(''))}
                >
                    Clear
                </Button>
            </div>
        </div>
    );
};

export default () => {
    const dispatch = useDispatch();
    const config = useSelector(getRemoteControlConfig);
    const status = useSelector(getRemoteControlStatus);

    const exposed =
        (config.mcpEnabled && isExposed(config.mcpListen)) ||
        (config.restEnabled && isExposed(config.restListen));
    const snippet = mcpJsonSnippet(config.mcpListen, config.token);
    const copy = useCopy();
    const openApi =
        status.rest.state === 'running' ? openApiUrl(config.restListen) : null;

    return (
        <Group
            heading="Remote Control"
            collapsible
            defaultCollapsed
            collapseStatePersistenceId="remote-control-group"
            gap={4}
        >
            <Part
                title="MCP server"
                enabled={config.mcpEnabled}
                listen={config.mcpListen}
                status={status.mcp}
                onEnabled={enabled => dispatch(setMcpEnabled(enabled))}
                onListen={listen => dispatch(setMcpListen(listen))}
            />
            <Part
                title="REST API"
                enabled={config.restEnabled}
                listen={config.restListen}
                status={status.rest}
                onEnabled={enabled => dispatch(setRestEnabled(enabled))}
                onListen={listen => dispatch(setRestListen(listen))}
            />

            <div className="tw-flex tw-flex-col tw-gap-1">
                <TokenField token={config.token} />
                {exposed && !config.token && (
                    <span
                        role="alert"
                        className="tw-border tw-border-solid tw-border-orange tw-p-1 tw-text-xs tw-text-orange"
                    >
                        Listening on a non-loopback address without a token:
                        anyone on the network can control the PPK2.
                    </span>
                )}
            </div>

            <VoltageLimit />

            <Button
                variant="secondary"
                disabled={snippet == null}
                onClick={() => snippet && copy(snippet)}
            >
                Copy .mcp.json snippet
            </Button>
            <Button
                variant="secondary"
                disabled={openApi == null}
                title={
                    openApi == null ? 'The REST API must be running' : undefined
                }
                onClick={() => openApi && copy(openApi)}
            >
                Copy OpenAPI URL
            </Button>
        </Group>
    );
};
