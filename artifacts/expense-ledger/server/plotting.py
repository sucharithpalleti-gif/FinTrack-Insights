import base64
import io
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import numpy as np


PALETTE = [
    "#818cf8",
    "#22d3ee",
    "#34d399",
    "#fbbf24",
    "#fb7185",
    "#c084fc",
    "#2dd4bf",
    "#fb923c",
]

plt.rcParams.update(
    {
        "text.color": "#aab4c8",
        "axes.labelcolor": "#aab4c8",
        "xtick.color": "#7f8aa3",
        "ytick.color": "#7f8aa3",
        "font.family": "sans-serif",
        "font.sans-serif": ["Inter", "Segoe UI", "DejaVu Sans"],
    }
)


def _as_data_url(fig: plt.Figure) -> str:
    buffer = io.BytesIO()
    fig.savefig(
        buffer,
        format="png",
        bbox_inches="tight",
        transparent=True,
        dpi=145,
    )
    plt.close(fig)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _empty_chart(message: str) -> str:
    fig, axis = plt.subplots(figsize=(6.4, 3.1), facecolor="none")
    axis.text(
        0.5,
        0.5,
        message,
        color="#7f8aa3",
        fontsize=11,
        ha="center",
        va="center",
    )
    axis.axis("off")
    return _as_data_url(fig)


def generate_bar_chart(monthly_totals: list[dict[str, Any]]) -> str:
    if not monthly_totals:
        return _empty_chart("No monthly data for this filter")

    months = [str(item["year_month"]) for item in monthly_totals]
    totals = [float(item["monthly_total"]) for item in monthly_totals]
    fig, axis = plt.subplots(figsize=(6.4, 3.1), facecolor="none")
    bars = axis.bar(
        months,
        totals,
        color="#6366f1",
        width=0.5,
        edgecolor="#818cf8",
        linewidth=0.8,
        zorder=3,
    )
    bars[int(np.argmax(totals))].set_color("#22d3ee")
    axis.grid(
        True,
        axis="y",
        linestyle="--",
        alpha=0.16,
        color="#aab4c8",
        zorder=0,
    )
    for side in ("top", "right"):
        axis.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        axis.spines[side].set_color("#2a3448")
    axis.set_ylabel("Total spent", fontsize=9)
    axis.yaxis.set_major_formatter(
        ticker.FuncFormatter(lambda value, _: f"₹{value:,.0f}")
    )
    axis.tick_params(axis="x", rotation=22, labelsize=8)
    return _as_data_url(fig)


def generate_pie_chart(category_breakdown: list[dict[str, Any]]) -> str:
    if not category_breakdown:
        return _empty_chart("No category data for this filter")

    labels = [str(item["category_name"]) for item in category_breakdown]
    values = [float(item["total_amount"]) for item in category_breakdown]
    if len(labels) > 6:
        labels = labels[:5] + ["Other categories"]
        values = values[:5] + [sum(values[5:])]

    fig, axis = plt.subplots(figsize=(6.4, 3.1), facecolor="none")
    _, _, percentages = axis.pie(
        values,
        labels=labels,
        autopct="%1.0f%%",
        pctdistance=0.78,
        startangle=140,
        colors=PALETTE[: len(labels)],
        wedgeprops={"width": 0.42, "edgecolor": "#121a29", "linewidth": 2},
        textprops={"color": "#aab4c8", "fontsize": 8},
    )
    for label in percentages:
        label.set_color("#ffffff")
        label.set_fontsize(8)
        label.set_fontweight("bold")
    return _as_data_url(fig)
