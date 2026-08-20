"""Formats pipeline results as LaTeX tables for the thesis Results chapter and appendix.

RQ4 note: min-entropy is estimated on both the raw (pre-debiasing) bitstream
(SP 800-90B initial estimate, -i) and the Von Neumann-processed bitstream
(SP 800-90B conditioned estimate, -c — see modules/nist_90b.py). VN retention
rate and post-debiasing bias (proportion of ones, which should sit near 0.5)
are reported alongside both, since they explain *why* the entropy changed the
way it did. SP 800-22 pass rate (RQ5) is a separate randomness-quality signal.
"""

import json
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from modules.nist_22 import TestResult
from modules.nist_90b import MinEntropyResult
from modules.von_neumann import DebiasResult


@dataclass
class PipelineResult:
    sensor_id: str
    variant: str
    temperature_c: int
    voltage_v: float
    min_entropy: MinEntropyResult
    debias: DebiasResult
    sp800_22_results: list[TestResult]
    vn_min_entropy: MinEntropyResult | None = None
    """Conditioned-mode (post-Von Neumann) min-entropy — None for results
    computed before this field existed; re-run the pipeline to populate it."""
    num_lsb_bits: int = 1
    """How many combined least-significant bits this record's bitstream was
    extracted from (see NUM_LSB_BITS in main.py). Stamped onto the record so
    a file is self-describing even if moved out of its lsb{N}/ output folder."""

    @property
    def sp800_22_pass_rate(self) -> float:
        if not self.sp800_22_results:
            return float("nan")
        return sum(1 for r in self.sp800_22_results if r.passed) / len(self.sp800_22_results)

    @property
    def post_debias_one_fraction(self) -> float | None:
        if self.debias.output_bit_count == 0:
            return None
        return float(self.debias.output_bits.mean())


def _write_latex(df: pd.DataFrame, out_path: Path, caption: str, label: str) -> str:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    latex = df.to_latex(index=False, float_format="%.4f", caption=caption, label=label)
    out_path.write_text(latex)
    return latex


def min_entropy_table(results: list[PipelineResult], out_path: Path) -> str:
    """RQ3: raw min-entropy per sensor x condition."""
    df = pd.DataFrame(
        [
            {
                "Sensor": r.sensor_id,
                "Variant": r.variant,
                "Temp (C)": r.temperature_c,
                "Voltage (V)": r.voltage_v,
                "Min-Entropy (bits/bit)": r.min_entropy.min_entropy_per_bit,
            }
            for r in results
        ]
    ).sort_values(["Variant", "Sensor", "Temp (C)", "Voltage (V)"])
    return _write_latex(
        df, out_path, "Raw min-entropy per sensor and test condition (SP 800-90B).", "tab:min-entropy"
    )


def von_neumann_table(results: list[PipelineResult], out_path: Path) -> str:
    """RQ4: min-entropy before and after Von Neumann debiasing, plus retention rate and bias check."""
    df = pd.DataFrame(
        [
            {
                "Sensor": r.sensor_id,
                "Variant": r.variant,
                "Temp (C)": r.temperature_c,
                "Voltage (V)": r.voltage_v,
                "Raw Min-Entropy (bits/bit)": r.min_entropy.min_entropy_per_bit,
                "VN Min-Entropy (bits/bit)": r.vn_min_entropy.min_entropy_per_bit if r.vn_min_entropy else None,
                "VN Retention Rate": r.debias.retention_rate,
                "Post-VN One Fraction": r.post_debias_one_fraction,
            }
            for r in results
        ]
    ).sort_values(["Variant", "Sensor", "Temp (C)", "Voltage (V)"])
    return _write_latex(
        df,
        out_path,
        "Min-entropy before and after Von Neumann debiasing, with retention rate and post-debiasing bias.",
        "tab:von-neumann",
    )


AYYADA_TEMPERATURE_C = 24
"""Ayyada's thesis states the climate chamber "was typically maintained at
approximately 24C during the measurements" for the entire TRNG dataset — his
numbers are single-temperature. Comparing them against our 0C/40C rows would
be misleading, so the reference column is only populated on our 24C rows."""


def sp800_22_table(
    results: list[PipelineResult], ayyada_reference: dict[str, float] | None, out_path: Path
) -> str:
    """RQ5: SP 800-22 pass rates per sensor x condition, vs Ayyada's MCP3008 numbers.

    ayyada_reference maps variant ("A", "B", "C") to his mean pass rate (see
    reference/ayyada_thesis_results.csv), shown only on our 24C rows since
    that's the only temperature his thesis tested (see AYYADA_TEMPERATURE_C).
    """
    ayyada_reference = ayyada_reference or {}
    df = pd.DataFrame(
        [
            {
                "Sensor": r.sensor_id,
                "Variant": r.variant,
                "Temp (C)": r.temperature_c,
                "Voltage (V)": r.voltage_v,
                "SP 800-22 Pass Rate": r.sp800_22_pass_rate,
                "Ayyada Pass Rate (MCP3008, 24C only)": (
                    ayyada_reference.get(r.variant) if r.temperature_c == AYYADA_TEMPERATURE_C else None
                ),
            }
            for r in results
        ]
    ).sort_values(["Variant", "Sensor", "Temp (C)", "Voltage (V)"])
    return _write_latex(
        df,
        out_path,
        "SP 800-22 pass rates per sensor and test condition, compared against Ayyada's "
        "published MCP3008 baseline (24C only, the only temperature in his thesis).",
        "tab:sp800-22",
    )


