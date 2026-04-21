/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { colors } from '@nordicsemiconductor/pc-nrfconnect-shared';
import { type Plugin } from 'chart.js';

import type { AmpereChartJS } from '../AmpereChart';

const { gray700: color, nordicBlue } = colors;

const getTriggerLevelFromCoordinate = (coordinate: number) =>
    Math.round(Math.min(1000000000, Math.max(0, coordinate)));

interface TriggerLevelPlugin extends Plugin<'line'> {
    getCoords: (chart: AmpereChartJS) => null | {
        y: number;
        label: {
            x: number;
            y: number;
            w: number;
            h: number;
        };
    };
    pointerDownHandler: (event: PointerEvent, chart: AmpereChartJS) => void;
    pointerMoveHandler: (event: PointerEvent, chart: AmpereChartJS) => void;
    pointerLeaveHandler: (chart: AmpereChartJS) => void;
    handlerRegistry: Map<
        AmpereChartJS,
        {
            pointerDownListener: (event: PointerEvent) => void;
            pointerMoveListener: (event: PointerEvent) => void;
            pointerUpListener: () => void;
            pointerLeaveListener: () => void;
        }
    >;
}

const plugin: TriggerLevelPlugin = {
    id: 'triggerLevel',
    handlerRegistry: new Map(),

    getCoords(chart: AmpereChartJS) {
        const {
            chartArea: { left },
            scales: { yScale },
            options: { triggerLevel, triggerHandleVisible },
        } = chart;
        if (triggerLevel == null || !triggerHandleVisible) {
            return null;
        }
        const y =
            chart.triggerLine.y !== null
                ? chart.triggerLine.y
                : yScale.getPixelForValue(triggerLevel);
        if (y == null) {
            return null;
        }

        const width = 24;
        const height = 10;
        return {
            y: Math.ceil(y - 0.5) + 0.5,
            label: {
                x: left - width,
                y: y - height / 2 - 0.5,
                w: width,
                h: height,
            },
        };
    },

    pointerDownHandler(event: PointerEvent, chart: AmpereChartJS) {
        const { label } = this.getCoords(chart) || {};
        if (!label) return;
        const { offsetX: x, offsetY: y } = event || {};
        if (
            x >= label.x &&
            x <= label.x + label.w &&
            y >= label.y &&
            y <= label.y + label.h
        ) {
            chart.triggerLine.y = event.y;
        }
    },

    pointerMoveHandler(event: PointerEvent, chart: AmpereChartJS) {
        if (chart.triggerLine.y === null) {
            return;
        }

        const { label } = this.getCoords(chart) || {};
        if (label == null) {
            return;
        }

        chart.triggerLine.y = event.offsetY;
        const {
            scales: { yScale },
        } = chart;

        const yCoordinate = yScale.getValueForPixel(chart.triggerLine.y);
        if (yCoordinate == null) {
            return;
        }

        const level = getTriggerLevelFromCoordinate(yCoordinate);

        chart.config.options.updateTriggerLevel(level);
    },

    pointerLeaveHandler(chart: AmpereChartJS) {
        if (chart.triggerLine.y != null) {
            const {
                scales: { yScale },
            } = chart;

            const yCoordinate = yScale.getValueForPixel(chart.triggerLine.y);
            if (yCoordinate == null) {
                return;
            }
            const level = getTriggerLevelFromCoordinate(yCoordinate);
            chart.config.options.updateTriggerLevel(level);
        }
        chart.triggerLine.y = null;
    },

    beforeInit(chart: AmpereChartJS) {
        chart.triggerLine = { y: null };
        const { canvas } = chart.ctx;

        const pointerDownListener = (evt: PointerEvent) =>
            plugin.pointerDownHandler(evt, chart);
        const pointerMoveListener = (evt: PointerEvent) =>
            plugin.pointerMoveHandler(evt, chart);
        const pointerUpListener = () => plugin.pointerLeaveHandler(chart);
        const pointerLeaveListener = () => plugin.pointerLeaveHandler(chart);

        canvas.addEventListener('pointerdown', pointerDownListener);
        canvas.addEventListener('pointermove', pointerMoveListener);
        canvas.addEventListener('pointerup', pointerUpListener);
        canvas.addEventListener('pointerleave', pointerLeaveListener);

        plugin.handlerRegistry.set(chart, {
            pointerDownListener,
            pointerMoveListener,
            pointerUpListener,
            pointerLeaveListener,
        });
    },

    afterDestroy(chart: AmpereChartJS) {
        const handlers = plugin.handlerRegistry.get(chart);
        if (handlers) {
            const { canvas } = chart.ctx;
            canvas.removeEventListener(
                'pointerdown',
                handlers.pointerDownListener,
            );
            canvas.removeEventListener(
                'pointermove',
                handlers.pointerMoveListener,
            );
            canvas.removeEventListener('pointerup', handlers.pointerUpListener);
            canvas.removeEventListener(
                'pointerleave',
                handlers.pointerLeaveListener,
            );
            plugin.handlerRegistry.delete(chart);
        }
    },

    afterDraw(chart: AmpereChartJS) {
        const {
            chartArea: { left, right, top, bottom },
            ctx,
        } = chart;

        const coords = this.getCoords(chart);

        if (!coords) return;
        const { y, label } = coords;

        ctx.save();

        function drawDashedLine() {
            ctx.lineWidth = 0.5;
            ctx.strokeStyle = color;
            ctx.setLineDash([4, 5]);
            ctx.beginPath();
            ctx.moveTo(left, y - 1); // Moving it 1px up seems to center it on the label
            ctx.lineTo(right, y - 1); // Moving it 1px up seems to center it on the label
            ctx.closePath();
            ctx.stroke();
            ctx.setLineDash([]);
        }

        function drawHandle() {
            ctx.fillStyle = nordicBlue;

            ctx.translate(label.x, label.y);
            ctx.beginPath();
            ctx.moveTo(0, 2);
            ctx.bezierCurveTo(0, 1, 1, 0, 2, 0);
            const curveStart = label.w - 8;
            ctx.lineTo(curveStart, 0);
            ctx.bezierCurveTo(
                label.w - 5,
                0,
                label.w,
                label.h / 2,
                label.w,
                label.h / 2,
            );
            ctx.bezierCurveTo(
                label.w,
                label.h / 2,
                label.w - 5,
                label.h,
                curveStart,
                label.h,
            );
            ctx.lineTo(2, label.h);
            ctx.bezierCurveTo(1, label.h, 0, label.h - 1, 0, label.h - 2);
            ctx.closePath();
            ctx.fill();

            ctx.lineWidth = 1;
            ctx.strokeStyle = colors.gray50;
            ctx.beginPath();
            ctx.closePath();
            ctx.stroke();
        }

        if (y > top && y < bottom) {
            drawDashedLine();
            drawHandle();
        } else {
            // draw indicators
            ctx.fillStyle = nordicBlue;
            if (y < top) {
                ctx.translate(label.x + 12, top + 12);
            } else {
                ctx.translate(label.x + 12, bottom - 12);
                ctx.rotate(Math.PI);
            }
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(3.5, 6);
            ctx.lineTo(-3.5, 6);
            ctx.closePath();
            ctx.fill();
        }

        ctx.restore();
    },
};

export default plugin;
