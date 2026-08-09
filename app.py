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
    st.session_state.results = {}  # str(path) -> PipelineResult

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

with st.container(border=True):
    st.markdown("##### Select sensor & condition")
    c1, c2, c3, c4 = st.columns(4)
    with c1:
        variant = st.segmented_control("Group", ["A", "B", "C"], default="A", required=True)
    with c2:
        number_str = st.text_input("Sensor number", value="1", help="Numeric ID within the group, e.g. 1")
    with c3:
        temp = st.segmented_control("Temperature (°C)", TEMPS, default=0, required=True)
    with c4:
        voltage = st.segmented_control("Voltage (V)", VOLTAGES, default=3.3, required=True)

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

    btn_col1, btn_col2 = st.columns(2)
    run_single = btn_col1.button(
        "Run selected", type="primary", disabled=selected_path is None, use_container_width=True
    )
    run_all = btn_col2.button(f"Run all ({len(files)} files)", use_container_width=True)

if run_single and selected_path is not None:
    with st.spinner(f"Processing {selected_path.name}..."):
        reading = data_loader.load_sensor_reading(selected_path, columns=["Raw_ADC"])
        st.session_state.results[str(selected_path)] = main.process_one(reading)
    st.toast("Done", icon="✅")

if run_all:
    progress = st.progress(0.0)
    status = st.empty()
    for i, f in enumerate(files, start=1):
        status.text(f"[{i}/{len(files)}] {f.name}")
        reading = data_loader.load_sensor_reading(f, columns=["Raw_ADC"])
        st.session_state.results[str(f)] = main.process_one(reading)
        progress.progress(i / len(files))
    status.text(f"Done — {len(files)} files processed")

results_list = list(st.session_state.results.values())

if not results_list:
    st.info("Select a sensor and condition above, then run it to see results here.")
    st.stop()

st.markdown("### Results")

st.markdown("##### Summary")
summary_df = pd.DataFrame(
    [
        {
            "Sensor": r.sensor_id,
            "Variant": r.variant,
            "Temp (C)": r.temperature_c,
            "Voltage (V)": r.voltage_v,
            "Min-Entropy (bits/bit)": r.min_entropy.min_entropy_per_bit,
            "VN Retention Rate": r.debias.retention_rate,
            "Post-VN One Fraction": r.post_debias_one_fraction,
            "SP 800-22 Pass Rate": r.sp800_22_pass_rate,
        }
        for r in results_list
    ]
)
st.dataframe(summary_df, width="stretch")

if selected_path is not None and str(selected_path) in st.session_state.results:
    r = st.session_state.results[str(selected_path)]
    st.markdown(f"##### Detail: {r.sensor_id} ({r.variant}) — {r.temperature_c}°C @ {r.voltage_v}V")

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
    "Saves this session's results into docs/data/ (the dashboard's data source) and "
    "results/*.tex (LaTeX for the thesis), merged with whatever's already there — running "
    "sensors one at a time across separate sessions accumulates into the same permanent "
    "record instead of overwriting it."
)
if st.button("Save results", type="primary"):
    main.RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    main.DOCS_DATA_DIR.mkdir(parents=True, exist_ok=True)
    report_export.min_entropy_table(results_list, main.RESULTS_DIR / "rq3_min_entropy.tex")
    report_export.von_neumann_table(results_list, main.RESULTS_DIR / "rq4_von_neumann.tex")
    report_export.sp800_22_table(
        results_list, main.AYYADA_SP800_22_REFERENCE, main.RESULTS_DIR / "rq5_sp800_22.tex"
    )
    report_export.appendix_table(results_list, main.RESULTS_DIR / "appendix_full.tex")
    combined_summary = report_export.summary_csv(results_list, main.DOCS_DATA_DIR / "summary.csv")
    report_export.full_detail_json(results_list, main.DOCS_DATA_DIR / "full_details.json")
    st.success(f"Saved. {len(combined_summary)} conditions on record ({main.RESULTS_DIR} + {main.DOCS_DATA_DIR})")

tex_names = ["rq3_min_entropy.tex", "rq4_von_neumann.tex", "rq5_sp800_22.tex", "appendix_full.tex"]
data_names = ["summary.csv", "full_details.json"]
export_cols = st.columns(3)
for i, name in enumerate(tex_names):
    path = main.RESULTS_DIR / name
    if path.is_file():
        export_cols[i % 3].download_button(
            f"Download {name}", path.read_text(), file_name=name, use_container_width=True
        )
for i, name in enumerate(data_names):
    path = main.DOCS_DATA_DIR / name
    if path.is_file():
        export_cols[(i + len(tex_names)) % 3].download_button(
            f"Download {name}", path.read_text(), file_name=name, use_container_width=True
        )
