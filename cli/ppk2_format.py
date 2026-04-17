"""
PPK2 file format writer.

Creates .ppk2 files (ZIP archives) that are fully compatible with the
nRF Connect Power Profiler desktop application.

File structure inside the ZIP:
  session.raw    – 6 bytes per sample: float32 LE (current µA) + uint16 LE (digital bits)
  metadata.json  – JSON: formatVersion, samplesPerSecond, startSystemTime
  minimap.raw    – JSON: FoldingBuffer state for the minimap visualisation
"""

import json
import math
import struct
import sys
import time
import zipfile


# ---------------------------------------------------------------------------
# FoldingBuffer
# ---------------------------------------------------------------------------


class FoldingBuffer:
    """
    Python port of ``src/utils/foldingBuffer.ts``.

    Maintains an adaptively compressed overview of min/max sample values used
    to render the minimap in the Power Profiler UI.  The buffer keeps at most
    ``MAX_ELEMENTS`` entries; when full it folds (halves) the data by merging
    adjacent pairs.
    """

    MAX_ELEMENTS = 10_000

    def __init__(self) -> None:
        self.max_number_of_elements = self.MAX_ELEMENTS
        self.number_of_times_to_fold = 1
        self.last_element_fold_count = 0
        # Use lists of None; slots are filled as data arrives
        self._min: list[dict | None] = [None] * self.MAX_ELEMENTS
        self._max: list[dict | None] = [None] * self.MAX_ELEMENTS
        self._length = 0

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _add_default(self, timestamp: float) -> None:
        idx = self._length
        # Use float infinity as sentinels (more idiomatic than sys.float_info.max
        # and correct for min/max comparisons)
        self._min[idx] = {"x": timestamp, "y": math.inf}
        self._max[idx] = {"x": timestamp, "y": -math.inf}
        self._length += 1

    def _fold(self) -> None:
        """Halve the buffer by merging adjacent pairs (min of min, max of max)."""
        self.number_of_times_to_fold *= 2
        half = self._length // 2
        for i in range(half):
            a, b = i * 2, i * 2 + 1
            # Merge min pair
            min_a = self._min[a]  # type: ignore[index]
            min_b = self._min[b]  # type: ignore[index]
            self._min[i] = {
                "x": (min_a["x"] + min_b["x"]) / 2,
                "y": min(min_a["y"], min_b["y"]),
            }
            # Merge max pair
            max_a = self._max[a]  # type: ignore[index]
            max_b = self._max[b]  # type: ignore[index]
            self._max[i] = {
                "x": (max_a["x"] + max_b["x"]) / 2,
                "y": max(max_a["y"], max_b["y"]),
            }
        self._length = half

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def add_data(self, value_ua: float, timestamp_us: float) -> None:
        """
        Add a measurement sample.

        :param value_ua:     Current in µA.
        :param timestamp_us: Sample timestamp in microseconds.
        """
        if self.last_element_fold_count == 0:
            self._add_default(timestamp_us)

        value_na = value_ua * 1000.0  # µA → nA (matches TS implementation)

        # Clamp to 200 nA minimum to support logarithmic y-axis display
        if value_na < 200:
            value_na = 200

        self.last_element_fold_count += 1
        alpha = 1.0 / self.last_element_fold_count
        idx = self._length - 1

        cur_min = self._min[idx]  # type: ignore[index]
        cur_max = self._max[idx]  # type: ignore[index]

        if not math.isnan(value_na):
            self._min[idx] = {
                "x": timestamp_us * alpha + cur_min["x"] * (1 - alpha),
                "y": min(value_na, cur_min["y"]),
            }
            self._max[idx] = {
                "x": timestamp_us * alpha + cur_max["x"] * (1 - alpha),
                "y": max(value_na, cur_max["y"]),
            }
        else:
            # NaN value: only update x (keep current min/max y)
            self._min[idx] = {
                "x": timestamp_us * alpha + cur_min["x"] * (1 - alpha),
                "y": cur_min["y"],
            }
            self._max[idx] = {
                "x": timestamp_us * alpha + cur_max["x"] * (1 - alpha),
                "y": cur_max["y"],
            }

        if self.last_element_fold_count == self.number_of_times_to_fold:
            self.last_element_fold_count = 0

        if self._length == self.max_number_of_elements:
            self._fold()

    def to_dict(self) -> dict:
        """
        Serialise the buffer state to a dict suitable for ``json.dumps``.

        The layout mirrors the ``saveToFile`` output of the TypeScript
        FoldingBuffer so the Power Profiler can read it back with
        ``loadFromFile``.
        """
        length = self._length

        # Replace any residual infinity sentinels with the maximum finite
        # float before JSON serialisation (json.dumps cannot encode inf).
        _finite_max = sys.float_info.max

        def _safe_entry(entry: dict) -> dict:
            y = entry["y"]
            if math.isinf(y):
                y = _finite_max if y > 0 else -_finite_max
            return {"x": entry["x"], "y": y}

        # Entries beyond `length` are null, matching JS sparse-array JSON
        # serialisation of the TypeScript FoldingBuffer.
        min_array = [_safe_entry(self._min[i]) for i in range(length)] + \
                    [None] * (self.max_number_of_elements - length)
        max_array = [_safe_entry(self._max[i]) for i in range(length)] + \
                    [None] * (self.max_number_of_elements - length)

        return {
            "lastElementFoldCount": self.last_element_fold_count,
            "data": {
                "length": length,
                "min": min_array,
                "max": max_array,
            },
            "maxNumberOfElements": self.max_number_of_elements,
            "numberOfTimesToFold": self.number_of_times_to_fold,
        }


