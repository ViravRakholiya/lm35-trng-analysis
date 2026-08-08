"""Loads raw LM35/ADS1115 CSV data into structured per-sensor/condition records.

Filenames follow the standardized convention (see data/rename_manifest.csv for the
mapping from original collection filenames): LM35_{sensor}_{temp}C_{voltage}V_{samples}.csv
Each sensor folder is named "{sensor} Sensor" (e.g. "A1 Sensor") and is the
authoritative source of the sensor ID; the filename's sensor code is expected to match.

CSV files use one of two interchangeable header spellings for the same columns
(e.g. "Voltage_mV" vs "Voltage (mV)") depending on when they were collected.
"""

import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

FILENAME_PATTERN = re.compile(
    r"LM35_(?P<sensor>(?P<variant>[A-C])\d+)_(?P<temp>\d+)C_(?P<voltage>[\d.]+)V_(?P<samples>\w+)\.csv"
)

COLUMN_ALIASES = {
    "Index": ["Index"],
    "Raw_ADC": ["Raw_ADC"],
    "Voltage_mV": ["Voltage_mV", "Voltage (mV)"],
    "Temperature_C": ["Temperature_C", "Temperature (C)"],
}


@dataclass
class SensorReading:
    sensor_id: str
    variant: str  # "A", "B", or "C"
    temperature_c: int
    voltage_v: float
    source_path: Path
    data: pd.DataFrame  # normalized columns: Index, Raw_ADC, [Voltage_mV, Temperature_C]


def discover_csv_files(data_dir: Path) -> list[Path]:
    return sorted(data_dir.glob("*Sensor/LM35_*.csv"))


def parse_filename(path: Path) -> dict:
    match = FILENAME_PATTERN.match(path.name)
    if not match:
        raise ValueError(f"Filename does not match expected convention: {path.name}")

    folder_sensor_id = path.parent.name.split()[0]
    filename_sensor_id = match.group("sensor")
    if folder_sensor_id != filename_sensor_id:
        raise ValueError(
            f"Sensor ID mismatch for {path}: folder says {folder_sensor_id!r}, "
            f"filename says {filename_sensor_id!r}"
        )

    return {
        "sensor_id": folder_sensor_id,
        "variant": match.group("variant"),
        "temperature_c": int(match.group("temp")),
        "voltage_v": float(match.group("voltage")),
    }


def _resolve_columns(header_columns: list[str], wanted: list[str]) -> dict[str, str]:
    resolved = {}
    for canonical in wanted:
        aliases = COLUMN_ALIASES.get(canonical, [canonical])
        found = next((a for a in aliases if a in header_columns), None)
        if found is None:
            raise KeyError(f"None of {aliases} present in header: {header_columns}")
        resolved[canonical] = found
    return resolved


def load_sensor_reading(
    path: Path, columns: list[str] | None = None, nrows: int | None = None
) -> SensorReading:
    meta = parse_filename(path)
    wanted = columns or ["Raw_ADC"]

    header_columns = list(pd.read_csv(path, nrows=0).columns)
    resolved = _resolve_columns(header_columns, wanted)

    df = pd.read_csv(
        path,
        usecols=list(resolved.values()),
        dtype={resolved.get("Raw_ADC", "Raw_ADC"): "int32"} if "Raw_ADC" in resolved else None,
        nrows=nrows,
    )
    df = df.rename(columns={raw: canonical for canonical, raw in resolved.items()})
    df = df[wanted]

    return SensorReading(
        sensor_id=meta["sensor_id"],
        variant=meta["variant"],
        temperature_c=meta["temperature_c"],
        voltage_v=meta["voltage_v"],
        source_path=path,
        data=df,
    )


def load_all(
    data_dir: Path, columns: list[str] | None = None, nrows: int | None = None
) -> Iterator[SensorReading]:
    for path in discover_csv_files(data_dir):
        yield load_sensor_reading(path, columns=columns, nrows=nrows)
