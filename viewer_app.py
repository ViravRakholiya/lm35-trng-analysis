"""Read-only results viewer for the LM35 TRNG pipeline.

Deployable to a free host (e.g. Streamlit Community Cloud): reads only the
small results/summary.csv and results/full_details.json committed to the
repo, never the raw sensor CSVs or the NIST reference tools, so it carries
none of the local pipeline's data-size or compiled-binary dependencies.
"""

import json
from pathlib import Path

import altair as alt
import pandas as pd
import streamlit as st

SUMMARY_PATH = Path(__file__).parent / "results" / "summary.csv"
DETAIL_PATH = Path(__file__).parent / "results" / "full_details.json"

# Fixed categorical order (blue / orange / aqua), never cycled — see
# thesis memory's dataviz conventions. Slots 1-3 of the validated default
# palette, chosen because they clear all-pairs CVD checks together.
VARIANT_COLORS = {"A": "#2a78d6", "B": "#eb6834", "C": "#1baf7a"}

st.set_page_config(page_title="LM35 TRNG Results", layout="wide", page_icon="🌡️")

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
    div[data-testid="stVerticalBlockBorderWrapper"] { border-radius: 12px; }
    div[data-testid="stMetric"] {
        background: #fcfcfb;
        border: 1px solid rgba(11,11,11,0.08);
        border-radius: 10px;
        padding: 0.75rem 1rem;
    }
    div[data-testid="stMetricValue"] { font-weight: 600; }
    </style>
    <div class="app-header">
        <h1>LM35 TRNG Analysis — Results</h1>
        <p>ADS1115 (16-bit ADC) entropy pipeline vs. Ayyada's MCP3008 (10-bit ADC) baseline</p>
    </div>
    """,
    unsafe_allow_html=True,
)

if not SUMMARY_PATH.is_file():
    st.error(
        f"No results found at {SUMMARY_PATH}. Run the pipeline (`python3 main.py`, or "
        "\"Save results\" in app.py) locally and push the generated results/ files."
    )
    st.stop()

df = pd.read_csv(SUMMARY_PATH)

variants_present = sorted(df["Variant"].unique())
color_scale = alt.Scale(domain=variants_present, range=[VARIANT_COLORS[v] for v in variants_present])

m1, m2, m3, m4 = st.columns(4)
m1.metric("Sensors", df["Sensor"].nunique())
m2.metric("Conditions", len(df))
m3.metric("Mean Min-Entropy (bits/bit)", f"{df['Min-Entropy (bits/bit)'].mean():.4f}")
m4.metric("Mean SP 800-22 Pass Rate", f"{df['SP 800-22 Pass Rate'].mean():.4f}")

st.subheader("Min-entropy by temperature and voltage (RQ3)")
entropy_chart = (
    alt.Chart(df)
    .mark_line(point=True, strokeWidth=2)
    .encode(
        x=alt.X("Temp (C):O", title="Temperature (°C)"),
        y=alt.Y(
            "Min-Entropy (bits/bit):Q", title="Min-Entropy (bits/bit)", scale=alt.Scale(zero=False)
        ),
        color=alt.Color("Variant:N", scale=color_scale, legend=alt.Legend(title="Variant")),
        detail="Sensor:N",
        column=alt.Column("Voltage (V):N", title="Voltage"),
        tooltip=["Sensor", "Variant", "Temp (C)", "Voltage (V)", "Min-Entropy (bits/bit)"],
    )
    .properties(width=280, height=320)
)
st.altair_chart(entropy_chart, use_container_width=False)

st.subheader("Von Neumann retention rate (RQ4)")
st.caption("Averaged across whatever conditions are on record per sensor.")
vn_chart = (
    alt.Chart(df)
    .mark_bar()
    .encode(
        x=alt.X("Sensor:N", title="Sensor", sort=None),
        y=alt.Y("mean(VN Retention Rate):Q", title="Mean VN Retention Rate"),
        color=alt.Color("Variant:N", scale=color_scale, legend=alt.Legend(title="Variant")),
        tooltip=[
            "Sensor",
            "Variant",
            alt.Tooltip("mean(VN Retention Rate):Q", title="Mean VN Retention Rate", format=".4f"),
        ],
    )
    .properties(height=320)
)
st.altair_chart(vn_chart, use_container_width=True)

st.subheader("SP 800-22 pass rate by sensor (RQ5)")
st.caption("Averaged across whatever conditions are on record per sensor.")
sts_chart = (
    alt.Chart(df)
    .mark_bar()
    .encode(
        x=alt.X("Sensor:N", title="Sensor", sort=None),
        y=alt.Y(
            "mean(SP 800-22 Pass Rate):Q",
            title="Mean SP 800-22 Pass Rate",
            scale=alt.Scale(domain=[0, 1]),
        ),
        color=alt.Color("Variant:N", scale=color_scale, legend=alt.Legend(title="Variant")),
        tooltip=[
            "Sensor",
            "Variant",
            alt.Tooltip("mean(SP 800-22 Pass Rate):Q", title="Mean SP 800-22 Pass Rate", format=".4f"),
        ],
    )
    .properties(height=320)
)
st.altair_chart(sts_chart, use_container_width=True)

st.subheader("Full results table")
st.dataframe(df, width="stretch")
st.download_button("Download summary.csv", SUMMARY_PATH.read_text(), file_name="summary.csv")

# ---------------------------------------------------------------------------
# Full detail — every SP 800-90B estimator and every SP 800-22 sub-test, per
# sensor/condition. This is the permanent record: it survives past any single
# session, so it's what a professor can be pointed at directly.
# ---------------------------------------------------------------------------
st.divider()
st.subheader("Full details")

if not DETAIL_PATH.is_file():
    st.info(
        "No detailed records yet — click \"Save results\" in app.py after running a sensor "
        "to generate results/full_details.json."
    )
else:
    details = json.loads(DETAIL_PATH.read_text())
    detail_index = {
        f"{d['sensor_id']} ({d['variant']}) — {d['temperature_c']}°C @ {d['voltage_v']}V": d
        for d in details
    }
    picked_label = st.selectbox("Sensor / condition", list(detail_index.keys()))
    d = detail_index[picked_label]

    dm1, dm2, dm3 = st.columns(3)
    dm1.metric("Min-Entropy (bits/bit)", f"{d['min_entropy']['min_entropy_per_bit']:.4f}")
    dm2.metric("VN Retention Rate", f"{d['debias']['retention_rate']:.4f}")
    dm3.metric("SP 800-22 Pass Rate", f"{d['sp800_22']['pass_rate']:.4f}")

    with st.expander("Von Neumann debiasing stats"):
        st.json(d["debias"])

    with st.expander("SP 800-90B estimator breakdown", expanded=True):
        est_df = pd.DataFrame(
            [
                {"Estimator": name, **{k: v for k, v in vals.items() if k != "testCaseDesc"}}
                for name, vals in d["min_entropy"]["estimators"].items()
            ]
        )
        st.dataframe(est_df, width="stretch")

    with st.expander("SP 800-22 sub-test results (all rows)", expanded=True):
        sub_df = pd.DataFrame(d["sp800_22"]["sub_tests"])
        st.dataframe(sub_df, width="stretch")

    st.download_button(
        "Download full_details.json", DETAIL_PATH.read_text(), file_name="full_details.json"
    )
