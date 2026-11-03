# Remote control

The Power Profiler app can be controlled from scripts and AI agents. When you
enable it, the app runs two optional servers:

- An [MCP](https://modelcontextprotocol.io/) server (Streamable HTTP) at
  `http://<listen>/mcp`, for AI agents such as Claude Code.
- A REST API under `http://<listen>/api/...`, for scripts and test automation.

Both control the PPK2 that is selected in the app, and the app shows every
change. Use them, for example, to run a measurement unattended: set the voltage,
power-cycle the device under test (DUT), record, and read the average current or
export the samples.

The PPK2 is always selected in the app (or with the
[`--deviceSerial` launcher option](#selecting-a-ppk2-at-start)), not through the
API.

## Enabling remote control

1. In the side panel, expand the **Remote Control** group.
1. Turn on **MCP server**, **REST API**, or both. Each one has its own **listen
   address** in the form `[host:]port`, for example `8098`, `127.0.0.1:8098`, or
   `[::1]:8098`. The host is an IPv4 address, an IPv6 address in brackets, or
   `localhost`. Without a host, the server listens on `127.0.0.1`. The default
   is `127.0.0.1:8098` for both.
1. Optionally, set a **Token** (see [Security](#security)).

The status line below each listen address shows `Running on <url>` or the reason
why the server did not start (for example, the port is already in use). The MCP
server and the REST API can share one port.

## Security

Anyone who can reach the servers can control the PPK2 and the power to your DUT,
so they are restricted by default.

- **Loopback by default**: the servers listen on `127.0.0.1` only. To make them
  reachable from other machines, set another address, for example
  `0.0.0.0:8098`.
- **Token**: when you set a token, every request must carry the header
  `Authorization: Bearer <token>`. Otherwise the server answers `401`. Use
  **Generate** to create a random token, **Copy** to copy it, and **Clear** to
  remove it.
- **Host and Origin checks** protect against web pages that try to reach the
  servers from your browser (DNS rebinding):
    - A request with an `Origin` header is accepted only from a loopback `http:`
      origin.
    - On a loopback address, the `Host` header must name a loopback host
      (`localhost`, `127.x.x.x`, or `[::1]`).
    - On any other address without a token, the `Host` header must be an IP
      address, not a DNS name. With a token, any `Host` is accepted.

    Rejected requests get `403`.

- **Warning in the app**: the side panel warns you when a server listens on a
  non-loopback address without a token.
- **Voltage limit**: the API can only set voltages up to the voltage limit set
  in the **Advanced Configuration** group (**Set max supply voltage to**), and
  within the voltage range of the app. The **Remote Control** group shows the
  current limit. A voltage outside the range is rejected, not clamped. Switching
  the power output on in source mode is refused while the voltage is above the
  limit, for example after you lowered the limit; set a lower voltage first.
- **Limit per client (`max_mV`)**: add `?max_mV=<mV>` to the URL of a client to
  lower the limit for that client only, for example
  `http://127.0.0.1:8098/mcp?max_mV=3500` for an agent that powers a 3.6 V part.
  It is taken on every request to `/mcp` and `/api/...`, and it can only lower
  the limit set in the app, never raise it. It guards against a slip of an agent
  or a script and is not a security boundary: a client can drop it from its URL.
  An invalid value (not a positive integer, or given twice) is answered with
  `400` and `invalid_argument`.

!!! warning "Warning"

    The servers use plain HTTP, and the token is sent unencrypted.
    Outside of a trusted lab network, do not expose them directly.
    Keep the loopback address and use an SSH tunnel, or put a TLS reverse proxy in front.

## Using the MCP server with Claude Code

Add the server to the `.mcp.json` file of your project. You can click **Copy
.mcp.json snippet** in the **Remote Control** group to copy the snippet for the
current listen address and token. A wildcard address (`0.0.0.0` or `::`) is
written as a loopback address.

Without a token:

```json
{
    "mcpServers": {
        "ppk": {
            "type": "http",
            "url": "http://127.0.0.1:8098/mcp"
        }
    }
}
```

With a token:

```json
{
    "mcpServers": {
        "ppk": {
            "type": "http",
            "url": "http://127.0.0.1:8098/mcp",
            "headers": {
                "Authorization": "Bearer <token>"
            }
        }
    }
}
```

With the voltage of this agent limited to 3500 mV (see [Security](#security)):

```json
{
    "mcpServers": {
        "ppk": {
            "type": "http",
            "url": "http://127.0.0.1:8098/mcp?max_mV=3500"
        }
    }
}
```

The server is stateless and answers `POST` requests on `/mcp` only. It gives the
agent instructions about the typical flow and about measurement pitfalls. The
tools are named as in the table below; Claude Code shows them as
`mcp__ppk__<name>`.

## Operations

Each operation is an MCP tool and a REST endpoint with the same arguments and
the same result. With REST, the arguments of a `POST` go in a JSON body
(`Content-Type: application/json`), and the arguments of a `GET` go in the query
string. Unknown arguments are rejected. The query parameter `max_mV` (see
[Security](#security)) is taken by every endpoint and is not an argument of the
operation.

| MCP tool          | REST                     | Description                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`          | `GET /api/status`        | The selected PPK2, mode, voltage and the voltage range the API may set, DUT power, sampling, sample rate, **Sample for** duration, the time range of the recorded data, unsaved data, a loaded file, the call the API is running (`busy_op`), and the enabled digital channels with their state at the last sample (`digital_mask`, `digital`). |
| `list_devices`    | `GET /api/devices`       | The connected PPK2s and which one is selected.                                                                                                                                                                                                                                                                                                  |
| `set_mode`        | `POST /api/mode`         | `mode`: `source` or `ampere`. Switching to `source` turns the DUT power off, and switching to `ampere` turns it on. Not while sampling.                                                                                                                                                                                                         |
| `set_voltage`     | `POST /api/voltage`      | `mV`: integer, source mode only, within `voltage_range_mV` of `status`.                                                                                                                                                                                                                                                                         |
| `set_sample_rate` | `POST /api/sample-rate`  | `hz`: integer, a power of ten from 1 to 100000 Hz. Not while sampling.                                                                                                                                                                                                                                                                          |
| `power`           | `POST /api/power`        | `on`: boolean. Like **Enable power output**. In ampere mode, switching off breaks the supply, which gives a power reset for battery boards.                                                                                                                                                                                                     |
| `sampling`        | `POST /api/sampling`     | `start`: boolean. With `start=true` you can add `duration_s` (**Sample for** in seconds, `null` for unlimited) and `discard_unsaved`. Starting clears the previous data.                                                                                                                                                                        |
| `stats`           | `GET /api/stats`         | Average and maximum current, charge, and duration of a window of the recorded data. The window is `last_s`, or both `from_ts_ms` and `to_ts_ms`.                                                                                                                                                                                                |
| `trace`           | `GET /api/trace`         | The current over a window (same arguments as `stats`) as a time series of `points` buckets (1 to 10000): average, minimum and maximum per bucket, and the digital channels with the times of their changes. See [Time series](#time-series).                                                                                                    |
| `export_csv`      | `POST /api/export`       | Exports a window (same arguments as `stats`) as CSV (`Timestamp(ms)`, `Current(uA)`, and `D0` to `D7` with a digital channel enabled). Optional `name` (a bare file name, `.csv` is added, existing files are never overwritten). At most 10,000,000 samples.                                                                                   |
| (not an MCP tool) | `GET /api/export/<name>` | Downloads a `.csv` file written by `export_csv`, so that remote REST clients can fetch it.                                                                                                                                                                                                                                                      |
| (not an MCP tool) | `GET /api/openapi.json`  | The OpenAPI description of the REST API, see [OpenAPI document](#openapi-document).                                                                                                                                                                                                                                                             |

Notes on the operations:

- The voltage range in `status` (`voltage_range_mV`) is the effective one: the
  range of the app, the voltage limit set in the app, and the `max_mV` of the
  client. It is `null` when no voltage is allowed, for example when `max_mV` is
  below the minimum of the app.
- `power` with `on=true` in source mode answers `out_of_range` when the current
  voltage is above the allowed maximum. Lower it with `set_voltage` first.
  Ampere mode passes an external supply through and is not limited.
- `duration_s` must be at most 3600 s, or whole minutes, hours or days (at most
  3600 of them), as the **Sample for** field of the app only offers these.
- `sampling` with `start=false` when not sampling is not an error; the result
  has `was_running` set to `false`.
- `stats`, `trace` and `export_csv` work on the recorded data, with or without a
  PPK2. The window is clipped to the available data, and the result gives the
  actual range. The window becomes the selection in the chart, replacing the one
  there, so the statistics below the chart show the same window. The chart view
  does not move.
- Digital channels are reported only for the channels enabled in the app
  (**Display options**, **Digital channels**), as a byte `"0xNN"` in which bit 0
  is D0 and bit 7 is D7. Disabled channels are 0, and a channel that toggled
  within one sample (X in the CSV) counts as 1. Without an enabled channel the
  digital fields are absent. In `status`, `digital` is the state at the last
  recorded sample (live only while sampling, `null` without data).
- With a digital channel enabled, `export_csv` adds the columns `D0` to `D7` for
  all eight channels, exactly as the export of the app with **Digital logic pins
  (separate fields)**: `0`, `1`, `X` (toggled within the sample) or `-`.
- `export_csv` writes into the private directory `pc-nrfconnect-ppk-exports` in
  the temporary directory of your system, and returns the `path` and `name`. A
  local client can read the file directly, and a remote REST client downloads it
  with `GET /api/export/<name>`. Without `name`, the file is called
  `ppk-<date>T<time>.csv`.

## OpenAPI document

The REST API describes itself: `GET /api/openapi.json` returns an OpenAPI 3.1
document in JSON. It is generated from the same operation definitions that the
server runs, so it always matches the arguments and errors of the version you
use. Copy the URL with **Copy OpenAPI URL** in the Remote Control group (while
the REST API is running) and open it in the Swagger Editor, import it into
Postman, or feed it to a client generator. With a token set, the document
declares bearer authentication, and the request needs the token like any other.

## Responses and errors

A successful call returns JSON with `"status": "ok"` and the result fields, with
HTTP status `200`. A failed call returns:

```json
{
    "status": "error",
    "error": "out_of_range",
    "message": "6000 mV is outside the allowed range 800..5000 mV"
}
```

Some errors carry more fields, for example the allowed `voltage_range_mV`. In
MCP, the same object is the structured result of the tool call. With REST, the
error code decides the HTTP status:

| Error code                       | HTTP status | Meaning                                                                                                                 |
| -------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `invalid_argument`               | 400         | Missing, unknown, or invalid arguments (for example, no window given to `stats`).                                       |
| `out_of_range`                   | 400         | A value outside what is allowed (voltage, sample rate, duration, too many samples for an export, or too many `points`). |
| `not_found`                      | 404         | The file to download does not exist.                                                                                    |
| `wrong_mode`                     | 409         | The voltage can only be set in source mode.                                                                             |
| `sampling_running`               | 409         | Not possible while sampling; stop sampling first.                                                                       |
| `already_running`                | 409         | Sampling is already running.                                                                                            |
| `unsaved_data`                   | 409         | Starting sampling would discard data recorded in the app that you have not saved.                                       |
| `file_loaded`                    | 409         | A `.ppk2` file is loaded, so the PPK2 cannot be controlled.                                                             |
| `no_data`                        | 409         | There are no data, or none in the window.                                                                               |
| `exists`                         | 409         | The export file name is already taken.                                                                                  |
| `temp_disk_missing`, `disk_full` | 409         | Sampling could not start because of the disk that holds the sampling data.                                              |
| `data_changed`                   | 409         | The recorded data changed while `stats` or `export_csv` was running.                                                    |
| `cancelled`                      | 409         | The call was cancelled, for example the power was switched off while `set_mode` was switching it on.                    |
| `no_device`                      | 503         | No PPK2 is selected, or it is still connecting.                                                                         |
| `busy`                           | 503         | Another call kept the PPK2 busy; retry later.                                                                           |
| `timeout`                        | 504         | The call took too long (10 s by default, 30 s for `sampling`, `stats` and `trace`, 60 s for `export_csv`).              |
| `internal`                       | 500         | An unexpected error in the app.                                                                                         |

Errors of the HTTP layer have the same shape, with these HTTP statuses: `400`
(`invalid_argument`, an invalid `max_mV`), `401` (`unauthorized`), `403`
(`forbidden`), `404` (`not_found`, or a server that is turned off), `405`
(`method_not_allowed`), `413` (`payload_too_large`), and `415` (a `POST` body
that is not `application/json`).

## Time series

`trace` splits the window into `points` buckets of equal width and answers in
columns, compact enough for an agent to read:

```json
{
    "status": "ok",
    "t0_ms": 1730000000000,
    "dt_ms": 2.5,
    "points": 4,
    "avg_uA": [812, 4.1, null, 3.98],
    "min_uA": [790, 3.2, null, 3.9],
    "max_uA": [6120, 5, null, 4.05],
    "digital_mask": "0x03",
    "digital": ["0x01", "0x00", null, "0x00"],
    "digital_changes": [
        [1.27, "0x00"],
        [8.03, "0x02"]
    ],
    "from_ts_ms": 1730000000000,
    "to_ts_ms": 1730000000009.99,
    "session_start_ts_ms": 1729999990000
}
```

- Bucket _i_ starts at `t0_ms + i * dt_ms`; `dt_ms` may be fractional.
  `avg_uA[i]`, `min_uA[i]` and `max_uA[i]` belong to it. They are rounded to 3
  significant digits (`export_csv` has the full precision) and are `null` for a
  bucket without samples (a gap in the data).
- A window with fewer samples than `points` gives one bucket per sample, and
  `points` in the result is the actual count. More than 10000 points are
  rejected with `out_of_range`.
- `digital[i]` is the state at the first sample of bucket _i_. `digital_changes`
  lists every change of the enabled channels as `[ms after t0_ms, state]`, at
  most 1000 of them; then `truncated` is `true` and `truncated_at_ms` is the
  time of the first change left out. The state at the start of the window is
  `digital[0]`, not a change.

```bash
# The last 10 s in 500 points
curl 'http://127.0.0.1:8098/api/trace?last_s=10&points=500'
```

## Units and timestamps

- Current is in µA (`avg_uA`, `max_uA`), charge in µC and µAh, durations in ms,
  and voltage in mV.
- Timestamps (`from_ts_ms`, `to_ts_ms`, `session_start_ts_ms`) are milliseconds
  since the Unix epoch of the host PC.
- The timestamps are derived from the clock of the PC at the first sample, so
  they are approximate: off by up to tens of milliseconds plus one sample
  period. Do not use them to correlate events with a precision below that.
- In the CSV file, `Timestamp(ms)` is the time since the start of the session.

## Example

The example uses `curl` against the default address, without a token. With a
token, add `-H "Authorization: Bearer <token>"` to every call.

```bash
# State of the app, with the selected PPK2
curl http://127.0.0.1:8098/api/status

# Source meter at 3000 mV
curl -X POST http://127.0.0.1:8098/api/mode \
  -H 'Content-Type: application/json' -d '{"mode":"source"}'
curl -X POST http://127.0.0.1:8098/api/voltage \
  -H 'Content-Type: application/json' -d '{"mV":3000}'

# Power reset of the DUT
curl -X POST http://127.0.0.1:8098/api/power \
  -H 'Content-Type: application/json' -d '{"on":false}'
curl -X POST http://127.0.0.1:8098/api/power \
  -H 'Content-Type: application/json' -d '{"on":true}'

# Sample for 60 s (the PPK2 keeps sampling until it is stopped or the time is up)
curl -X POST http://127.0.0.1:8098/api/sampling \
  -H 'Content-Type: application/json' -d '{"start":true,"duration_s":60}'

# Average and maximum current of the last 10 s
curl 'http://127.0.0.1:8098/api/stats?last_s=10'

# The shape of the current over the last 10 s, in 200 points
curl 'http://127.0.0.1:8098/api/trace?last_s=10&points=200'

# Export the last 10 s as CSV and download it
curl -X POST http://127.0.0.1:8098/api/export \
  -H 'Content-Type: application/json' -d '{"last_s":10,"name":"run1"}'
curl -O http://127.0.0.1:8098/api/export/run1.csv

# Stop sampling
curl -X POST http://127.0.0.1:8098/api/sampling \
  -H 'Content-Type: application/json' -d '{"start":false}'
```

## Practical notes

- **An attached debugger** keeps an nRF91 at a few mA. The DUT can also be
  back-powered through a USB-serial chip or a J-Link, so a suspiciously low or
  odd current floor needs checking.
- **`busy`** means that another call is still running. Calls that control the
  PPK2 or read its data run one at a time, and a call that waits too long for
  its turn gets `busy`. Retry later; `status` shows the running call in
  `busy_op`. Switching the power off (`power` with `on=false`) never waits, and
  it cancels queued calls that would switch the power on.
- **`no_device`** is also returned while the PPK2 is still connecting after you
  select it. Wait and retry.
- **Unsaved data**: starting sampling through the API is refused with
  `unsaved_data` when there are unsaved data that were recorded in the app. Save
  them in the app, or pass `discard_unsaved=true`. Data recorded through the API
  do not cause this error. The answer tells in `discarded_unsaved` whether data
  were discarded.
- **Starting sampling** switches the app to the Data Logger pane and clears the
  previous data.

### Selecting a PPK2 at start

To select a PPK2 automatically when the app starts, add the serial number of the
device to the launcher command:

```bash
nrfconnect --open-local-app pc-nrfconnect-ppk -- --deviceSerial <SN>
```
