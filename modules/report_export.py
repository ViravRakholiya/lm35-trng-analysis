"""Formats pipeline results as LaTeX tables for the thesis Results chapter and appendix.

RQ4 note: SP 800-90B min-entropy is only estimated on the raw (pre-debiasing)
bitstream by design (see modules/nist_90b.py), so "before/after" for Von
Neumann is reported as raw min-entropy + retention rate + post-debiasing bias
(proportion of ones, which should sit near 0.5) rather than a second min-entropy
estimate. SP 800-22 pass rate (RQ5) is the actual post-processing randomness signal.
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
    """RQ4: retention rate + raw entropy + post-debiasing bias check."""
    df = pd.DataFrame(
        [
            {
                "Sensor": r.sensor_id,
                "Variant": r.variant,
                "Temp (C)": r.temperature_c,
                "Voltage (V)": r.voltage_v,
                "Raw Min-Entropy (bits/bit)": r.min_entropy.min_entropy_per_bit,
                "VN Retention Rate": r.debias.retention_rate,
                "Post-VN One Fraction": r.post_debias_one_fraction,
            }
            for r in results
        ]
    ).sort_values(["Variant", "Sensor", "Temp (C)", "Voltage (V)"])
    return _write_latex(
        df,
        out_path,
        "Von Neumann debiasing retention rate and post-debiasing bias, alongside raw min-entropy.",
        "tab:von-neumann",
    )


def sp800_22_table(
    results: list[PipelineResult], ayyada_reference: dict[str, float] | None, out_path: Path
) -> str:
    """RQ5: SP 800-22 pass rates per sensor x condition, vs Ayyada's MCP3008 numbers.

    ayyada_reference maps variant ("A", "B", "C") to his published pass rate,
    since only summary-level published numbers (not granular per-sensor/condition
    data) are available for the baseline comparison.
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
                "Ayyada Pass Rate (MCP3008)": ayyada_reference.get(r.variant),
            }
            for r in results
        ]
    ).sort_values(["Variant", "Sensor", "Temp (C)", "Voltage (V)"])
    return _write_latex(
        df,
        out_path,
        "SP 800-22 pass rates per sensor and test condition, compared against Ayyada's published MCP3008 baseline.",
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
                "Min-Entropy (bits/bit)": r.min_entropy.min_entropy_per_bit,
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
        "min_entropy": {
            "min_entropy_per_bit": r.min_entropy.min_entropy_per_bit,
            "estimators": r.min_entropy.estimator_results,
        },
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
