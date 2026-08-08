"""NIST SP 800-22 statistical test suite on a debiased bitstream.

Wraps the official NIST reference tool (assess) installed as a sibling of
this project at Code/NIST-Statistical-Test-Suite/sts/assess. The tool is
interactive; this module drives it via a scripted stdin sequence and parses
its finalAnalysisReport.txt, using the tool's own "*" failure annotations
(rather than recomputing acceptable ranges) to judge pass/fail.
"""

import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

STS_DIR = Path(__file__).resolve().parents[2] / "NIST-Statistical-Test-Suite" / "sts"
ASSESS_PATH = STS_DIR / "assess"
REPORT_PATH = STS_DIR / "experiments" / "AlgorithmTesting" / "finalAnalysisReport.txt"

REPORT_ROW_PATTERN = re.compile(
    r"^\s*(?:\d+\s+){10}"
    r"(?P<pvalue>[\d.]+|-+)\s*(?P<pvalue_star>\*)?\s+"
    r"(?P<passed_n>\d+)/(?P<total_n>\d+)\s*(?P<prop_star>\*)?\s+"
    r"(?P<name>\S+)\s*$"
)


@dataclass
class TestResult:
    test_name: str
    uniformity_p_value: float | None
    num_passed: int
    num_total: int
    passed: bool


def _write_ascii_bitstream(bits: np.ndarray, path: Path) -> None:
    ascii_lookup = np.array([ord("0"), ord("1")], dtype=np.uint8)
    ascii_lookup[bits].tofile(path)


def _parse_report(report_text: str) -> list[TestResult]:
    results = []
    for line in report_text.splitlines():
        match = REPORT_ROW_PATTERN.match(line)
        if not match:
            continue
        pvalue_str = match.group("pvalue")
        results.append(
            TestResult(
                test_name=match.group("name"),
                uniformity_p_value=None if pvalue_str.strip("-") == "" else float(pvalue_str),
                num_passed=int(match.group("passed_n")),
                num_total=int(match.group("total_n")),
                passed=match.group("pvalue_star") is None and match.group("prop_star") is None,
            )
        )
    return results


def run_test_suite(
    bits: np.ndarray,
    stream_length: int,
    num_bitstreams: int,
    assess_path: Path = ASSESS_PATH,
    report_path: Path = REPORT_PATH,
) -> list[TestResult]:
    if not assess_path.is_file():
        raise FileNotFoundError(f"assess not found at {assess_path}. Build it with `make` in {STS_DIR}.")

    required_bits = stream_length * num_bitstreams
    bits = np.asarray(bits, dtype=np.uint8)
    if bits.size < required_bits:
        raise ValueError(
            f"Need {required_bits} bits ({num_bitstreams} streams x {stream_length}), got {bits.size}"
        )

    with tempfile.TemporaryDirectory() as tmpdir:
        bitstream_path = Path(tmpdir) / "bitstream.txt"
        _write_ascii_bitstream(bits, bitstream_path)

        stdin_script = f"0\n{bitstream_path}\n1\n0\n{num_bitstreams}\n0\n"
        proc = subprocess.run(
            [str(assess_path), str(stream_length)],
            input=stdin_script,
            capture_output=True,
            text=True,
            cwd=STS_DIR,
        )
        # assess exits with status 1 on normal completion (a quirk of the
        # upstream codebase), so success is judged by its own completion
        # message and the report file, not the process exit code.
        if "Statistical Testing Complete" not in proc.stdout or not report_path.is_file():
            raise RuntimeError(
                f"assess did not complete (exit {proc.returncode}).\nstdout: {proc.stdout}\nstderr: {proc.stderr}"
            )

        report_text = report_path.read_text()

    return _parse_report(report_text)
