# LM35 TRNG Analysis

Analysis pipeline for the M.Sc. thesis *"Performance Analysis of LM35 Temperature
Sensors as a True Random Number Generator (TRNG)"* (University of Passau).

LM35 analog temperature sensors carry thermal noise beneath their deterministic
temperature reading. This project extracts that noise as an entropy source and
evaluates whether a 16-bit ADS1115 ADC captures more usable entropy than the
10-bit MCP3008 used in prior work (Ayyada, UPassau, March 2026).

## Setup

19 LM35 sensors across three variant groups, each sampled 10 million times per
condition on a Raspberry Pi + ADS1115:

| Variant | Package |
|---|---|
| A | LM35CZ (TO-92) |
| B | LM35 module SE039 |
| C | LM35 module SE030 |

Test matrix: 0°C / 24°C / 40°C × 3.3V / 5V (6 conditions per sensor).

## Pipeline

```
CSV (raw ADC + temperature)
  → LSB extraction        (modules/lsb_extraction.py)
  → Von Neumann debiasing  (modules/von_neumann.py)
  → SP 800-90B min-entropy (modules/nist_90b.py, on the raw bitstream)
  → SP 800-22 test suite   (modules/nist_22.py, on the debiased bitstream)
  → LaTeX / CSV export     (modules/report_export.py)
```

`modules/nist_90b.py` and `modules/nist_22.py` wrap NIST's official reference
tools ([`SP800-90B_EntropyAssessment`](https://github.com/usnistgov/SP800-90B_EntropyAssessment)
and [`NIST-Statistical-Test-Suite`](https://github.com/terrillmoore/NIST-Statistical-Test-Suite))
via subprocess. Those tools are **not part of this repo** — clone and build them
as sibling directories of this project (`../SP800-90B_EntropyAssessment`,
`../NIST-Statistical-Test-Suite`) before running the full pipeline locally.

## Repository layout

```
main.py              # CLI orchestrator: runs the full pipeline over data/
app.py                # Streamlit UI for the full pipeline (needs local data + NIST tools)
viewer_app.py           # Lightweight results viewer (only needs results/summary.csv)
modules/
  data_loader.py
  lsb_extraction.py
  von_neumann.py
  nist_90b.py
  nist_22.py
  report_export.py
data/                  # Raw sensor CSVs (gitignored — large, grows over time)
results/               # Generated tables; only summary.csv is committed
```

## Running it

```bash
pip install -r requirements.txt

# Full pipeline (needs data/ populated + NIST tools built as siblings)
python3 main.py

# Interactive UI for the full pipeline
streamlit run app.py

# Lightweight results viewer (works with just results/summary.csv)
streamlit run viewer_app.py
```

`data/` is not included in this repo — CSV files are large (~300MB each) and
grow as more sensors are added. `results/summary.csv` (the aggregate output of
`main.py`) is committed, which is what `viewer_app.py` reads; it can be deployed
for free on [Streamlit Community Cloud](https://share.streamlit.io) directly
from this repo without needing the raw data or NIST tools.

## Results (summary)

Across sensors collected so far: raw min-entropy ~0.90–0.91 bits/bit (SP
800-90B, non-IID track), ~25% bit retention after Von Neumann debiasing, and
~99% SP 800-22 sub-test pass rate post-debiasing. Full per-sensor/condition
data is in `results/summary.csv`.
