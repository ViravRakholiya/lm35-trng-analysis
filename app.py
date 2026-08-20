"""Streamlit UI: pick a sensor/condition, run the pipeline, view and export results."""

import pandas as pd
import streamlit as st

import main
from modules import data_loader, report_export

st.set_page_config(page_title="LM35 TRNG Analysis", layout="wide", page_icon="🌡️")

# ---------------------------------------------------------------------------
# Styling — a light, professional palette layered on top of Streamlit's
# defaults via well-established, stable selectors (button, metric, container).
# ---------------------------------------------------------------------------
st.markdown(
    """
    <style>
    h1, h2, h3 { letter-spacing: -0.01em; }

    .app-header {
        padding: 1.75rem 2rem;
        margin: -1rem -1rem 1.5rem -1rem;
        background: linear-gradient(135deg, #0b0b0b 0%, #262625 100%);
        border-radius: 0 0 16px 16px;
    }
    .app-header h1 { color: #ffffff; margin: 0; font-size: 1.9rem; }
    .app-header p { color: #c3c2b7; margin: 0.35rem 0 0 0; font-size: 0.95rem; }

    div[data-testid="stVerticalBlockBorderWrapper"] {
        border-radius: 12px;
    }

    .stButton > button {
        border-radius: 8px;
        font-weight: 500;
        padding: 0.5rem 1rem;
    }

    div[data-testid="stMetric"] {
        background: #fcfcfb;
        border: 1px solid rgba(11,11,11,0.08);
        border-radius: 10px;
        padding: 0.75rem 1rem;
    }
    div[data-testid="stMetricValue"] { font-weight: 600; }

    div[data-baseweb="segmented-control"] { gap: 0.25rem; }
    </style>
    <div class="app-header">
        <h1>LM35 TRNG Analysis</h1>
        <p>ADS1115 (16-bit ADC) entropy pipeline — SP 800-90B min-entropy, Von Neumann debiasing, SP 800-22</p>
    </div>
    """,
    unsafe_allow_html=True,
)

if "results" not in st.session_state:
    st.session_state.results = {}  # (str(path), num_lsb_bits) -> PipelineResult

files = data_loader.discover_csv_files(main.DATA_DIR)
if not files:
    st.error(f"No CSV files found under {main.DATA_DIR}")
    st.stop()

# ---------------------------------------------------------------------------
# Index available data: (variant, number, temp, voltage) -> path, plus what's
# actually available per sensor, so the selector can validate against reality
# instead of assuming the full 3x2 condition matrix exists for every sensor.
# ---------------------------------------------------------------------------
file_index = {}
sensors_by_variant: dict[str, set[int]] = {}
conditions_by_sensor: dict[tuple[str, int], list[tuple[int, float]]] = {}

for f in files:
    meta = data_loader.parse_filename(f)
    variant = meta["variant"]
    number = int(meta["sensor_id"][len(variant) :])
    temp, voltage = meta["temperature_c"], meta["voltage_v"]

    file_index[(variant, number, temp, voltage)] = f
    sensors_by_variant.setdefault(variant, set()).add(number)
    conditions_by_sensor.setdefault((variant, number), []).append((temp, voltage))

TEMPS = [0, 24, 40]
VOLTAGES = [3.3, 5.0]


def _saved_keys(num_lsb_bits: int) -> set[tuple[str, int, float]]:
    """(sensor, temp, voltage) keys already saved to docs/data/lsb{N}/summary.csv
    for this LSB count -- i.e. already processed and persisted by a prior
    "Save results" click, possibly in an earlier session."""
    summary_path = main.DOCS_DATA_DIR / f"lsb{num_lsb_bits}" / "summary.csv"
    if not summary_path.is_file():
        return set()
    df = pd.read_csv(summary_path)
    return {(str(s), int(t), float(v)) for s, t, v in zip(df["Sensor"], df["Temp (C)"], df["Voltage (V)"])}

