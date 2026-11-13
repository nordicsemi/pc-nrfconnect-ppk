/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { colors } from '@nordicsemiconductor/pc-nrfconnect-shared';
import { type Plugin } from 'chart.js';
import { unit } from 'mathjs';

import { indexToTimestamp } from '../../../globals';
import type { AmpereChartJS } from '../AmpereChart';
import { type AmpereState } from '../data/dataTypes';
import {
    getTraceValueAt,
    spreadPositions,
    type TraceValue,
} from './traceValue';

const { gray700: color, nordicBlue900: accent, white } = colors;

const labelBoxHeight = 20;
const twoLineLabelBoxHeight = 33;
const tagHeight = 18;
const tagGap = 20;
const tagLeaderLength = 12;
const whiskerHalfWidth = 3;
const capHalfWidth = 7;
const avgTickHalfWidth = 9;

const formatDuration = (us: number) =>
    unit(us, 'us').format({ notation: 'auto', precision: 3 }).replace('u', 'µ');

const drawLabel = (chart: AmpereChartJS, lines: string[], anchorY: number) => {
    const {
        ctx,
        chartArea: { right, top, bottom },
    } = chart;

    const width = Math.max(...lines.map(line => ctx.measureText(line).width));
    const height = lines.length > 1 ? twoLineLabelBoxHeight : labelBoxHeight;

    let boxTop = anchorY - height;
    if (boxTop < top) boxTop = Math.min(anchorY, bottom - height);

    ctx.fillStyle = color;
    ctx.fillRect(right - width - 10, boxTop, width + 10, height);
    ctx.fillStyle = white;
    ctx.textAlign = 'right';
    lines.forEach((line, i) => {
        ctx.fillText(line, right - 5, boxTop + 13 + i * 15);
    });
};

const drawTimeLabel = (chart: AmpereChartJS, x: number, lines: string[]) => {
    const {
        ctx,
        chartArea: { right, top },
    } = chart;

    const width = Math.max(...lines.map(line => ctx.measureText(line).width));
    const boxWidth = width + 10;
    const boxLeft = x + boxWidth > right ? x - boxWidth : x;

    ctx.fillStyle = color;
    ctx.fillRect(boxLeft, top, boxWidth, twoLineLabelBoxHeight);
    ctx.fillStyle = white;
    ctx.textAlign = 'center';
    lines.forEach((line, i) => {
        ctx.fillText(line, boxLeft + boxWidth / 2, top + 13 + i * 15);
    });
};

const toLabelParts = (label: string | string[] | undefined) =>
    Array.isArray(label) ? label : [label ?? '', ''];

const timeRangeLines = (
    chart: AmpereChartJS,
    traceValue: TraceValue,
): string[] | undefined => {
    const { formatX } = chart.config.options;
    if (formatX == null) return undefined;

    if ('value' in traceValue) {
        return toLabelParts(formatX(traceValue.time));
    }

    const { first, last, count } = traceValue;
    const [startTime, startSubsecond] = toLabelParts(formatX(first));
    if (last == null || last === first) return [startTime, startSubsecond];

    const [endTime, endSubsecond] = toLabelParts(formatX(last));
    const range =
        startTime === endTime
            ? `${startTime}  ${startSubsecond} – ${endSubsecond}`
            : `${startTime} ${startSubsecond} – ${endTime} ${endSubsecond}`;
    const details = [
        formatDuration(last - first),
        count != null ? `${count} samples` : undefined,
    ]
        .filter(Boolean)
        .join(' · ');

    return [range, details];
};

const drawLine = (
    chart: AmpereChartJS,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
) => {
    const { ctx } = chart;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
};

const drawHorizontalLine = (chart: AmpereChartJS, y: number) => {
    const {
        chartArea: { left, right },
    } = chart;
    drawLine(chart, left, y, right, y);
};

interface Tag {
    y: number;
    text: string;
    fill: string;
    leaderFrom: number;
}

// Draws value tags at the right edge, each joined to its value by a dotted
// leader. Tags must be given top to bottom; that order is kept when tags that
// would overlap are spread apart.
const drawTags = (chart: AmpereChartJS, tags: Tag[]) => {
    const {
        ctx,
        chartArea: { right, top, bottom },
    } = chart;

    const width =
        Math.max(...tags.map(tag => ctx.measureText(tag.text).width)) + 10;
    const tagLeft = right - width;
    const centers = spreadPositions(
        tags.map(tag => tag.y),
        tagGap,
        top + tagHeight / 2,
        bottom - tagHeight / 2,
    );

    tags.forEach((tag, i) => {
        const center = centers[i];

        ctx.save();
        ctx.lineWidth = 0.75;
        ctx.strokeStyle = tag.fill;
        ctx.setLineDash([1.5, 3]);
        ctx.beginPath();
        ctx.moveTo(tag.leaderFrom, tag.y);
        ctx.lineTo(tagLeft - tagLeaderLength, tag.y);
        ctx.lineTo(tagLeft, center);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = tag.fill;
        ctx.fillRect(tagLeft, center - tagHeight / 2, width, tagHeight);
        ctx.fillStyle = white;
        ctx.textAlign = 'right';
        ctx.fillText(tag.text, right - 5, center + 4);
    });
};

