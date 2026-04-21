/*
 * Copyright (c) 2022 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

export interface SampleValues {
    value?: number;
    bits?: number;
    endOfTrigger?: boolean;
}

export interface Modifiers {
    r: modifier;
    gs: modifier;
    gi: modifier;
    o: modifier;
    s: modifier;
    i: modifier;
    ug: modifier;
}
export type modifier = [number, number, number, number, number];
export type modifiers = {
    [Property in keyof Modifiers]: modifier;
};

export interface openingMessage {
    opening: string;
}

export interface startedMessage {
    started: string;
}

export interface bufferMessage {
    type: string;
    data: Array<number>;
}

export interface errorMessage {
    error: string;
}

export type serialDeviceMessage =
    | openingMessage
    | startedMessage
    | bufferMessage
    | errorMessage;

export interface Mask {
    pos: number;
    mask: number;
}
