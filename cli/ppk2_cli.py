#!/usr/bin/env python3
"""
ppk2_cli.py – Standalone command-line tool for recording Nordic PPK2 data.

Reads measurement data from a PPK2 device via USB serial, applies calibration
and optional sub-sampling, then writes the result as a .ppk2 file compatible
with the nRF Connect Power Profiler desktop application.

Usage examples
--------------
Auto-detect device, record 10 s, write ppk2_<timestamp>.ppk2::

    python ppk2_cli.py

Specify port, output file and duration::

    python ppk2_cli.py --port /dev/ttyACM0 --output recording.ppk2 --duration 30

Ampere mode (external power), downsample to 10 kHz::

    python ppk2_cli.py --mode ampere --sample-rate 10000

"""

import argparse
import signal
import struct
import sys
import time
from datetime import datetime

import serial
from ppk2_device import PPK2Device, find_ppk2_port
from ppk2_format import FoldingBuffer, write_ppk2_file

# Native PPK2 sample rate (hardware fixed at 100 kHz)
NATIVE_SAMPLE_RATE = 100_000


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="ppk2_cli",
        description="Record PPK2 measurements and save as a .ppk2 file.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "-p", "--port",
        default=None,
        help="Serial port (e.g. /dev/ttyACM0). Auto-detected if omitted.",
    )
    parser.add_argument(
        "-o", "--output",
        default=None,
        help='Output filename.  Defaults to "ppk2_<timestamp>.ppk2".',
    )
    parser.add_argument(
        "-d", "--duration",
        type=float,
        default=10.0,
        help="Recording duration in seconds.",
    )
    parser.add_argument(
        "-s", "--sample-rate",
        type=int,
        default=NATIVE_SAMPLE_RATE,
        help=(
            "Output sample rate in Hz.  Must divide evenly into 100000. "
            "When lower than the native 100 kHz rate, samples are averaged."
        ),
    )
    parser.add_argument(
        "-v", "--vdd",
        type=int,
        default=3300,
        help="Supply voltage in mV (source mode only).",
    )
    parser.add_argument(
        "--mode",
        choices=["source", "ampere"],
        default="source",
        help=(
            "source: PPK2 powers the DUT (SMU mode). "
            "ampere: external power, PPK2 measures only."
        ),
    )
    return parser.parse_args(argv)


# ---------------------------------------------------------------------------
# Downsampling helper
# ---------------------------------------------------------------------------

class _Downsampler:
    """
    Accumulates native-rate samples and emits averaged output samples.

    :param factor: Number of native samples to average into one output sample.
                   Must be >= 1.
    """

    def __init__(self, factor: int) -> None:
        self.factor = max(1, factor)
        self._acc_current = 0.0
        self._acc_bits = 0
        self._count = 0

    def feed(self, current_ua: float, bits: int) -> tuple[float, int] | None:
        """
        Feed one native sample.

        Returns an output sample ``(avg_current_µA, combined_bits)`` when
        ``factor`` native samples have been accumulated, otherwise *None*.
        """
        self._acc_current += current_ua
        self._acc_bits |= bits
        self._count += 1

        if self._count == self.factor:
            avg = self._acc_current / self.factor
            out_bits = self._acc_bits
            self._acc_current = 0.0
            self._acc_bits = 0
            self._count = 0
            return avg, out_bits

        return None


# ---------------------------------------------------------------------------
# Recording loop
# ---------------------------------------------------------------------------