const drawTraceValue = (
    chart: AmpereChartJS,
    x: number,
    traceValue: TraceValue,
) => {
    const {
        ctx,
        chartArea: { top, bottom },
        scales: { xScale, yScale },
        config: {
            options: { formatY },
        },
    } = chart;
    const lineColor = chart.data.datasets[0]?.borderColor;
    const traceColor = typeof lineColor === 'string' ? lineColor : accent;

    const toPixel = (nA: number) => {
        const pixel = yScale.getPixelForValue(nA);
        const clamped = Number.isFinite(pixel)
            ? Math.min(bottom, Math.max(top, pixel))
            : bottom;
        return Math.ceil(clamped - 0.5) + 0.5;
    };

    if ('value' in traceValue) {
        const y = toPixel(traceValue.value);
        const pointX = xScale.getPixelForValue(traceValue.time);

        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(pointX, y, 3.5, 0, 2 * Math.PI);
        ctx.fill();

        drawTags(chart, [
            {
                y,
                text: formatY(traceValue.value),
                fill: accent,
                leaderFrom: pointX + 6,
            },
        ]);
        return;
    }

    const { min, max, avg } = traceValue;
    const minY = toPixel(min);
    const maxY = toPixel(max);

    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = traceColor;
    ctx.fillRect(x - whiskerHalfWidth, maxY, 2 * whiskerHalfWidth, minY - maxY);
    ctx.restore();

    ctx.lineWidth = 1;
    ctx.strokeStyle = traceColor;
    ctx.strokeRect(
        x - whiskerHalfWidth,
        maxY,
        2 * whiskerHalfWidth,
        minY - maxY,
    );

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    drawLine(chart, x - capHalfWidth, maxY, x + capHalfWidth, maxY);
    drawLine(chart, x - capHalfWidth, minY, x + capHalfWidth, minY);

    const tags: Tag[] = [
        {
            y: maxY,
            text: `max ${formatY(max)}`,
            fill: color,
            leaderFrom: x + capHalfWidth + 1,
        },
    ];

    if (avg != null) {
        const avgY = toPixel(avg);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = accent;
        drawLine(chart, x - avgTickHalfWidth, avgY, x + avgTickHalfWidth, avgY);
        tags.push({
            y: avgY,
            text: `avg ${formatY(avg)}`,
            fill: accent,
            leaderFrom: x + avgTickHalfWidth + 1,
        });
    }

    tags.push({
        y: minY,
        text: `min ${formatY(min)}`,
        fill: color,
        leaderFrom: x + capHalfWidth + 1,
    });

    drawTags(chart, tags);
};

interface CrossHairPlugin extends Plugin<'line'> {
    instances: AmpereChartJS[];
    moveEvent: null | {
        offsetX: number;
        offsetY: number;
        drawY: boolean;
    };
    pointerMoveHandler: (event: PointerEvent, chart: AmpereChartJS) => void;
    pointerLeaveHandler: () => void;
    handlerRegistry: Map<
        AmpereChartJS,
        {
            pointerMoveListener: (event: PointerEvent) => void;
            pointerLeaveListener: () => void;
        }
    >;
}