with st.container(border=True):
    st.markdown("##### Select sensor & condition")
    c1, c2, c3, c4, c5 = st.columns(5)
    with c1:
        variant = st.segmented_control("Group", ["A", "B", "C"], default="A", required=True)
    with c2:
        number_str = st.text_input("Sensor number", value="1", help="Numeric ID within the group, e.g. 1")
    with c3:
        temp = st.segmented_control("Temperature (°C)", TEMPS, default=0, required=True)
    with c4:
        voltage = st.segmented_control("Voltage (V)", VOLTAGES, default=3.3, required=True)
    with c5:
        num_lsb_bits = st.segmented_control(
            "LSBs used",
            [1, 2, 3, 4],
            default=1,
            required=True,
            help="How many combined least-significant ADC bits to analyze (e.g. 3 = the 3 LSBs "
            "taken together as one 3-bit value per sample, 0-7). Each setting is treated as its own "
            "independent bitstream, and each setting's results are saved and viewed separately, so "
            "you can run and compare all four LSB counts' entropy independently.",
        )

    selected_path = None
    number_stripped = number_str.strip()

    if not number_stripped:
        st.error("Enter a sensor number.")
    elif not number_stripped.isdigit():
        st.error(f"'{number_str}' isn't a valid sensor number — enter digits only, e.g. 1.")
    else:
        number = int(number_stripped)
        available_numbers = sorted(sensors_by_variant.get(variant, []))
        if number not in available_numbers:
            avail = ", ".join(str(n) for n in available_numbers) or "none"
            st.error(f"No data for sensor {variant}{number}. Available in group {variant}: {avail}")
        else:
            key = (variant, number, temp, voltage)
            if key in file_index:
                selected_path = file_index[key]
                st.success(f"Selected **{variant}{number}** — {temp}°C @ {voltage}V")
            else:
                available = sorted(conditions_by_sensor[(variant, number)])
                cond_str = ", ".join(f"{t}°C/{v}V" for t, v in available)
                st.error(
                    f"No data for {variant}{number} at {temp}°C / {voltage}V. "
                    f"Available for {variant}{number}: {cond_str}"
                )

    already_saved = _saved_keys(num_lsb_bits)
    already_in_session = {
        (r.sensor_id, r.temperature_c, r.voltage_v)
        for (path_str, n), r in st.session_state.results.items()
        if n == num_lsb_bits
    }
    done_keys = already_saved | already_in_session
    remaining_files = [
        f
        for f in files
        if (
            (m := data_loader.parse_filename(f))["sensor_id"],
            m["temperature_c"],
            m["voltage_v"],
        )
        not in done_keys
    ]

    btn_col1, btn_col2, btn_col3 = st.columns(3)
    run_single = btn_col1.button(
        "Run selected", type="primary", disabled=selected_path is None, use_container_width=True
    )
    run_all = btn_col2.button(f"Run all ({len(files)} files)", use_container_width=True)
    run_remaining = btn_col3.button(
        f"Run remaining ({len(remaining_files)} files)" if remaining_files else "All files processed",
        disabled=not remaining_files,
        use_container_width=True,
    )
    st.caption(
        f"\"Remaining\" = files not yet saved to `docs/data/lsb{num_lsb_bits}/summary.csv` and not "
        "already run this session, for the selected LSB count — the way to pick up newly added "
        "sensor data without reprocessing everything you already saved."
    )

if run_single and selected_path is not None:
    with st.spinner(f"Processing {selected_path.name} ({num_lsb_bits} LSB{'s' if num_lsb_bits != 1 else ''})..."):
        reading = data_loader.load_sensor_reading(selected_path, columns=["Raw_ADC"])
        st.session_state.results[(str(selected_path), num_lsb_bits)] = main.process_one(
            reading, num_lsb_bits=num_lsb_bits
        )
    st.toast("Done", icon="✅")

if run_all:
    progress = st.progress(0.0)
    status = st.empty()
    for i, f in enumerate(files, start=1):
        status.text(f"[{i}/{len(files)}] {f.name} ({num_lsb_bits} LSBs)")
        reading = data_loader.load_sensor_reading(f, columns=["Raw_ADC"])
        st.session_state.results[(str(f), num_lsb_bits)] = main.process_one(reading, num_lsb_bits=num_lsb_bits)
        progress.progress(i / len(files))
    status.text(f"Done — {len(files)} files processed ({num_lsb_bits} LSBs)")

if run_remaining and remaining_files:
    progress = st.progress(0.0)
    status = st.empty()
    for i, f in enumerate(remaining_files, start=1):
        status.text(f"[{i}/{len(remaining_files)}] {f.name} ({num_lsb_bits} LSBs)")
        reading = data_loader.load_sensor_reading(f, columns=["Raw_ADC"])
        st.session_state.results[(str(f), num_lsb_bits)] = main.process_one(reading, num_lsb_bits=num_lsb_bits)
        progress.progress(i / len(remaining_files))
    status.text(f"Done — {len(remaining_files)} new files processed ({num_lsb_bits} LSBs)")

results_list = list(st.session_state.results.values())

if not results_list:
    st.info("Select a sensor and condition above, then run it to see results here.")
    st.stop()

st.markdown("### Results")

st.markdown("##### Summary")
st.caption("Each row also carries its LSB count, so results from different LSB counts sit side by side here.")
summary_df = pd.DataFrame(
    [
        {
            "Sensor": r.sensor_id,
            "Variant": r.variant,
            "Temp (C)": r.temperature_c,
            "Voltage (V)": r.voltage_v,
            "LSBs Used": r.num_lsb_bits,
            "Min-Entropy (bits/bit)": r.min_entropy.min_entropy_per_bit,
            "VN Retention Rate": r.debias.retention_rate,
            "Post-VN One Fraction": r.post_debias_one_fraction,
            "SP 800-22 Pass Rate": r.sp800_22_pass_rate,
        }
        for r in results_list
    ]
)
st.dataframe(summary_df, width="stretch")