# ---------------------------------------------------------------------------
# PPK2 file writer
# ---------------------------------------------------------------------------

def write_ppk2_file(
    filename: str,
    session_raw: bytes | bytearray,
    folding_buffer: FoldingBuffer,
    samples_per_second: int,
    start_system_time: int | None = None,
) -> None:
    """
    Write a ``.ppk2`` file.

    The resulting file is a ZIP archive (deflate, level 6) containing:

    * ``session.raw``   – raw sample data (6 bytes per sample)
    * ``metadata.json`` – JSON metadata (format version 2)
    * ``minimap.raw``   – JSON FoldingBuffer state for the minimap

    :param filename:           Output file path (should end in ``.ppk2``).
    :param session_raw:        Raw bytes: 4-byte float32 LE current µA + 2-byte uint16 LE bits,
                               repeated for every sample.
    :param folding_buffer:     Populated :class:`FoldingBuffer` instance.
    :param samples_per_second: Sample rate stored in the metadata.
    :param start_system_time:  Recording start time as Unix epoch milliseconds.
                               Defaults to the current wall-clock time.
    """
    if start_system_time is None:
        start_system_time = int(time.time() * 1000)

    metadata = {
        "metadata": {
            "samplesPerSecond": samples_per_second,
            "startSystemTime": start_system_time,
        },
        "formatVersion": 2,
    }

    with zipfile.ZipFile(filename, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        zf.writestr("session.raw", bytes(session_raw))
        zf.writestr("metadata.json", json.dumps(metadata).encode("utf-8"))
        zf.writestr("minimap.raw", json.dumps(folding_buffer.to_dict()).encode("utf-8"))


# ---------------------------------------------------------------------------
# Convenience helpers
# ---------------------------------------------------------------------------

def build_session_raw(samples: list[tuple[float, int]]) -> bytearray:
    """
    Pack a list of ``(current_µA, bits)`` tuples into raw session bytes.

    Each sample occupies 6 bytes:
    * bytes 0-3: float32 little-endian (current in µA)
    * bytes 4-5: uint16 little-endian (digital channel bits)
    """
    buf = bytearray(len(samples) * 6)
    for i, (current_ua, bits) in enumerate(samples):
        struct.pack_into("<f", buf, i * 6, current_ua)
        struct.pack_into("<H", buf, i * 6 + 4, bits & 0xFFFF)
    return buf
