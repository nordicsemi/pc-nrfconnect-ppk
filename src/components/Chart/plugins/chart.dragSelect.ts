/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { colors } from '@nordicsemiconductor/pc-nrfconnect-shared';
import { type Plugin } from 'chart.js';

import type { AmpereChartJS } from '../AmpereChart';
import { isCanvasElement } from './utility';

const CHART_SELECTION_COLOR = colors.gray100;
const CHART_DRAG_COLOR = colors.gray100;

export type ChartCursorCallback = (xStart?: number, xEnd?: number) => void;

export interface DragSelect {
    dragStart?: PointerEvent | null;
    dragEnd?: PointerEvent | null;
    pointerDownHandler?: (event: PointerEvent) => void;
    pointerMoveHandler?: (event: PointerEvent) => void;
    pointerUpHandler?: (event: PointerEvent) => void;
    callback?: ChartCursorCallback;
}

const plugin: Plugin<'line'> = {
    id: 'dragSelect',

    beforeInit(chart: AmpereChartJS) {
        const dragSelect: DragSelect = {};
        chart.dragSelect = dragSelect;

        const { canvas } = chart.ctx;

        dragSelect.pointerDownHandler = event => {
            if (event.button === 0 && event.shiftKey) {
                dragSelect.dragStart = event;
                if (dragSelect.callback) {
                    dragSelect.callback();
                }
            }
        };
        canvas.addEventListener('pointerdown', dragSelect.pointerDownHandler);

        dragSelect.pointerMoveHandler = event => {
            if (chart.dragSelect?.dragStart) {
                chart.dragSelect.dragEnd = event;
            }
        };
        canvas.addEventListener('pointermove', dragSelect.pointerMoveHandler);

        dragSelect.pointerUpHandler = event => {
            if (dragSelect.dragStart?.target != null) {
                const { dragStart } = dragSelect;
                if (!isCanvasElement(dragStart.target)) {
                    return;
                }

                const offsetX = dragStart.target.getBoundingClientRect().left;
                const startX =
                    Math.min(dragStart.clientX, event.clientX) - offsetX;
                const endX =
                    Math.max(dragStart.clientX, event.clientX) - offsetX;

                if (endX > startX) {
                    const scale = chart.scales.xScale;
                    const min = scale.getValueForPixel(startX)?.valueOf();
                    const max = scale.getValueForPixel(endX)?.valueOf();

                    if (dragSelect.callback) {
                        dragSelect.callback(min, max);
                    }
                }
                dragSelect.dragStart = null;
                dragSelect.dragEnd = null;
            }
        };
        canvas.addEventListener('pointerup', dragSelect.pointerUpHandler);
        canvas.addEventListener('pointerleave', dragSelect.pointerUpHandler);
    },

    afterDestroy(chart: AmpereChartJS) {
        const { canvas } = chart.ctx;
        const { dragSelect } = chart;

        if (dragSelect) {
            if (dragSelect.pointerDownHandler) {
                canvas.removeEventListener(
                    'pointerdown',
                    dragSelect.pointerDownHandler,
                );
            }
            if (dragSelect.pointerMoveHandler) {
                canvas.removeEventListener(
                    'pointermove',
                    dragSelect.pointerMoveHandler,
                );
            }
            if (dragSelect.pointerUpHandler) {
                canvas.removeEventListener(
                    'pointerup',
                    dragSelect.pointerUpHandler,
                );
                canvas.removeEventListener(
                    'pointerleave',
                    dragSelect.pointerUpHandler,
                );
            }
        }
    },

    beforeDraw(chart: AmpereChartJS) {
        const {
            chartArea: { left, right, top, bottom: areaBottom },
            scales: { xScale: scale },
            canvas: { height: bottom },
            options: { cursor },
            ctx,
        } = chart;
        const { dragStart, dragEnd } = chart.dragSelect || {};

        if (typeof cursor.cursorBegin !== 'number' && !(dragStart && dragEnd)) {
            return;
        }

        ctx.save();

        if (
            typeof cursor.cursorBegin === 'number' &&
            typeof cursor.cursorEnd === 'number'
        ) {
            const begin = Math.min(cursor.cursorBegin, cursor.cursorEnd);
            const end = Math.max(cursor.cursorBegin, cursor.cursorEnd);
            const sX = Math.ceil(scale.getPixelForValue(begin) - 0.5) - 0.5;
            const eX = Math.ceil(scale.getPixelForValue(end) - 0.5) - 0.5;
            const startX = Math.max(sX, left);
            const endX = Math.min(eX, right);
            if (startX < right && endX > left) {
                ctx.fillStyle = CHART_SELECTION_COLOR;
                ctx.fillRect(startX, top, endX - startX, areaBottom - top);
            }
            ctx.lineWidth = 0.5;
            ctx.strokeStyle = colors.gray700;
            ctx.fillStyle = colors.gray700;
            ctx.setLineDash([4, 4]);
            if (sX >= left && sX <= right) {
                ctx.beginPath();
                ctx.moveTo(sX, top);
                ctx.lineTo(sX, bottom);
                ctx.closePath();
                ctx.stroke();
            }
            if (eX >= left && eX <= right) {
                ctx.beginPath();
                ctx.moveTo(eX, top);
                ctx.lineTo(eX, bottom);
                ctx.closePath();
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }

        if (dragStart && dragEnd && isCanvasElement(dragStart.target)) {
            const offsetX = dragStart.target.getBoundingClientRect().left;
            const startX = Math.max(
                Math.min(dragStart.clientX, dragEnd.clientX) - offsetX,
                left,
            );
            const endX = Math.min(
                Math.max(dragStart.clientX, dragEnd.clientX) - offsetX,
                right,
            );
            ctx.fillStyle = CHART_DRAG_COLOR;
            ctx.fillRect(startX, top, endX - startX, areaBottom - top);
        }
        ctx.restore();
    },
};

export default plugin;