detail_key = (str(selected_path), num_lsb_bits) if selected_path is not None else None
if detail_key is not None and detail_key in st.session_state.results:
    r = st.session_state.results[detail_key]
    st.markdown(
        f"##### Detail: {r.sensor_id} ({r.variant}) — {r.temperature_c}°C @ {r.voltage_v}V, {r.num_lsb_bits} LSB{'s' if r.num_lsb_bits != 1 else ''}"
    )

    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Raw Min-Entropy (bits/bit)", f"{r.min_entropy.min_entropy_per_bit:.4f}")
    m2.metric("VN Min-Entropy (bits/bit)", f"{r.vn_min_entropy.min_entropy_per_bit:.4f}" if r.vn_min_entropy else "—")
    m3.metric("VN Retention Rate", f"{r.debias.retention_rate:.4f}")
    m4.metric("SP 800-22 Pass Rate", f"{r.sp800_22_pass_rate:.4f}")

    with st.expander("SP 800-90B estimator breakdown (raw)"):
        est_df = pd.DataFrame(
            [
                {"Estimator": name, **{k: v for k, v in tc.items() if k != "testCaseDesc"}}
                for name, tc in r.min_entropy.estimator_results.items()
            ]
        )
        st.dataframe(est_df, width="stretch")

    if r.vn_min_entropy:
        with st.expander("SP 800-90B estimator breakdown (VN-processed)"):
            vn_est_df = pd.DataFrame(
                [
                    {"Estimator": name, **{k: v for k, v in tc.items() if k != "testCaseDesc"}}
                    for name, tc in r.vn_min_entropy.estimator_results.items()
                ]
            )
            st.dataframe(vn_est_df, width="stretch")

    with st.expander("SP 800-22 sub-test results"):
        sub_df = pd.DataFrame(
            [
                {
                    "Test": t.test_name,
                    "Uniformity p-value": t.uniformity_p_value,
                    "Passed": f"{t.num_passed}/{t.num_total}",
                    "OK": t.passed,
                }
                for t in r.sp800_22_results
            ]
        )
        st.dataframe(sub_df, width="stretch")

st.markdown("##### Export & save results")
st.caption(
    "Saves this session's results into docs/data/lsb{N}/ (the dashboard's data source) and "
    "results/lsb{N}/*.tex (LaTeX for the thesis) — one folder per LSB count, so the four "
    "counts never overwrite each other and the dashboard's LSB-count toggle can switch "
    "between them. Merged with whatever's already in each folder — running sensors one at a "
    "time across separate sessions accumulates into the same permanent record instead of "
    "overwriting it."
)
if st.button("Save results", type="primary"):
    by_lsb: dict[int, list] = {}
    for r in results_list:
        by_lsb.setdefault(r.num_lsb_bits, []).append(r)

    saved_summary = {}
    for n, bucket in by_lsb.items():
        lsb_results_dir = main.RESULTS_DIR / f"lsb{n}"
        lsb_docs_data_dir = main.DOCS_DATA_DIR / f"lsb{n}"
        lsb_results_dir.mkdir(parents=True, exist_ok=True)
        lsb_docs_data_dir.mkdir(parents=True, exist_ok=True)
        report_export.min_entropy_table(bucket, lsb_results_dir / "rq3_min_entropy.tex")
        report_export.von_neumann_table(bucket, lsb_results_dir / "rq4_von_neumann.tex")
        report_export.sp800_22_table(bucket, main.AYYADA_SP800_22_REFERENCE, lsb_results_dir / "rq5_sp800_22.tex")
        report_export.appendix_table(bucket, lsb_results_dir / "appendix_full.tex")
        combined_summary = report_export.summary_csv(bucket, lsb_docs_data_dir / "summary.csv")
        report_export.full_detail_json(bucket, lsb_docs_data_dir / "full_details.json")
        saved_summary[n] = len(combined_summary)

    summary_str = ", ".join(f"{n} LSB(s): {count} conditions" for n, count in sorted(saved_summary.items()))
    st.success(f"Saved. {summary_str} ({main.RESULTS_DIR}/lsb* + {main.DOCS_DATA_DIR}/lsb*)")

tex_names = ["rq3_min_entropy.tex", "rq4_von_neumann.tex", "rq5_sp800_22.tex", "appendix_full.tex"]
data_names = ["summary.csv", "full_details.json"]
present_lsb_dirs = sorted(
    {d.name for d in main.DOCS_DATA_DIR.glob("lsb*") if d.is_dir()}
    | {d.name for d in main.RESULTS_DIR.glob("lsb*") if d.is_dir()}
)
for lsb_dir_name in present_lsb_dirs:
    st.caption(f"**{lsb_dir_name}**")
    export_cols = st.columns(3)
    col_i = 0
    for name in tex_names:
        path = main.RESULTS_DIR / lsb_dir_name / name
        if path.is_file():
            export_cols[col_i % 3].download_button(
                f"Download {name}",
                path.read_text(),
                file_name=name,
                use_container_width=True,
                key=f"dl-{lsb_dir_name}-{name}",
            )
            col_i += 1
    for name in data_names:
        path = main.DOCS_DATA_DIR / lsb_dir_name / name
        if path.is_file():
            export_cols[col_i % 3].download_button(
                f"Download {name}",
                path.read_text(),
                file_name=name,
                use_container_width=True,
                key=f"dl-{lsb_dir_name}-{name}",
            )
            col_i += 1
