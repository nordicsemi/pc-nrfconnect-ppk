# PPK2 CLI – Python command-line recorder for Nordic Power Profiler Kit II

A standalone Python 3 command-line tool that reads measurement data from a
**Nordic PPK2** (Power Profiler Kit II) device via USB serial on Linux and
saves it in the `.ppk2` file format compatible with the
[nRF Connect Power Profiler](https://www.nordicsemi.com/Products/Development-tools/nRF-Connect-for-Desktop)
desktop application.

No GUI, no Electron – just a plain Python script you can run from a terminal
or integrate into automated test pipelines.

---

## Contents

| File | Purpose |
|------|---------|
| `ppk2_cli.py` | Main CLI entry point |
| `ppk2_device.py` | PPK2 serial protocol, ADC conversion, spike filter |
| `ppk2_format.py` | `.ppk2` file writer (ZIP archive, FoldingBuffer) |
| `requirements.txt` | Python dependencies |

---

## Requirements

- Python **3.10** or newer (uses the `X | Y` union type syntax)
- Linux (tested on Ubuntu 22.04 / Debian 12)
- A Nordic PPK2 device connected via USB

---

## Installation

```bash
cd cli/
pip install -r requirements.txt
```

Or install globally:

```bash
pip install pyserial
```

---

## Linux USB permissions

By default, USB serial devices (`/dev/ttyACM*`) are owned by the `dialout`
group.  Either add your user to that group (requires re-login) or install a
udev rule:

### Option 1 – add user to `dialout` group

```bash
sudo usermod -aG dialout $USER
# Log out and back in, then verify:
groups | grep dialout
```

### Option 2 – udev rule for the PPK2 specifically

Create `/etc/udev/rules.d/99-ppk2.rules`:

```
SUBSYSTEM=="tty", ATTRS{idVendor}=="1915", ATTRS{idProduct}=="c00a", MODE="0666", GROUP="plugdev", TAG+="uaccess"
```

Then reload:

```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
```

---

## Usage

```
usage: ppk2_cli [-h] [-p PORT] [-o OUTPUT] [-d DURATION] [-s SAMPLE_RATE]
                [-v VDD] [--mode {source,ampere}]

options:
  -h, --help            show this help message and exit
  -p PORT, --port PORT  Serial port (e.g. /dev/ttyACM0). Auto-detected if
                        omitted. (default: None)
  -o OUTPUT, --output OUTPUT
                        Output filename. Defaults to "ppk2_<timestamp>.ppk2".
                        (default: None)
  -d DURATION, --duration DURATION
                        Recording duration in seconds. (default: 10.0)
  -s SAMPLE_RATE, --sample-rate SAMPLE_RATE
                        Output sample rate in Hz. Must divide evenly into
                        100000. When lower than the native 100 kHz rate,
                        samples are averaged. (default: 100000)
  -v VDD, --vdd VDD     Supply voltage in mV (source mode only). (default:
                        3300)
  --mode {source,ampere}
                        source: PPK2 powers the DUT (SMU mode). ampere:
                        external power, PPK2 measures only. (default: source)
```

### Examples

**Auto-detect device, 10-second recording at full 100 kHz:**

```bash
python ppk2_cli.py
```

**Specify port, save to custom file, record 30 seconds:**

```bash
python ppk2_cli.py --port /dev/ttyACM0 --output my_recording.ppk2 --duration 30
```

**Source mode at 5 V, record 60 seconds:**

```bash
python ppk2_cli.py --mode source --vdd 5000 --duration 60
```

**Ampere mode (external power), downsample to 10 kHz to reduce file size:**

```bash
python ppk2_cli.py --mode ampere --sample-rate 10000 --duration 120
```

**Stop early** – press **Ctrl-C** at any time to stop recording and save the
data collected so far.

---

## .ppk2 File Format

A `.ppk2` file is a standard ZIP archive (deflate compression, level 6)
containing three entries:

### `session.raw`

Raw binary sample data, **6 bytes per sample**:

| Bytes | Type | Description |
|-------|------|-------------|
| 0–3 | `float32` little-endian | Current in **µA** |
| 4–5 | `uint16` little-endian | Digital channel bits (8 channels) |

### `metadata.json`

```json
{
  "metadata": {
    "samplesPerSecond": 100000,
    "startSystemTime": 1713360000000
  },
  "formatVersion": 2
}
```

- `samplesPerSecond` – the output sample rate (may differ from the native
  100 kHz if `--sample-rate` was used)
- `startSystemTime` – recording start as Unix epoch **milliseconds**
- `formatVersion` – always `2` for `.ppk2` files

### `minimap.raw`

JSON representation of the `FoldingBuffer` data structure used by the
Power Profiler for the overview minimap visualisation.  Contains adaptively
compressed min/max values across the entire recording.

---

## Technical Details

### Serial Protocol

The PPK2 communicates at **115200 baud** over a USB CDC ACM serial port.

1. Send `GetMetadata` command (`0x19`) → device responds with calibration data ending in `END`
2. Parse modifiers (`r0–r4`, `gs0–gs4`, `gi0–gi4`, `o0–o4`, `s0–s4`, `i0–i4`, `ug0–ug4`)
3. Send `SetPowerMode` (`0x11`, byte 2 = source / byte 1 = ampere)
4. Optionally send `RegulatorSet` (`0x0D`, VDD high byte, VDD low byte)
5. Send `AverageStart` (`0x06`) to begin sampling
6. Read 4-byte little-endian frames continuously
7. Send `AverageStop` (`0x07`) to stop

### Frame Format (4 bytes, little-endian uint32)

| Bits | Field | Description |
|------|-------|-------------|
| 0–13 | ADC value | 14-bit raw ADC reading |
| 14–16 | Range | Measurement range 0–4 |
| 18–23 | Counter | 6-bit rolling counter for data-loss detection |
| 24–31 | Logic | 8 digital input channel bits |

### ADC to Current Conversion

```
adcMult = 1.8 / 163840
adcResult = adcValue[0:13] * 4
resultWithoutGain = (adcResult - o[range]) * (adcMult / r[range])
adc = ug[range] * (resultWithoutGain * (gs[range] * resultWithoutGain + gi[range])
                   + (s[range] * (vdd/1000) + i[range]))
current_µA = adc * 1e6
```

A spike filter using exponential rolling averages (α = 0.18 for ranges 0–3,
α = 0.06 for range 4) smooths transients caused by automatic range switching.

### Sub-sampling

When `--sample-rate` is less than the native 100 kHz, the tool averages
`100000 / sample_rate` consecutive native samples into one output sample.
Digital bits are OR-combined so that any event within the interval is
preserved.

---

## Compatibility

Files produced by this tool are fully compatible with:

- **nRF Connect Power Profiler** ≥ 4.0 (`.ppk2` format version 2)
- Any tool that can read the ZIP-based `.ppk2` format described above