const plugin: CrossHairPlugin = {
    id: 'crossHair',
    instances: [],
    moveEvent: null,
    handlerRegistry: new Map(),

    pointerMoveHandler(event, chart) {
        const {
            chartArea: { left },
            options: { snapping, live },
            config: {
                options: { id },
            },
        } = chart;

        if (live) {
            plugin.moveEvent = null;
            return;
        }

        let { offsetX, offsetY } = event;

        const drawY = id === 'ampereChart';

        if (snapping) {
            const hit = chart.getElementsAtEventForMode(
                event,
                'nearest',
                {},
                true,
            )[0];
            if (hit) {
                const { x, y } = hit.element;
                offsetX = x;
                offsetY = y;
            }
        }
        plugin.moveEvent = { offsetX: offsetX - left, offsetY, drawY };
        plugin.instances.forEach(instance => instance.update('none'));
    },

    pointerLeaveHandler() {
        plugin.moveEvent = null;
        plugin.instances.forEach(instance => instance.update('none'));
    },

    beforeInit(chart: AmpereChartJS) {
        plugin.instances.push(chart);

        const { canvas } = chart.ctx;
        const pointerMoveListener = (event: PointerEvent) =>
            plugin.pointerMoveHandler(event, chart);
        const pointerLeaveListener = () => plugin.pointerLeaveHandler();

        canvas.addEventListener('pointermove', pointerMoveListener);
        canvas.addEventListener('pointerleave', pointerLeaveListener);

        plugin.handlerRegistry.set(chart, {
            pointerMoveListener,
            pointerLeaveListener,
        });
    },

    afterDraw(chart: AmpereChartJS) {
        const {
            ctx,
            chartArea: { left, right, top, bottom },
            scales: { xScale, yScale },
            config: {
                options: { formatX, formatY, traceValue, averageLine },
            },
        } = chart;
        const { canvas } = ctx;

        if (!plugin.moveEvent) {
            canvas.style.cursor = 'default';
            return;
        }

        const { offsetX, offsetY, drawY } = plugin.moveEvent;
        const x = Math.ceil(offsetX - 0.5) - 0.5;
        const y = Math.ceil(offsetY - 0.5) + 0.5;

        let trace: TraceValue | null = null;
        if (traceValue && drawY) {
            const time = xScale.getValueForPixel(left + offsetX);
            trace =
                time != null
                    ? getTraceValueAt(
                          time,
                          (chart.data.datasets[0]?.data ?? []) as AmpereState[],
                          averageLine ?? [],
                          indexToTimestamp(1),
                      )
                    : null;
        }
        const traceTimeLines = trace ? timeRangeLines(chart, trace) : undefined;

        if (offsetX >= 0 && offsetX <= right - left) {
            ctx.save();
            ctx.lineWidth = 0.5;
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(left + x, top);
            ctx.lineTo(left + x, bottom);
            ctx.closePath();
            ctx.stroke();

            if (traceTimeLines) {
                drawTimeLabel(chart, left + offsetX, traceTimeLines);
            } else if (chart.height > 32 && formatX != null) {
                const xCoordinate = xScale.getValueForPixel(left + offsetX);
                if (xCoordinate != null) {
                    const xLabel = formatX(xCoordinate);
                    if (xLabel != null) {
                        const [time, subsecond] = xLabel;
                        const { width: tsWidth } = ctx.measureText(time);
                        ctx.fillStyle = color;
                        ctx.textAlign = 'right';
                        ctx.fillRect(left + offsetX, top, tsWidth + 10, 33);
                        ctx.fillStyle = white;
                        ctx.textAlign = 'center';
                        ctx.fillText(
                            time,
                            left + offsetX + 5 + tsWidth / 2,
                            top + 13,
                        );
                        ctx.fillText(
                            subsecond,
                            left + offsetX + 5 + tsWidth / 2,
                            top + 28,
                        );
                    }
                }
            }

            ctx.restore();
        }

        if (offsetY < top || offsetY > bottom) {
            canvas.style.cursor = 'default';
            return;
        }

        canvas.style.cursor = 'pointer';

        if (
            plugin.moveEvent.drawY &&
            yScale?.id === 'yScale' &&
            formatY != null
        ) {
            ctx.save();
            ctx.lineWidth = 0.5;
            ctx.strokeStyle = color;

            if (traceValue) {
                if (trace != null) {
                    drawTraceValue(chart, left + x, trace);
                }
            } else {
                drawHorizontalLine(chart, y);

                const yCoordinate = yScale.getValueForPixel(offsetY);
                const nA = yCoordinate != null ? formatY(yCoordinate) : null;

                if (nA != null) {
                    drawLabel(chart, [nA], offsetY);
                }
            }

            ctx.restore();
        }
    },

    afterDestroy(chartInstance) {
        const i = plugin.instances.findIndex(
            ({ id }) => id === chartInstance.id,
        );
        if (i > -1) {
            plugin.instances.splice(i, 1);
        }

        const chart = chartInstance as AmpereChartJS;
        const handlers = plugin.handlerRegistry.get(chart);
        if (handlers) {
            const canvas = chart?.ctx?.canvas;

            if (canvas) {
                canvas.removeEventListener(
                    'pointermove',
                    handlers.pointerMoveListener,
                );
                canvas.removeEventListener(
                    'pointerleave',
                    handlers.pointerLeaveListener,
                );
            }

            plugin.handlerRegistry.delete(chart);
        }
    },
};

export default plugin;
