"""Builds a small JSON preview of every raw CSV file for eyeballing data correctness.

Reads only the first `PREVIEW_ROWS` rows of each file (via data_loader's nrows
support, so this never touches the full 10M-row files) plus each file's size on
disk, and writes one JSON consumed by docs/raw-data.html -- a sanity-check table
showing a handful of readings from every sensor at every temperature/voltage
condition, independent of the entropy pipeline in main.py.
"""

import json
from pathlib import Path

from modules import data_loader

PREVIEW_ROWS = 10
CONDITIONS = [(temp, voltage) for temp in (0, 24, 40) for voltage in (3.3, 5.0)]


def _condition_key(temp: int, voltage: float) -> str:
    voltage_str = "5" if voltage == 5.0 else f"{voltage}"
    return f"{temp}_{voltage_str}"


def build_preview(data_dir: Path) -> dict:
    files_by_sensor: dict[str, dict] = {}
    variants_by_sensor: dict[str, str] = {}

    for path in data_loader.discover_csv_files(data_dir):
        reading = data_loader.load_sensor_reading(
            path,
            columns=["Index", "Raw_ADC", "Voltage_mV", "Temperature_C"],
            nrows=PREVIEW_ROWS,
        )
        variants_by_sensor[reading.sensor_id] = reading.variant
        key = _condition_key(reading.temperature_c, reading.voltage_v)
        files_by_sensor.setdefault(reading.sensor_id, {})[key] = {
            "rows": reading.data.to_dict(orient="records"),
            "file_size_mb": round(path.stat().st_size / (1024 * 1024), 1),
            "source_file": path.name,
        }

    sensors = sorted(variants_by_sensor)
    return {
        "num_preview_rows": PREVIEW_ROWS,
        "conditions": [{"temp": t, "voltage": v} for t, v in CONDITIONS],
        "sensors": sensors,
        "variants": variants_by_sensor,
        "files": files_by_sensor,
    }


def write_preview(data_dir: Path, out_path: Path) -> dict:
    preview = build_preview(data_dir)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(preview, indent=2))
    return preview


if __name__ == "__main__":
    root = Path(__file__).parent.parent
    result = write_preview(root / "data", root / "docs" / "data" / "raw_preview.json")
    n_files = sum(len(v) for v in result["files"].values())
    print(f"Wrote preview for {n_files} files across {len(result['sensors'])} sensors.")
