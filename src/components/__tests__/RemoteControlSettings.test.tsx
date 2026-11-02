/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React from 'react';

import {
    defaultRemoteControlConfig,
    remoteControlSettingsLoaded,
    setRemoteControlStatus,
} from '../../features/remoteControl/remoteControlSlice';
import { updateVoltageRegulatorMaxCapPPK2 } from '../../slices/voltageRegulatorSlice';
import { fireEvent, render, screen } from '../../utils/testUtils';
import RemoteControlSettings from '../SidePanel/RemoteControlSettings';

const mockPersist = {
    mcpEnabled: jest.fn(),
    mcpListen: jest.fn(),
    restEnabled: jest.fn(),
    restListen: jest.fn(),
    token: jest.fn(),
};

jest.mock('../../utils/persistentStore', () => ({
    ...jest.requireActual('../../utils/persistentStore'),
    setVoltageRegulatorMaxCapPPK2: jest.fn(),
    setRemoteControlMcpEnabled: (...args: unknown[]) =>
        mockPersist.mcpEnabled(...args),
    setRemoteControlMcpListen: (...args: unknown[]) =>
        mockPersist.mcpListen(...args),
    setRemoteControlRestEnabled: (...args: unknown[]) =>
        mockPersist.restEnabled(...args),
    setRemoteControlRestListen: (...args: unknown[]) =>
        mockPersist.restListen(...args),
    setRemoteControlToken: (...args: unknown[]) => mockPersist.token(...args),
}));

const mockWriteText = jest.fn();
jest.mock('electron', () => ({
    clipboard: { writeText: (text: string) => mockWriteText(text) },
}));

const loaded = (config: Partial<typeof defaultRemoteControlConfig> = {}) =>
    remoteControlSettingsLoaded({ ...defaultRemoteControlConfig, ...config });

const renderGroup = (actions: Parameters<typeof render>[1]) =>
    render(<RemoteControlSettings />, actions);

beforeEach(() => jest.clearAllMocks());

