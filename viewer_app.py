"""Read-only results viewer for the LM35 TRNG pipeline.

Deployable to a free host (e.g. Streamlit Community Cloud): reads only the
small results/summary.csv committed to the repo, never the raw sensor CSVs
or the NIST reference tools, so it carries none of the local pipeline's
data-size or compiled-binary dependencies.
"""

from pathlib import Path

import altair as alt
import pandas as pd
import streamlit as st

SUMMARY_PATH = Path(__file__).parent / "results" / "summary.csv"

# Fixed categorical order (blue / orange / aqua), never cycled — see
# thesis memory's dataviz conventions. Slots 1-3 of the validated default
# palette, chosen because they clear all-pairs CVD checks together.
VARIANT_COLORS = {"A": "#2a78d6", "B": "#eb6834", "C": "#1baf7a"}

st.set_page_config(page_title="LM35 TRNG Results", layout="wide")
st.title("LM35 TRNG Analysis — Results")
st.caption("ADS1115 (16-bit ADC) vs. Ayyada's MCP3008 (10-bit ADC) baseline")

if not SUMMARY_PATH.is_file():
    st.error(
        f"No results found at {SUMMARY_PATH}. Run `python3 main.py` locally and "
        "push the generated results/summary.csv."
    )
    st.stop()

df = pd.read_csv(SUMMARY_PATH)

variants_present = sorted(df["Variant"].unique())
color_scale = alt.Scale(
    domain=variants_present, range=[VARIANT_COLORS[v] for v in variants_present]
)

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
st.caption("Averaged across the 6 temperature/voltage conditions per sensor.")
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
st.caption("Averaged across the 6 temperature/voltage conditions per sensor.")
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
