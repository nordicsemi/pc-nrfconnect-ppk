/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

// The MCP server instructions: the typical flow and measurement pitfalls.
export default [
    'Controls the Power Profiler app with a PPK2 that the human selected in the app; the app shows every change.',
    'Typical flow: status → set_mode("source") and set_voltage(mV) → power(false), power(true) for a power reset → sampling(start=true) → stats(last_s=…), trace(last_s=…, points=…) or export_csv → sampling(start=false). stats, trace and export_csv show their window as the selection in the chart of the app.',
    'The voltage is limited by the voltage limit set in the app; max_mV in the URL of this server (e.g. /mcp?max_mV=3300) limits this client further. status.voltage_range_mV is the effective range: set_voltage rejects (never clamps) voltages outside it, and power(true) in source mode is refused while the voltage is above it.',
    'Calls that control the PPK or read the data run one at a time; power(false) never waits. A call that waits too long for its turn gets the error busy, which means "retry later" (status shows busy_op).',
    'All timestamps are host epoch ms (approximate), currents uA, charge uC/uAh.',
    'trace answers in columns: bucket i starts at t0_ms + i * dt_ms, and avg_uA[i], min_uA[i], max_uA[i] belong to it (3 significant digits, null for a bucket without samples); ask for as many points as you need, not more.',
    'Digital channels D0-D7 (status, trace, export_csv) are reported only for the channels enabled in the app (Display options), as "0xNN" bytes with bit i = Di; trace.digital_changes gives the exact times of their changes, in ms after t0_ms.',
    'Pitfalls: an attached debugger keeps an nRF91 at a few mA; the DUT may be back-powered through USB-serial or J-Link, so a suspiciously low or odd floor current needs checking.',
].join('\n');