describe('RemoteControlSettings', () => {
    describe('Copy OpenAPI URL', () => {
        const running = { state: 'running' as const, url: 'http://x/api' };
        const renderWithRest = (restListen: string, rest: object) =>
            renderGroup([
                loaded({ restEnabled: true, restListen }),
                setRemoteControlStatus({
                    mcp: { state: 'stopped' },
                    rest: rest as never,
                }),
            ]);
        const button = () =>
            screen.getByRole('button', { name: 'Copy OpenAPI URL' });

        it('copies the URL, a wildcard mapped to loopback', () => {
            renderWithRest('0.0.0.0:8098', running);
            fireEvent.click(button());
            expect(mockWriteText).toHaveBeenCalledWith(
                'http://127.0.0.1:8098/api/openapi.json',
            );
        });

        it('keeps a concrete host', () => {
            renderWithRest('127.0.0.1:9000', running);
            fireEvent.click(button());
            expect(mockWriteText).toHaveBeenCalledWith(
                'http://127.0.0.1:9000/api/openapi.json',
            );
        });

        it.each([
            ['stopped', { state: 'stopped' }],
            ['failed', { state: 'error', message: 'Port in use' }],
        ])('is disabled with a hint when REST is %s', (_, rest) => {
            renderWithRest('127.0.0.1:8098', rest);
            expect(button()).toBeDisabled();
            expect(button()).toHaveAttribute(
                'title',
                'The REST API must be running',
            );
            expect(screen.queryByText(/^OpenAPI:/)).toBeNull();
        });
    });

    it('toggles MCP and REST separately', () => {
        renderGroup([loaded()]);
        const mcp = screen.getByLabelText('MCP server');
        const rest = screen.getByLabelText('REST API');

        fireEvent.click(mcp);
        expect(mockPersist.mcpEnabled).toHaveBeenCalledWith(true);
        expect(mockPersist.restEnabled).not.toHaveBeenCalled();

        fireEvent.click(rest);
        expect(mockPersist.restEnabled).toHaveBeenCalledWith(true);
    });

    it('commits the listen address on blur only', () => {
        renderGroup([loaded()]);
        const input = screen.getByLabelText('MCP server listen address');

        fireEvent.change(input, { target: { value: '9000' } });
        expect(mockPersist.mcpListen).not.toHaveBeenCalled();

        fireEvent.blur(input);
        expect(mockPersist.mcpListen).toHaveBeenCalledWith('9000');
    });

    it('commits the listen address on Enter', () => {
        renderGroup([loaded()]);
        const input = screen.getByLabelText('REST API listen address');

        fireEvent.change(input, { target: { value: '0.0.0.0:9001' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(mockPersist.restListen).toHaveBeenCalledWith('0.0.0.0:9001');
    });

    it('shows an error and commits nothing for an invalid listen address', () => {
        renderGroup([loaded()]);
        const input = screen.getByLabelText('MCP server listen address');

        fireEvent.change(input, { target: { value: 'nonsense' } });
        fireEvent.blur(input);

        expect(screen.getByRole('alert').textContent).toMatch(/Invalid/);
        expect(mockPersist.mcpListen).not.toHaveBeenCalled();
    });

    it('shows the status of each part', () => {
        renderGroup([
            loaded({ mcpEnabled: true, restEnabled: true }),
            setRemoteControlStatus({
                mcp: { state: 'running', url: 'http://127.0.0.1:8098/mcp' },
                rest: { state: 'error', message: 'Port 8098 is in use' },
            }),
        ]);
        expect(
            screen.getByText('Running on http://127.0.0.1:8098/mcp'),
        ).toBeDefined();
        expect(screen.getByText('Port 8098 is in use')).toBeDefined();
    });

    it('generates and clears the token', () => {
        renderGroup([loaded()]);

        fireEvent.click(screen.getByText('Generate'));
        expect(mockPersist.token).toHaveBeenLastCalledWith(
            expect.stringMatching(/^[0-9a-f]{32}$/),
        );

        fireEvent.click(screen.getByText('Clear'));
        expect(mockPersist.token).toHaveBeenLastCalledWith('');
    });

    it('hides the token until shown', () => {
        renderGroup([loaded({ token: 'secret' })]);
        const input = screen.getByLabelText('Token') as HTMLInputElement;
        expect(input.type).toBe('password');
        fireEvent.click(screen.getByText('Show'));
        expect(input.type).toBe('text');
    });

    describe('non-loopback warning', () => {
        const warning = /without a token/;

        it('is shown for an enabled non-loopback part without token', () => {
            renderGroup([
                loaded({ mcpEnabled: true, mcpListen: '0.0.0.0:8098' }),
            ]);
            expect(screen.getByText(warning)).toBeDefined();
        });

        it.each([
            ['loopback', { mcpEnabled: true }],
            [
                'a token is set',
                { mcpEnabled: true, mcpListen: '0.0.0.0:8098', token: 'x' },
            ],
            ['the part is disabled', { mcpListen: '0.0.0.0:8098' }],
        ])('is hidden when %s', (_, config) => {
            renderGroup([loaded(config)]);
            expect(screen.queryByText(warning)).toBeNull();
        });
    });

    it('copies the token and reports a failed copy', () => {
        renderGroup([loaded({ token: 'abc' })]);

        fireEvent.click(screen.getByText('Copy'));
        expect(mockWriteText).toHaveBeenCalledWith('abc');

        mockWriteText.mockImplementationOnce(() => {
            throw new Error('boom');
        });
        fireEvent.click(screen.getByText('Copy'));
        expect(mockWriteText).toHaveBeenCalledTimes(2);
    });

    describe('.mcp.json snippet', () => {
        const copySnippet = () => {
            fireEvent.click(screen.getByText('Copy .mcp.json snippet'));
            return JSON.parse(mockWriteText.mock.calls[0][0] as string);
        };

        it('has no headers without a token', () => {
            renderGroup([loaded()]);
            expect(copySnippet()).toEqual({
                mcpServers: {
                    ppk: { type: 'http', url: 'http://127.0.0.1:8098/mcp' },
                },
            });
        });

        it('has the bearer header with a token', () => {
            renderGroup([loaded({ token: 'abc' })]);
            expect(copySnippet().mcpServers.ppk.headers).toEqual({
                Authorization: 'Bearer abc',
            });
        });

        it('uses 127.0.0.1 for a 0.0.0.0 bind', () => {
            renderGroup([loaded({ mcpListen: '0.0.0.0:9000' })]);
            expect(copySnippet().mcpServers.ppk.url).toBe(
                'http://127.0.0.1:9000/mcp',
            );
        });
    });

    it('shows the voltage limit of the app and the max_mV hint, no fields of its own', () => {
        renderGroup([loaded(), updateVoltageRegulatorMaxCapPPK2(3100)]);
        expect(
            screen.getByText(
                /^Voltage limit: 3100 mV \(set in Advanced Configuration\)/,
            ).textContent,
        ).toMatch(/\?max_mV= to the URL of an agent/);
        expect(screen.queryByText(/Voltage range allowed/)).toBeNull();
        expect(screen.queryByLabelText('Min')).toBeNull();
    });
});
