"""Streamlit UI: pick a sensor/condition CSV, run the pipeline, view and export results."""

import pandas as pd
import streamlit as st

import main
from modules import data_loader, report_export

st.set_page_config(page_title="LM35 TRNG Analysis", layout="wide")
st.title("LM35 TRNG Analysis")

if "results" not in st.session_state:
    st.session_state.results = {}  # str(path) -> PipelineResult

files = data_loader.discover_csv_files(main.DATA_DIR)
if not files:
    st.error(f"No CSV files found under {main.DATA_DIR}")
    st.stop()


def label_for(path):
    meta = data_loader.parse_filename(path)
    return f"{meta['sensor_id']} ({meta['variant']}) — {meta['temperature_c']}°C @ {meta['voltage_v']}V"


file_labels = {label_for(f): f for f in files}
selected_label = st.selectbox("Sensor / condition", list(file_labels.keys()))
selected_path = file_labels[selected_label]

btn_col1, btn_col2 = st.columns(2)
run_single = btn_col1.button("Run selected")
run_all = btn_col2.button(f"Run all ({len(files)} files)")

if run_single:
    with st.spinner(f"Processing {selected_path.name}..."):
        reading = data_loader.load_sensor_reading(selected_path, columns=["Raw_ADC"])
        st.session_state.results[str(selected_path)] = main.process_one(reading)
    st.success("Done")

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
    st.info("Run a sensor/condition above to see results here.")
    st.stop()

st.subheader("Results summary")
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

if str(selected_path) in st.session_state.results:
    st.subheader(f"Detail: {selected_label}")
    r = st.session_state.results[str(selected_path)]

    m1, m2, m3 = st.columns(3)
    m1.metric("Min-Entropy (bits/bit)", f"{r.min_entropy.min_entropy_per_bit:.4f}")
    m2.metric("VN Retention Rate", f"{r.debias.retention_rate:.4f}")
    m3.metric("SP 800-22 Pass Rate", f"{r.sp800_22_pass_rate:.4f}")

    with st.expander("SP 800-90B estimator breakdown"):
        est_df = pd.DataFrame(
            [
                {"Estimator": name, **{k: v for k, v in tc.items() if k != "testCaseDesc"}}
                for name, tc in r.min_entropy.estimator_results.items()
            ]
        )
        st.dataframe(est_df, width="stretch")

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

st.subheader("LaTeX export")
if st.button("Generate LaTeX tables"):
    main.RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    report_export.min_entropy_table(results_list, main.RESULTS_DIR / "rq3_min_entropy.tex")
    report_export.von_neumann_table(results_list, main.RESULTS_DIR / "rq4_von_neumann.tex")
    report_export.sp800_22_table(
        results_list, main.AYYADA_SP800_22_REFERENCE, main.RESULTS_DIR / "rq5_sp800_22.tex"
    )
    report_export.appendix_table(results_list, main.RESULTS_DIR / "appendix_full.tex")
    st.success(f"Tables written to {main.RESULTS_DIR}")

for name in ["rq3_min_entropy.tex", "rq4_von_neumann.tex", "rq5_sp800_22.tex", "appendix_full.tex"]:
    path = main.RESULTS_DIR / name
    if path.is_file():
        st.download_button(f"Download {name}", path.read_text(), file_name=name)