def record(args: argparse.Namespace) -> int:
    """
    Main recording loop.  Returns an exit code (0 = success).
    """
    # ----- Validate sample rate -----
    if NATIVE_SAMPLE_RATE % args.sample_rate != 0:
        print(
            f"Error: --sample-rate {args.sample_rate} does not evenly divide "
            f"the native rate {NATIVE_SAMPLE_RATE}.",
            file=sys.stderr,
        )
        return 1

    decimation = NATIVE_SAMPLE_RATE // args.sample_rate

    # ----- Auto-detect port -----
    port = args.port
    if port is None:
        port = find_ppk2_port()
        if port is None:
            print(
                "Error: PPK2 device not found.  Connect the device or specify "
                "--port explicitly.",
                file=sys.stderr,
            )
            return 1
        print(f"Auto-detected PPK2 on {port}")

    # ----- Output filename -----
    output = args.output
    if output is None:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        output = f"ppk2_{ts}.ppk2"

    # ----- Initialise data structures -----
    # session_raw is built incrementally as a bytearray (6 bytes per output sample)
    session_raw = bytearray()
    folding_buffer = FoldingBuffer()
    downsampler = _Downsampler(decimation)

    samples_written = 0
    start_system_time = int(time.time() * 1000)  # epoch ms

    # ----- Graceful Ctrl-C handling -----
    interrupted = False

    def _sigint_handler(_signum, _frame):  # noqa: N802
        nonlocal interrupted
        interrupted = True
        print("\nRecording interrupted – saving file…")

    signal.signal(signal.SIGINT, _sigint_handler)

    # ----- Open device -----
    device = PPK2Device(port, vdd=args.vdd)
    try:
        print(f"Opening {port}…")
        device.open()

        print("Fetching device metadata / calibration…")
        meta = device.get_metadata()
        device.parse_meta(meta)

        source_mode = args.mode == "source"
        print(f"Setting power mode: {'source (SMU)' if source_mode else 'ampere'}")
        device.set_power_mode(source_mode)

        if source_mode:
            print(f"Setting VDD = {args.vdd} mV")
            device.set_vdd(args.vdd)

        print(f"Starting recording for {args.duration} s at {args.sample_rate} Hz…")
        print("Press Ctrl-C to stop early and save.\n")

        device.start_averaging()
        t_start = time.monotonic()
        t_last_progress = t_start

        # ----- Main collection loop -----
        while not interrupted:
            elapsed = time.monotonic() - t_start
            if elapsed >= args.duration:
                break

            raw_samples = device.read_samples()
            for current_ua, bits in raw_samples:
                out = downsampler.feed(current_ua, bits)
                if out is not None:
                    out_ua, out_bits = out
                    # Append 6 bytes to session_raw (float32 LE current + uint16 LE bits)
                    session_raw.extend(struct.pack("<f", out_ua))
                    session_raw.extend(struct.pack("<H", out_bits & 0xFFFF))

                    # Update folding buffer (timestamp in µs)
                    timestamp_us = (samples_written * 1_000_000) / args.sample_rate
                    folding_buffer.add_data(out_ua, timestamp_us)
                    samples_written += 1

            # Progress report once per second
            now = time.monotonic()
            if now - t_last_progress >= 1.0:
                pct = min(100.0, (now - t_start) / args.duration * 100)
                print(
                    f"  {now - t_start:5.1f} s / {args.duration} s  "
                    f"({pct:5.1f}%)  –  {samples_written:,} samples",
                    end="\r",
                )
                t_last_progress = now

            # Avoid busy-spinning; data arrives in ~30 ms bursts
            if not raw_samples:
                time.sleep(0.005)

        device.stop_averaging()

    except (serial.SerialException, IOError, OSError) as exc:
        print(f"\nDevice error: {exc}", file=sys.stderr)
        return 1

    finally:
        device.close()

    print(f"\nCollected {samples_written:,} samples.")

    if samples_written == 0:
        print("No samples collected – nothing to save.", file=sys.stderr)
        return 1

    # ----- Write .ppk2 file -----
    print(f"Writing {output}…")
    write_ppk2_file(
        filename=output,
        session_raw=session_raw,
        folding_buffer=folding_buffer,
        samples_per_second=args.sample_rate,
        start_system_time=start_system_time,
    )

    size_kb = len(session_raw) / 1024
    print(f"Done.  Saved {output} ({size_kb:.1f} kB session data, "
          f"{samples_written:,} samples @ {args.sample_rate} Hz)")

    if device.data_loss_counter > 0:
        print(
            f"Warning: {device.data_loss_counter} samples were lost during "
            "recording (USB bandwidth issue)."
        )

    return 0


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    args = parse_args()
    sys.exit(record(args))


if __name__ == "__main__":
    main()