def _build_summary_dataframe(results: list[PipelineResult]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "Sensor": r.sensor_id,
                "Variant": r.variant,
                "Temp (C)": r.temperature_c,
                "Voltage (V)": r.voltage_v,
                "LSBs Used": r.num_lsb_bits,
                "Min-Entropy (bits/bit)": r.min_entropy.min_entropy_per_bit,
                "VN Min-Entropy (bits/bit)": r.vn_min_entropy.min_entropy_per_bit if r.vn_min_entropy else None,
                "VN Input Bits": r.debias.input_bit_count,
                "VN Output Bits": r.debias.output_bit_count,
                "VN Retention Rate": r.debias.retention_rate,
                "Post-VN One Fraction": r.post_debias_one_fraction,
                "SP 800-22 Sub-tests Passed": sum(1 for t in r.sp800_22_results if t.passed),
                "SP 800-22 Sub-tests Total": len(r.sp800_22_results),
                "SP 800-22 Pass Rate": r.sp800_22_pass_rate,
            }
            for r in results
        ]
    ).sort_values(["Variant", "Sensor", "Temp (C)", "Voltage (V)"])


def appendix_table(results: list[PipelineResult], out_path: Path) -> str:
    """Full granular per-sensor/per-condition data for the appendix."""
    df = _build_summary_dataframe(results)
    return _write_latex(
        df, out_path, "Full per-sensor, per-condition results.", "tab:appendix-full"
    )


_RESULT_KEY_COLUMNS = ["Sensor", "Temp (C)", "Voltage (V)"]


def summary_csv(results: list[PipelineResult], out_path: Path) -> pd.DataFrame:
    """Compact CSV of the same per-sensor/per-condition summary, for lightweight
    downstream consumers (e.g. a cloud results viewer) that shouldn't need the
    raw data or NIST tools to display results.

    Merges with whatever's already at out_path (keyed by sensor + condition) so
    results accumulate across separate runs — e.g. running sensors one at a time
    through the UI over several sessions — instead of each run overwriting the
    last."""
    new_df = _build_summary_dataframe(results)

    if out_path.is_file():
        existing_df = pd.read_csv(out_path)
        combined = pd.concat([existing_df, new_df], ignore_index=True)
        combined = combined.drop_duplicates(subset=_RESULT_KEY_COLUMNS, keep="last")
    else:
        combined = new_df

    combined = combined.sort_values(["Variant", "Sensor", "Temp (C)", "Voltage (V)"])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    combined.to_csv(out_path, index=False)
    return combined


def _result_to_detail_record(r: PipelineResult) -> dict:
    return {
        "sensor_id": r.sensor_id,
        "variant": r.variant,
        "temperature_c": r.temperature_c,
        "voltage_v": r.voltage_v,
        "num_lsb_bits": r.num_lsb_bits,
        "min_entropy": {
            "min_entropy_per_bit": r.min_entropy.min_entropy_per_bit,
            "min_entropy_per_symbol": r.min_entropy.min_entropy_per_symbol,
            "bits_per_symbol": r.min_entropy.bits_per_symbol,
            "estimators": r.min_entropy.estimator_results,
        },
        "vn_min_entropy": (
            {
                "min_entropy_per_bit": r.vn_min_entropy.min_entropy_per_bit,
                "estimators": r.vn_min_entropy.estimator_results,
            }
            if r.vn_min_entropy
            else None
        ),
        "debias": {
            "input_bit_count": r.debias.input_bit_count,
            "output_bit_count": r.debias.output_bit_count,
            "retention_rate": r.debias.retention_rate,
            "post_debias_one_fraction": r.post_debias_one_fraction,
        },
        "sp800_22": {
            "pass_rate": r.sp800_22_pass_rate,
            "sub_tests": [
                {
                    "test_name": t.test_name,
                    "uniformity_p_value": t.uniformity_p_value,
                    "num_passed": t.num_passed,
                    "num_total": t.num_total,
                    "passed": t.passed,
                }
                for t in r.sp800_22_results
            ],
        },
    }


def full_detail_json(results: list[PipelineResult], out_path: Path) -> list[dict]:
    """Complete per-condition detail — every SP 800-90B estimator sub-result and
    every SP 800-22 sub-test row, not just the aggregate numbers in summary_csv.
    This is the permanent record: what's shown live in the app disappears once
    the session ends, so this file is what a future session (or a professor
    looking at the deployed viewer) can actually drill into.

    Merges with whatever's already at out_path (same accumulate-don't-overwrite
    behavior as summary_csv, keyed by sensor + condition)."""
    new_records = [_result_to_detail_record(r) for r in results]

    existing_records = json.loads(out_path.read_text()) if out_path.is_file() else []

    merged = {(rec["sensor_id"], rec["temperature_c"], rec["voltage_v"]): rec for rec in existing_records}
    for rec in new_records:
        merged[(rec["sensor_id"], rec["temperature_c"], rec["voltage_v"])] = rec

    combined = sorted(
        merged.values(), key=lambda r: (r["variant"], r["sensor_id"], r["temperature_c"], r["voltage_v"])
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(combined, indent=2))
    return combined
