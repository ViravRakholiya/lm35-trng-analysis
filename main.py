"""Orchestrates the LM35 TRNG analysis pipeline: load -> LSB extract -> Von Neumann -> NIST 90B/22 -> report."""

from pathlib import Path

from modules import data_loader, lsb_extraction, nist_22, nist_90b, report_export, von_neumann
from modules.report_export import PipelineResult

DATA_DIR = Path(__file__).parent / "data"
RESULTS_DIR = Path(__file__).parent / "results"
DOCS_DATA_DIR = Path(__file__).parent / "docs" / "data"

LSB_BITS = 1
STS_STREAM_LENGTH_CANDIDATES = [1_000_000, 100_000, 10_000]
STS_MIN_STREAMS = 10
STS_MAX_STREAMS = 100

# Mean SP 800-22 pass rate per variant (post-Von Neumann, matching what this
# pipeline measures), extracted from Ayyada's thesis Tables 6.5-6.7. See
# reference/ayyada_thesis_results.csv for the full per-sensor/voltage
# breakdown and reference/README.md for provenance/methodology notes.
AYYADA_SP800_22_REFERENCE: dict[str, float] = {"A": 0.9379, "B": 0.9690, "C": 0.9459}


def _choose_sts_params(available_bits: int) -> tuple[int, int] | None:
    for length in STS_STREAM_LENGTH_CANDIDATES:
        streams = available_bits // length
        if streams >= STS_MIN_STREAMS:
            return length, min(streams, STS_MAX_STREAMS)
    return None


def process_one(reading: data_loader.SensorReading) -> PipelineResult:
    raw = reading.data["Raw_ADC"].to_numpy()
    lsb_bits = lsb_extraction.extract_lsb_bitstream(raw, LSB_BITS)

    min_entropy = nist_90b.estimate_min_entropy(lsb_bits, bits_per_symbol=LSB_BITS)
    debias = von_neumann.von_neumann_debias(lsb_bits)
    # Von Neumann always outputs individual bits regardless of LSB_BITS, so
    # the conditioned-mode assessment is always bits_per_symbol=1.
    vn_min_entropy = nist_90b.estimate_conditioned_min_entropy(debias.output_bits, bits_per_symbol=1)

    sts_params = _choose_sts_params(debias.output_bit_count)
    if sts_params is None:
        print(
            f"  WARNING: only {debias.output_bit_count} debiased bits available, "
            f"below the {STS_MIN_STREAMS}x{STS_STREAM_LENGTH_CANDIDATES[-1]} minimum "
            "for SP 800-22; skipping that test for this file."
        )
        sp800_22_results = []
    else:
        stream_length, num_bitstreams = sts_params
        sp800_22_results = nist_22.run_test_suite(debias.output_bits, stream_length, num_bitstreams)

    return PipelineResult(
        sensor_id=reading.sensor_id,
        variant=reading.variant,
        temperature_c=reading.temperature_c,
        voltage_v=reading.voltage_v,
        min_entropy=min_entropy,
        debias=debias,
        sp800_22_results=sp800_22_results,
        vn_min_entropy=vn_min_entropy,
    )


def run_pipeline(data_dir: Path = DATA_DIR, results_dir: Path = RESULTS_DIR) -> list[PipelineResult]:
    files = data_loader.discover_csv_files(data_dir)
    results = []

    for i, path in enumerate(files, start=1):
        print(f"[{i}/{len(files)}] {path.relative_to(data_dir)}")
        reading = data_loader.load_sensor_reading(path, columns=["Raw_ADC"])
        results.append(process_one(reading))

    print("\nWriting report tables...")
    report_export.min_entropy_table(results, results_dir / "rq3_min_entropy.tex")
    report_export.von_neumann_table(results, results_dir / "rq4_von_neumann.tex")
    report_export.sp800_22_table(results, AYYADA_SP800_22_REFERENCE, results_dir / "rq5_sp800_22.tex")
    report_export.appendix_table(results, results_dir / "appendix_full.tex")
    report_export.summary_csv(results, DOCS_DATA_DIR / "summary.csv")
    report_export.full_detail_json(results, DOCS_DATA_DIR / "full_details.json")
    print(f"Done. {len(results)} conditions processed. LaTeX in {results_dir}, dashboard data in {DOCS_DATA_DIR}")

    return results


if __name__ == "__main__":
    run_pipeline()
