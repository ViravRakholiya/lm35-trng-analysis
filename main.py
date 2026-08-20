"""Orchestrates the LM35 TRNG analysis pipeline: load -> bit extract -> Von Neumann -> NIST 90B/22 -> report."""

from pathlib import Path

from modules import data_loader, lsb_extraction, nist_22, nist_90b, report_export, von_neumann
from modules.report_export import PipelineResult

DATA_DIR = Path(__file__).parent / "data"
RESULTS_DIR = Path(__file__).parent / "results"
DOCS_DATA_DIR = Path(__file__).parent / "docs" / "data"

NUM_LSB_BITS = 1
# (stream_length, minimum_streams) tried in priority order (longest first).
# Maurer's Universal test needs stream_length >= 387_840 to set its internal
# block length L >= 6 -- below that the STS reference implementation aborts
# the test per-stream without recording a p-value, and the report generator
# then reads the empty slot as p=0.0 (an automatic failure, every stream,
# every file). Our post-VN streams are ~2.5M bits, so 10 streams at
# >=387_840 bits/stream would need ~3.9M bits -- more than we have -- so the
# 400_000 tier accepts 6 streams (the most that fit) in exchange for
# Universal actually running instead of auto-failing.
STS_STREAM_LENGTH_CANDIDATES: list[tuple[int, int]] = [
    (1_000_000, 10),
    (400_000, 6),
    (100_000, 10),
    (10_000, 10),
]
STS_MAX_STREAMS = 100

# Mean SP 800-22 pass rate per variant (post-Von Neumann, matching what this
# pipeline measures), extracted from Ayyada's thesis Tables 6.5-6.7. See
# reference/ayyada_thesis_results.csv for the full per-sensor/voltage
# breakdown and reference/README.md for provenance/methodology notes.
AYYADA_SP800_22_REFERENCE: dict[str, float] = {"A": 0.9379, "B": 0.9690, "C": 0.9459}


def _choose_sts_params(available_bits: int) -> tuple[int, int] | None:
    for length, min_streams in STS_STREAM_LENGTH_CANDIDATES:
        streams = available_bits // length
        if streams >= min_streams:
            return length, min(streams, STS_MAX_STREAMS)
    return None


def process_one(reading: data_loader.SensorReading, num_lsb_bits: int = NUM_LSB_BITS) -> PipelineResult:
    raw = reading.data["Raw_ADC"].to_numpy()
    symbols = lsb_extraction.extract_lsb_group(raw, num_lsb_bits)

    # Raw min-entropy is assessed per combined num_lsb_bits-wide symbol (the
    # actual "k LSBs together" random variable), not per individual bit.
    min_entropy = nist_90b.estimate_min_entropy(symbols, bits_per_symbol=num_lsb_bits)

    bit_stream = lsb_extraction.unpack_bits(symbols, num_lsb_bits)
    debias = von_neumann.von_neumann_debias(bit_stream)
    # Von Neumann and its conditioned min-entropy always operate on the
    # unpacked single-bit stream, regardless of num_lsb_bits.
    vn_min_entropy = nist_90b.estimate_conditioned_min_entropy(debias.output_bits, bits_per_symbol=1)

    sts_params = _choose_sts_params(debias.output_bit_count)
    if sts_params is None:
        smallest_length, smallest_min_streams = STS_STREAM_LENGTH_CANDIDATES[-1]
        print(
            f"  WARNING: only {debias.output_bit_count} debiased bits available, "
            f"below the {smallest_min_streams}x{smallest_length} minimum "
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
        num_lsb_bits=num_lsb_bits,
    )


def run_pipeline(
    data_dir: Path = DATA_DIR,
    results_dir: Path = RESULTS_DIR,
    docs_data_dir: Path = DOCS_DATA_DIR,
    num_lsb_bits: int = NUM_LSB_BITS,
) -> list[PipelineResult]:
    """Runs every CSV under data_dir through the pipeline for a given number of
    combined LSBs and writes its outputs into an lsb{N}/ subfolder of
    results_dir and docs_data_dir, so results for different LSB counts never
    collide and can be compared side by side (switch the dashboard's LSB-count
    toggle to view each, or use compare.html to see all four at once)."""
    files = data_loader.discover_csv_files(data_dir)
    results = []

    for i, path in enumerate(files, start=1):
        print(f"[{i}/{len(files)}] {path.relative_to(data_dir)}")
        reading = data_loader.load_sensor_reading(path, columns=["Raw_ADC"])
        results.append(process_one(reading, num_lsb_bits=num_lsb_bits))

    lsb_results_dir = results_dir / f"lsb{num_lsb_bits}"
    lsb_docs_data_dir = docs_data_dir / f"lsb{num_lsb_bits}"

    print("\nWriting report tables...")
    report_export.min_entropy_table(results, lsb_results_dir / "rq3_min_entropy.tex")
    report_export.von_neumann_table(results, lsb_results_dir / "rq4_von_neumann.tex")
    report_export.sp800_22_table(results, AYYADA_SP800_22_REFERENCE, lsb_results_dir / "rq5_sp800_22.tex")
    report_export.appendix_table(results, lsb_results_dir / "appendix_full.tex")
    report_export.summary_csv(results, lsb_docs_data_dir / "summary.csv")
    report_export.full_detail_json(results, lsb_docs_data_dir / "full_details.json")
    print(f"Done. {len(results)} conditions processed. LaTeX in {lsb_results_dir}, dashboard data in {lsb_docs_data_dir}")

    return results


if __name__ == "__main__":
    run_pipeline()
