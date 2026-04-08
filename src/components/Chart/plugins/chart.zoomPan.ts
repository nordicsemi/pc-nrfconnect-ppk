/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { logger } from '@nordicsemiconductor/pc-nrfconnect-shared';
import {
    type Chart,
    type CoreScaleOptions,
    type Plugin,
    type Scale,
} from 'chart.js';

import { DataManager, getSamplesPerSecond } from '../../../globals';
import {
    MAX_WINDOW_DURATION,
    MIN_WINDOW_DURATION,
} from '../../../slices/chartSlice';
import type { AmpereChartJS } from '../AmpereChart';
import { isCanvasElement } from './utility';

type ZoomPanCallback = (
    beginX?: number,
    endX?: number,
    beginY?: null | number,
    endY?: null | number,
) => void;

export interface ZoomPan {
    pointerUpHandler?: (event: PointerEvent) => void;
    pointerDownHandler?: (event: PointerEvent) => void;
    pointerMoveHandler?: (event: PointerEvent) => void;
    wheelHandler?: (event: WheelEvent) => void;
    zoomPanCallback?: ZoomPanCallback;
    dragStart?: DragStart | null;
}

const wheelZoomFactor = 1.25;

const isTrackPad = (event: WheelEvent) =>
    // @ts-expect-error TODO: must fix in order to keep it compatible.
    event.wheelDeltaY
        ? // @ts-expect-error TODO: must fix in order to keep it compatible.
          event.wheelDeltaY === -3 * event.deltaY
        : event.deltaMode === 0;

const unlockYAxis = (event: WheelEvent | PointerEvent) => event.altKey;

const zoomAtOrigin = (
    zoomPanCallback: ZoomPanCallback,
    pX: number,
    factorX: number,
    xMin: number,
    xMax: number,
    pY?: number,
    factorY?: number,
    yMin?: number,
    yMax?: number,
) => {
    const zX = factorX === 0 ? 0 : Math.max(factorX, 0.1);
    let newMinX = xMin;
    let newMaxX = xMax;

    if (factorX !== 0) {
        newMinX = Math.max(pX - (pX - xMin) / zX, 0);
        newMaxX = pX + (xMax - pX) / zX;
    }

    if (zX > 1 && newMaxX > DataManager().getTimestamp()) {
        // If user have zoomed-out beyond the span of the sample, and try to zoom-back in,
        // make sure that the zoom-in will zoom-in on the sample, until the window spans
        // the entire sample or less.
        const width = newMaxX - newMinX;
        newMinX = 0;
        newMaxX = width;
    }

    if (zX < 1 && newMaxX > DataManager().getTimestamp()) {
        // On zoom-out, if the window moves outside of the span of the sample,
        // make sure that the window will first span the entire sample, before
        // it can move outside of the sample. This is only possible if the span
        // of the sample is less than MAX_WINDOW_DURATION.
        const width = newMaxX - newMinX;
        newMaxX = DataManager().getTimestamp();
        newMinX = newMaxX - width;
        if (newMinX < 0) {
            newMinX = 0;
            newMaxX = width;
        }
    }

    if (pY !== undefined) {
        /* eslint-disable @typescript-eslint/no-non-null-assertion */
        const zY = Math.max(factorY!, 0.1);
        let newMinY = pY - (pY - yMin!) / zY;
        const newMaxY = pY + (yMax! - pY) / zY;

        if (newMinY < 0) {
            newMinY = 0;
        }
        zoomPanCallback(newMinX, newMaxX, newMinY, newMaxY);
        return;
    }
    zoomPanCallback(newMinX, newMaxX, null, null);
};

let processingWheelEvents = false;
let wheelEventToProcess: {
    event: WheelEvent;
    scales: { [key: string]: Scale<CoreScaleOptions> };
    zoomPanCallback?: ZoomPanCallback;
    sampleFrequency?: number;
};

