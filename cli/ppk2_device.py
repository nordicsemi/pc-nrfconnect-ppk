"""
PPK2 device communication module.

Handles serial communication with the Nordic Power Profiler Kit II (PPK2),
including metadata retrieval, calibration parsing, and ADC-to-current conversion.
"""

import glob
import struct
import time

import serial

# ---------------------------------------------------------------------------
# PPK2 command codes (from src/constants.ts)
# ---------------------------------------------------------------------------
CMD_AVERAGE_START = 0x06
CMD_AVERAGE_STOP = 0x07
CMD_REGULATOR_SET = 0x0D
CMD_SET_POWER_MODE = 0x11
CMD_GET_METADATA = 0x19
CMD_DEVICE_RUNNING_SET = 0x0C

# ---------------------------------------------------------------------------
# Bitmask definitions for the 4-byte measurement frame
# Bits 0-13  : ADC value  (14 bits)
# Bits 14-16 : Range      (3 bits, 0-4)
# Bits 18-23 : Counter    (6 bits, for data-loss detection)
# Bits 24-31 : Logic/digital channel bits (8 bits)
# ---------------------------------------------------------------------------
_MEAS_ADC_MASK = (2**14 - 1) << 0    # bits 0-13
_MEAS_ADC_POS = 0
_MEAS_RANGE_MASK = (2**3 - 1) << 14  # bits 14-16
_MEAS_RANGE_POS = 14
_MEAS_COUNTER_MASK = (2**6 - 1) << 18  # bits 18-23
_MEAS_COUNTER_POS = 18
_MEAS_LOGIC_MASK = (2**8 - 1) << 24  # bits 24-31
_MEAS_LOGIC_POS = 24

MAX_PAYLOAD_COUNTER = 0x3F   # 6-bit counter wraps at 63
ADC_MULT = 1.8 / 163840      # ADC multiplier constant

# USB VID/PID for the Nordic PPK2
PPK2_VID = 0x1915
PPK2_PID = 0xC00A


def _get_masked(value: int, mask: int, pos: int) -> int:
    return (value & mask) >> pos


def find_ppk2_port() -> str | None:
    """
    Try to auto-detect the PPK2 serial port.

    First checks USB VID:PID via pyserial's list_ports; falls back to
    scanning common Linux serial device patterns.

    Returns the port path string, or *None* if not found.
    """
    try:
        from serial.tools import list_ports  # pylint: disable=import-outside-toplevel

        for port_info in list_ports.comports():
            if port_info.vid == PPK2_VID and port_info.pid == PPK2_PID:
                return port_info.device
    except ImportError:
        pass  # pyserial may be installed without list_ports on some platforms

    # Fallback: try common Linux serial port patterns in order
    for pattern in ("/dev/ttyACM*", "/dev/ttyUSB*"):
        candidates = sorted(glob.glob(pattern))
        if candidates:
            return candidates[0]

    return None


