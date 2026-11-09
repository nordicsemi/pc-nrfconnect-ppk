/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import {
    getDevices,
    selectedDevice,
} from '@nordicsemiconductor/pc-nrfconnect-shared';

import { defineOperation } from '../operation';

const PPK2_PRODUCT_ID = 0xc00a;

export default defineOperation({
    name: 'list_devices',
    description:
        'The connected PPK2s and which one is selected. A PPK is selected in the app (or with --deviceSerial at start), not through the API.',
    annotation: 'read',
    input: {},
    rest: { method: 'GET', path: '/api/devices' },
    queue: 'none',
    handler: (_args, { getState }) => {
        const state = getState();
        const selected = selectedDevice(state)?.serialNumber;
        return {
            status: 'ok',
            devices: getDevices(state)
                .filter(
                    device =>
                        device.usb?.device.descriptor.idProduct ===
                        PPK2_PRODUCT_ID,
                )
                .map(device => ({
                    serial_number: device.serialNumber,
                    ports: (device.serialPorts ?? [])
                        .map(port => port.comName)
                        .filter((port): port is string => port != null),
                    selected:
                        selected !== undefined &&
                        device.serialNumber === selected,
                })),
        };
    },
});