const processWheelEvents = () => {
    processingWheelEvents = false;

    const { event, scales, zoomPanCallback } = wheelEventToProcess;

    if (!zoomPanCallback) {
        return;
    }

    const { clientX, clientY, deltaX, deltaY } = event;

    if (!isCanvasElement(event.target)) return;

    const { left: xOffset, top: yOffset } =
        event.target.getBoundingClientRect();

    const { xScale, yScale } = scales;
    const { min: xMin, max: xMax, width } = scales.xScale;
    const { min: yMin, max: yMax, height } = scales.yScale;

    const yAxisOperation = unlockYAxis(event);

    const isTouchPad = isTrackPad(event);
    const isTrackPadPan = isTouchPad && !event.shiftKey;
    const isTrackPadZoom = isTouchPad && event.shiftKey;

    if (!isTouchPad) {
        if (yAxisOperation) {
            let z = 0;
            if (deltaY < 0) {
                z = wheelZoomFactor;
            } else if (deltaY > 0) {
                z = 1 / wheelZoomFactor;
            } else {
                return;
            }
            const pX = xScale.getValueForPixel(clientX - xOffset);
            const py = yScale.getValueForPixel(clientY - yOffset);

            if (pX == null) {
                // As xScale.getValueForPixel may return undefined, we need to handle it appropriately.
                logger.debug(
                    'zoomPan.ts-->processWheelEvents: getValueForPixel returned undefined.',
                );
                return;
            }

            zoomAtOrigin(
                zoomPanCallback,
                pX,
                0,
                xMin,
                Math.ceil(xMax),
                py,
                z,
                yMin,
                yMax,
            );
        } else {
            let z = 0;
            if (deltaY < 0) {
                z = wheelZoomFactor;
            } else if (deltaY > 0) {
                z = 1 / wheelZoomFactor;
            } else {
                return;
            }
            const p = xScale.getValueForPixel(clientX - xOffset);
            if (p == null) {
                // As xScale.getValueForPixel may return undefined, we need to handle it appropriately.
                logger.debug(
                    'zoomPan.ts-->processWheelEvents: getValueForPixel returned undefined.',
                );
                return;
            }

            const windowWidth = xMax - xMin;
            const samplesPerSecond = getSamplesPerSecond();

            // On zoom out: do not attempt to adjust after reaching max zoom out.
            if (
                z < 1 &&
                windowWidth >= MAX_WINDOW_DURATION / samplesPerSecond
            ) {
                return;
            }
            // On zoom in: do not attempt to adjust after reaching max zoom in.
            if (
                z > 1 &&
                windowWidth <= MIN_WINDOW_DURATION / samplesPerSecond
            ) {
                return;
            }

            zoomAtOrigin(zoomPanCallback, p, z, xMin, Math.ceil(xMax));
        }
    } else if (isTrackPadZoom) {
        if (yAxisOperation) {
            const pX =
                xMin +
                (xMax - xMin) * ((clientX - xOffset - xScale.left) / width);
            const pY =
                yMax +
                (yMin - yMax) * ((clientY - yOffset - yScale.top) / height);
            const fx = 1.01 ** 0;
            const fy = 1.01 ** deltaY;
            zoomAtOrigin(
                zoomPanCallback,
                pX,
                fx,
                xMin,
                xMax,
                pY,
                fy,
                yMin,
                yMax,
            );
        } else {
            const pX =
                xMin +
                (xMax - xMin) * ((clientX - xOffset - xScale.left) / width);
            const pY =
                yMax +
                (yMin - yMax) * ((clientY - yOffset - yScale.top) / height);
            const fx = 1.01 ** deltaX;
            const fy = 1.01 ** 0;
            zoomAtOrigin(
                zoomPanCallback,
                pX,
                fx,
                xMin,
                xMax,
                pY,
                fy,
                yMin,
                yMax,
            );
        }
    } else if (isTrackPadPan) {
        const fx = (xMax - xMin) / width;
        const fy = (yMin - yMax) / height;
        const deltaYAxis = yMax - yMin;
        const dx = fx * deltaX;
        const dy = fy * deltaY;
        const newBeginX = Math.max(0, xMin + dx);
        let newEndX = Math.max(0, xMax + dx);

        if (newEndX >= DataManager().getTimestamp() || newBeginX <= 0) return;

        if (newBeginX === 0) newEndX = xMax;
        const newBeginY = Math.max(0, yMin + dy);
        let newEndY = Math.max(0, yMax + dy);
        if (newBeginY === 0) newEndY = deltaYAxis;

        if (yAxisOperation) {
            zoomPanCallback(newBeginX, newEndX, newBeginY, newEndY);
            return;
        }
        zoomPanCallback(newBeginX, newEndX);
    }
};