class PPK2Device:
    """
    Manages communication with a PPK2 device over a USB serial connection.

    Usage::

        device = PPK2Device("/dev/ttyACM0", vdd=3300)
        device.open()
        meta = device.get_metadata()
        device.parse_meta(meta)
        device.set_power_mode(source_mode=True)
        device.set_vdd(3300)
        device.start_averaging()
        # ... read with device.read_samples() in a loop ...
        device.stop_averaging()
        device.close()
    """

    # Default calibration modifiers (from serialDevice.ts)
    _DEFAULT_MODIFIERS = {
        "r":  [1031.64, 101.65, 10.15, 0.94, 0.043],
        "gs": [1.0, 1.0, 1.0, 1.0, 1.0],
        "gi": [1.0, 1.0, 1.0, 1.0, 1.0],
        "o":  [0.0, 0.0, 0.0, 0.0, 0.0],
        "s":  [0.0, 0.0, 0.0, 0.0, 0.0],
        "i":  [0.0, 0.0, 0.0, 0.0, 0.0],
        "ug": [1.0, 1.0, 1.0, 1.0, 1.0],
    }

    def __init__(self, port: str, vdd: int = 3300) -> None:
        self.port_path = port
        self.vdd = vdd
        self._ser: serial.Serial | None = None

        # Copy default modifiers so each instance is independent
        self.modifiers = {k: list(v) for k, v in self._DEFAULT_MODIFIERS.items()}

        # Spike filter parameters (alpha = 0.18, alpha5 = 0.06, samples = 3)
        self._spike_filter = {"alpha": 0.18, "alpha5": 0.06, "samples": 3}

        # Rolling averages for spike filter
        self._rolling_avg: float | None = None
        self._rolling_avg4: float | None = None
        self._prev_range: int | None = None
        self._after_spike: int = 0
        self._consecutive_range_sample: int = 0

        # Data-loss detection
        self._expected_counter: int | None = None
        self.data_loss_counter: int = 0

        # Remainder buffer for partial 4-byte frames
        self._remainder = b""

        # Power mode: True = Source (SMU) mode, False = Ampere mode
        self._source_mode: bool = False

    # ------------------------------------------------------------------
    # Serial port management
    # ------------------------------------------------------------------

    def open(self) -> None:
        """Open the serial port at 115200 baud."""
        self._ser = serial.Serial(
            port=self.port_path,
            baudrate=115200,
            timeout=1.0,
        )
        time.sleep(0.1)  # Allow device to stabilise

    def close(self) -> None:
        """Close the serial port."""
        if self._ser and self._ser.is_open:
            self._ser.close()
            self._ser = None

    # ------------------------------------------------------------------
    # Command helpers
    # ------------------------------------------------------------------

    def _send(self, cmd: list[int]) -> None:
        """Send a raw command byte sequence."""
        if self._ser is None:
            raise RuntimeError("Serial port is not open")
        self._ser.write(bytes(cmd))

    # ------------------------------------------------------------------
    # Device setup
    # ------------------------------------------------------------------

    def get_metadata(self) -> dict:
        """
        Send the GetMetadata command and parse the response.

        The device replies with a text block of ``key: value`` lines
        terminated by the literal string ``END``.

        Returns a dict of parsed metadata values.
        Raises *RuntimeError* if the port is not open.
        Raises *IOError* if no metadata is received within 5 seconds.
        """
        if self._ser is None:
            raise RuntimeError("Serial port is not open – call open() first")
        self._send([CMD_GET_METADATA])

        raw = b""
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            chunk = self._ser.read(256)
            if chunk:
                raw += chunk
                if b"END" in raw:
                    break

        if not raw:
            raise IOError("No metadata received from PPK2 device")

        text = raw.decode("ascii", errors="replace")
        end_idx = text.find("END")
        if end_idx >= 0:
            text = text[:end_idx]

        text = text.strip().lower().replace("-nan", "null")

        meta: dict = {}
        for line in text.splitlines():
            line = line.strip()
            if ": " in line:
                key, _, val = line.partition(": ")
                key = key.strip()
                val = val.strip()
                if val == "null":
                    meta[key] = None
                else:
                    try:
                        meta[key] = float(val)
                    except ValueError:
                        meta[key] = val

        return meta

    def parse_meta(self, meta: dict) -> None:
        """
        Apply calibration modifiers from the device metadata dict.

        Updates ``self.modifiers`` with values from the device for each of
        the modifier keys (r0-r4, gs0-gs4, gi0-gi4, …).
        """
        for mod_key, mod_array in self.modifiers.items():
            for index in range(len(mod_array)):
                key = f"{mod_key}{index}"
                if key in meta and meta[key] is not None:
                    mod_array[index] = float(meta[key])

        if "vdd" in meta and meta["vdd"] is not None:
            self.vdd = int(float(meta["vdd"]))

    def set_power_mode(self, source_mode: bool) -> None:
        """
        Set the PPK2 power mode.

        :param source_mode: *True* → Source (SMU) mode (PPK2 powers the DUT).
                            *False* → Ampere mode (external power source).
        """
        self._source_mode = source_mode
        mode_byte = 2 if source_mode else 1
        self._send([CMD_SET_POWER_MODE, mode_byte])
        time.sleep(0.05)

    def set_device_running(self, enable: bool) -> None:
        """Toggle DUT power: True = ON [0x0C, 0x01], False = OFF [0x0C, 0x00]."""
        self._send([CMD_DEVICE_RUNNING_SET, 1 if enable else 0])
        time.sleep(0.05)

    def set_vdd(self, vdd_mv: int) -> None:
        """Set the supply voltage in millivolts (source mode only)."""
        self.vdd = vdd_mv
        high_byte = (vdd_mv >> 8) & 0xFF
        low_byte = vdd_mv & 0xFF
        self._send([CMD_REGULATOR_SET, high_byte, low_byte])
        time.sleep(0.05)

    def start_averaging(self) -> None:
        """Start continuous measurement (AverageStart command)."""
        # Reset spike filter state
        self._rolling_avg = None
        self._rolling_avg4 = None
        self._prev_range = None
        self._consecutive_range_sample = 0
        self._after_spike = 0
        # Reset data-loss detection
        self._expected_counter = None
        self.data_loss_counter = 0
        self._remainder = b""

        if self._source_mode:
            self.set_device_running(True)
        self._send([CMD_AVERAGE_START])

    def stop_averaging(self) -> None:
        """Stop continuous measurement (AverageStop command)."""
        self._send([CMD_AVERAGE_STOP])
        if self._source_mode:
            self.set_device_running(False)

    # ------------------------------------------------------------------
    # ADC conversion and spike filter
    # ------------------------------------------------------------------

    def _get_adc_result(self, range_idx: int, adc_val: float) -> float:
        """
        Convert a raw ADC reading to a current value in Amperes.

        Implements the full calibration + spike-filter algorithm from
        ``serialDevice.ts::getAdcResult()``.
        """
        r = self.modifiers["r"][range_idx]
        gs = self.modifiers["gs"][range_idx]
        gi = self.modifiers["gi"][range_idx]
        o = self.modifiers["o"][range_idx]
        s = self.modifiers["s"][range_idx]
        i_mod = self.modifiers["i"][range_idx]
        ug = self.modifiers["ug"][range_idx]

        result_without_gain = (adc_val - o) * (ADC_MULT / r)
        adc = ug * (
            result_without_gain * (gs * result_without_gain + gi)
            + (s * (self.vdd / 1000.0) + i_mod)
        )

        # Save rolling averages before updating (needed for range-4 roll-back)
        prev_rolling_avg4 = self._rolling_avg4
        prev_rolling_avg = self._rolling_avg

        alpha = self._spike_filter["alpha"]
        alpha5 = self._spike_filter["alpha5"]

        if self._rolling_avg is None:
            self._rolling_avg = adc
        else:
            self._rolling_avg = alpha * adc + (1.0 - alpha) * self._rolling_avg

        if self._rolling_avg4 is None:
            self._rolling_avg4 = adc
        else:
            self._rolling_avg4 = alpha5 * adc + (1.0 - alpha5) * self._rolling_avg4

        if self._prev_range is None:
            self._prev_range = range_idx

        if self._prev_range != range_idx or self._after_spike > 0:
            if self._prev_range != range_idx:
                self._consecutive_range_sample = 0
                self._after_spike = self._spike_filter["samples"]
            else:
                self._consecutive_range_sample += 1

            # For range 4, roll back the rolling averages for the first two samples
            if range_idx == 4:
                if self._consecutive_range_sample < 2:
                    self._rolling_avg4 = prev_rolling_avg4
                    self._rolling_avg = prev_rolling_avg
                adc = self._rolling_avg4 if self._rolling_avg4 is not None else adc
            else:
                adc = self._rolling_avg  # type: ignore[assignment]

            self._after_spike -= 1

        self._prev_range = range_idx
        return adc  # type: ignore[return-value]

    def _process_frame(self, raw_value: int) -> tuple[float, int] | None:
        """
        Decode a 4-byte measurement frame integer into (current_µA, bits).

        Handles the data-loss counter and returns *None* for completely
        invalid samples (exception during conversion).
        """
        try:
            current_range = min(
                _get_masked(raw_value, _MEAS_RANGE_MASK, _MEAS_RANGE_POS),
                len(self.modifiers["r"]) - 1,
            )
            counter = _get_masked(raw_value, _MEAS_COUNTER_MASK, _MEAS_COUNTER_POS)
            adc_result = _get_masked(raw_value, _MEAS_ADC_MASK, _MEAS_ADC_POS) * 4
            bits = _get_masked(raw_value, _MEAS_LOGIC_MASK, _MEAS_LOGIC_POS)

            current_a = self._get_adc_result(current_range, adc_result)
            current_ua = current_a * 1e6

            # Cap negative / sub-noise values (PPK2 reads down to ~200 nA)
            if current_ua < 0.2:
                current_ua = 0.0

            # Data-loss detection via 6-bit counter
            if self._expected_counter is None:
                self._expected_counter = counter
            elif self._expected_counter != counter:
                missing = (
                    counter - self._expected_counter
                ) & MAX_PAYLOAD_COUNTER
                self.data_loss_counter += missing

            self._expected_counter = (counter + 1) & MAX_PAYLOAD_COUNTER
            return current_ua, bits

        except (ValueError, ZeroDivisionError, OverflowError, IndexError):
            # Catch specific arithmetic/indexing errors that can occur during
            # ADC conversion.  Returning None drops the corrupted sample and
            # keeps the timestamp stream consistent.
            return None

    def parse_data_chunk(self, data: bytes) -> list[tuple[float, int]]:
        """
        Parse raw bytes from the serial port into a list of (current_µA, bits).

        Handles partial 4-byte frames across successive calls using an
        internal remainder buffer.
        """
        buf = self._remainder + data
        samples: list[tuple[float, int]] = []
        sample_size = 4

        pos = 0
        while pos + sample_size <= len(buf):
            (raw_val,) = struct.unpack_from("<I", buf, pos)
            pos += sample_size
            result = self._process_frame(raw_val)
            if result is not None:
                samples.append(result)

        self._remainder = buf[pos:]
        return samples

    def read_samples(self) -> list[tuple[float, int]]:
        """
        Read all currently available bytes from the serial port and decode
        them into (current_µA, bits) samples.

        Returns an empty list if no data is available.
        """
        if self._ser is None or not self._ser.is_open:
            return []
        waiting = self._ser.in_waiting
        if not waiting:
            return []
        data = self._ser.read(waiting)
        return self.parse_data_chunk(data)
