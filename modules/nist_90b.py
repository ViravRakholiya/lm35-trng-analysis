"""NIST SP 800-90B min-entropy estimation, raw and conditioned (post-debiasing).

Wraps the official NIST reference tool (ea_non_iid) installed as a sibling of
this project at Code/SP800-90B_EntropyAssessment/cpp/ea_non_iid. The non-IID
track is used deliberately: LM35 thermal noise is a physical entropy source,
and per the tool's own README, "most commonly used entropy sources are not IID."
"""

import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

TOOL_PATH = Path(__file__).resolve().parents[2] / "SP800-90B_EntropyAssessment" / "cpp" / "ea_non_iid"


@dataclass
class MinEntropyResult:
    min_entropy_per_symbol: float
    bits_per_symbol: int
    estimator_results: dict

    @property
    def min_entropy_per_bit(self) -> float:
        """hAssessed is min-entropy per bits_per_symbol-wide symbol (SP 800-90B
        S3.1.3/S3.1.5.2); normalizing by bits_per_symbol makes this comparable
        across different symbol widths (e.g. raw k-LSB symbols vs. the always
        single-bit post-Von Neumann stream)."""
        return self.min_entropy_per_symbol / self.bits_per_symbol


def _run_ea_non_iid(
    bits: np.ndarray, mode_flag: str, bits_per_symbol: int, tool_path: Path
) -> MinEntropyResult:
    if not 1 <= bits_per_symbol <= 8:
        raise ValueError(f"bits_per_symbol must be between 1 and 8, got {bits_per_symbol}")
    if not tool_path.is_file():
        raise FileNotFoundError(
            f"ea_non_iid not found at {tool_path}. Build it with `make non_iid` "
            f"in {tool_path.parent}."
        )

    bits = np.asarray(bits, dtype=np.uint8)

    with tempfile.TemporaryDirectory() as tmpdir:
        symbol_path = Path(tmpdir) / "symbols.bin"
        json_path = Path(tmpdir) / "result.json"
        bits.tofile(symbol_path)

        proc = subprocess.run(
            [str(tool_path), mode_flag, "-o", str(json_path), str(symbol_path), str(bits_per_symbol)],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0 or not json_path.is_file():
            raise RuntimeError(
                f"ea_non_iid failed (exit {proc.returncode}).\nstdout: {proc.stdout}\nstderr: {proc.stderr}"
            )

        result = json.loads(json_path.read_text())

    test_cases = {tc["testCaseDesc"]: tc for tc in result["testCases"]}
    overall = test_cases.pop("Overall")

    return MinEntropyResult(
        min_entropy_per_symbol=overall["hAssessed"],
        bits_per_symbol=bits_per_symbol,
        estimator_results=test_cases,
    )


def estimate_min_entropy(
    bits: np.ndarray, bits_per_symbol: int = 1, tool_path: Path = TOOL_PATH
) -> MinEntropyResult:
    """Initial entropy estimate (-i) on a raw, unconditioned bitstream (SP 800-90B S3.1.3)."""
    return _run_ea_non_iid(bits, "-i", bits_per_symbol, tool_path)


def estimate_conditioned_min_entropy(
    bits: np.ndarray, bits_per_symbol: int = 1, tool_path: Path = TOOL_PATH
) -> MinEntropyResult:
    """Conditioned sequential dataset entropy estimate (-c) on a bitstream that has
    already been through a non-vetted conditioning function — here, Von Neumann
    debiasing (SP 800-90B S3.1.5.2). This is what RQ4's "after" min-entropy is."""
    return _run_ea_non_iid(bits, "-c", bits_per_symbol, tool_path)