let processingPointerMoveEvents = false;

interface DragStart {
    pX: number;
    pY: number;
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    moved?: boolean;
}

let pointerMoveEventToProcess: {
    event: PointerEvent;
    dragStart: DragStart;
    scales: { [key: string]: Scale<CoreScaleOptions> };
    zoomPanCallback?: ZoomPanCallback;
};

const processPointerMoveEvents = () => {
    processingPointerMoveEvents = false;

    const { event, dragStart, scales, zoomPanCallback } =
        pointerMoveEventToProcess;

    if (!zoomPanCallback) {
        return;
    }

    if (!isCanvasElement(event.target)) return;

    const { clientX, clientY } = event;
    const { left: xOffset, top: yOffset } =
        event.target.getBoundingClientRect();

    const {
        xMin: xOriginStart,
        xMax: xOriginEnd,
        yMin: yOriginStart,
        yMax: yOriginEnd,
        pX,
        pY,
    } = dragStart;
    const { xScale, yScale } = scales;

    const originalWidth = xOriginEnd - xOriginStart;

    const qX =
        xOriginStart +
        (xOriginEnd - xOriginStart) *
            ((clientX - xOffset - xScale.left) / xScale.width);
    const qY =
        yOriginStart +
        (yOriginEnd - yOriginStart) *
            ((clientY - yOffset - yScale.top) / yScale.height);

    let xNewStart = xOriginStart + (pX - qX);
    let xNewEnd = xOriginEnd + (pX - qX);
    let yNewStart = null;
    let yNewEnd = null;

    if (unlockYAxis(event)) {
        yNewStart = yOriginStart - (pY - qY);
        yNewEnd = yOriginEnd - (pY - qY);

        if (yNewStart < 0) {
            // This means that user pans to the left beyond 0
            // case 5, 6, 10
            yNewStart = 0;
            yNewEnd = yOriginEnd;
        }
    }

    if (xNewEnd > DataManager().getTimestamp()) {
        if (xNewStart === 0) {
            return;
        }

        xNewEnd = DataManager().getTimestamp();
        xNewStart = xNewEnd - originalWidth;
    }

    if (xNewStart < 0) {
        // This means that user pans to the left beyond 0
        // case 5, 6, 10
        xNewStart = 0;
        xNewEnd = originalWidth;
    }

    zoomPanCallback(xNewStart, xNewEnd, yNewStart, yNewEnd);
};

const isInChartArea = (chart: Chart, x: number, y: number) => {
    const ca = chart.chartArea;
    return x >= ca.left && x <= ca.right && y >= ca.top && y <= ca.bottom;
};

