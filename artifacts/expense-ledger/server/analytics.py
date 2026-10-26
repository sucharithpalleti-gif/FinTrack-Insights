from typing import Any

import numpy as np
import pandas as pd


EMPTY_KPIS = {
    "total_spent": 0.0,
    "avg_transaction": 0.0,
    "median_transaction": 0.0,
    "std_dev": 0.0,
    "max_transaction": 0.0,
    "min_transaction": 0.0,
    "total_count": 0,
    "top_category": "N/A",
    "top_category_amount": 0.0,
}


def process_expense_analytics(
    raw: list[dict[str, Any]],
) -> dict[str, Any]:
    """Aggregate filtered transactions with Pandas and NumPy."""
    if not raw:
        return {
            "kpis": dict(EMPTY_KPIS),
            "category_breakdown": [],
            "monthly_totals": [],
        }

    frame = pd.DataFrame(raw)
    frame["amount"] = pd.to_numeric(frame["amount"], errors="coerce")
    frame["expense_date"] = pd.to_datetime(
        frame["expense_date"], errors="coerce"
    )
    frame = frame.dropna(subset=["amount", "expense_date"])
    if frame.empty:
        return {
            "kpis": dict(EMPTY_KPIS),
            "category_breakdown": [],
            "monthly_totals": [],
        }

    amounts = frame["amount"].to_numpy(dtype=float)
    total = float(np.sum(amounts))
    categories = (
        frame.groupby("category_name")["amount"]
        .agg(["sum", "count"])
        .reset_index()
        .rename(
            columns={
                "sum": "total_amount",
                "count": "transaction_count",
            }
        )
        .sort_values("total_amount", ascending=False)
    )
    categories["share_pct"] = (
        categories["total_amount"] / total * 100
    ).round(1)

    frame["year_month"] = frame["expense_date"].dt.to_period("M").astype(str)
    monthly = (
        frame.groupby("year_month")["amount"]
        .sum()
        .reset_index()
        .rename(columns={"amount": "monthly_total"})
        .sort_values("year_month")
    )

    return {
        "kpis": {
            "total_spent": round(total, 2),
            "avg_transaction": round(float(np.mean(amounts)), 2),
            "median_transaction": round(float(np.median(amounts)), 2),
            "std_dev": round(
                float(np.std(amounts)) if len(amounts) > 1 else 0.0, 2
            ),
            "max_transaction": round(float(np.max(amounts)), 2),
            "min_transaction": round(float(np.min(amounts)), 2),
            "total_count": int(len(amounts)),
            "top_category": str(categories.iloc[0]["category_name"]),
            "top_category_amount": round(
                float(categories.iloc[0]["total_amount"]), 2
            ),
        },
        "category_breakdown": categories.to_dict("records"),
        "monthly_totals": monthly.to_dict("records"),
    }