const plugin: Plugin<'line'> = {
    id: 'zoomPan',

    beforeInit(chart: AmpereChartJS) {
        const zoomPan: ZoomPan = {};
        chart.zoomPan = zoomPan;

        const { canvas } = chart.ctx;

        zoomPan.wheelHandler = event => {
            if (!isInChartArea(chart, event.offsetX, event.offsetY)) {
                return;
            }
            wheelEventToProcess = {
                event,
                scales: chart.scales,
                zoomPanCallback: zoomPan.zoomPanCallback ?? undefined,
                sampleFrequency: chart.sampleFrequency,
            };

            if (!processingWheelEvents) {
                processingWheelEvents = true;
                requestAnimationFrame(processWheelEvents);
            }

            event.preventDefault();
        };
        canvas.addEventListener('wheel', zoomPan.wheelHandler);

        zoomPan.pointerDownHandler = event => {
            if (!zoomPan.zoomPanCallback) {
                return;
            }
            if (event.button === 1) {
                const { xScale } = chart.scales;
                const { min: xMin, max: xMax } = xScale;
                const windowDuration = xMax - xMin;
                const end = Math.min(
                    windowDuration,
                    DataManager().getTimestamp(),
                );
                zoomPan.zoomPanCallback(0, end);
                return;
            }

            if (event.shiftKey) {
                return;
            }

            if (!isCanvasElement(event.target)) {
                return;
            }

            // live mode on right click
            if (event.button === 2) {
                const { xScale } = chart.scales;
                const { min: xMin, max: xMax } = xScale;
                const windowDuration = xMax - xMin;
                const end = DataManager().getTimestamp();
                const begin = end - windowDuration;
                zoomPan.zoomPanCallback(begin, end);
                return;
            }

            if (event.button === 0) {
                const { xScale, yScale } = chart.scales;
                const { min: xMin, max: xMax } = xScale;
                const { min: yMin, max: yMax } = yScale;
                const { left: xOffset, top: yOffset } =
                    event.target.getBoundingClientRect();
                const pX =
                    xMin +
                    (xMax - xMin) *
                        ((event.clientX - xOffset - xScale.left) /
                            xScale.width);
                const pY =
                    yMin +
                    (yMax - yMin) *
                        ((event.clientY - yOffset - yScale.top) /
                            yScale.height);

                zoomPan.dragStart = {
                    pX,
                    pY,
                    xMin,
                    xMax,
                    yMin,
                    yMax,
                };
            }
            event.preventDefault();
        };
        canvas.addEventListener('pointerdown', zoomPan.pointerDownHandler);

        zoomPan.pointerMoveHandler = event => {
            if (!zoomPan.dragStart) {
                return;
            }

            if (!isCanvasElement(event.target)) {
                return;
            }

            event.target.setPointerCapture(event.pointerId);
            zoomPan.dragStart.moved = true;

            pointerMoveEventToProcess = {
                event,
                dragStart: { ...zoomPan.dragStart },
                scales: chart.scales,
                zoomPanCallback: zoomPan.zoomPanCallback,
            };

            if (!processingPointerMoveEvents) {
                processingPointerMoveEvents = true;
                requestAnimationFrame(processPointerMoveEvents);
            }
        };
        canvas.addEventListener(
            'pointermove',
            zoomPan.pointerMoveHandler,
            false,
        );

        zoomPan.pointerUpHandler = () => {
            if (zoomPan.zoomPanCallback == null) {
                logger.error(
                    'zoomPan-->zoomPan.pointerUpHandler: no callback defined',
                );
                return;
            }

            zoomPan.dragStart = null;
        };
        canvas.addEventListener('pointerup', zoomPan.pointerUpHandler, false);
        canvas.addEventListener(
            'pointerleave',
            zoomPan.pointerUpHandler,
            false,
        );
    },

    afterDestroy(chart: AmpereChartJS) {
        const { canvas } = chart.ctx;
        const { zoomPan } = chart;

        if (zoomPan) {
            if (zoomPan.wheelHandler) {
                canvas.removeEventListener('wheel', zoomPan.wheelHandler);
            }
            if (zoomPan.pointerDownHandler) {
                canvas.removeEventListener(
                    'pointerdown',
                    zoomPan.pointerDownHandler,
                );
            }
            if (zoomPan.pointerMoveHandler) {
                canvas.removeEventListener(
                    'pointermove',
                    zoomPan.pointerMoveHandler,
                );
            }
            if (zoomPan.pointerUpHandler) {
                canvas.removeEventListener(
                    'pointerup',
                    zoomPan.pointerUpHandler,
                );
                canvas.removeEventListener(
                    'pointerleave',
                    zoomPan.pointerUpHandler,
                );
            }
        }
    },
};

export default plugin;
