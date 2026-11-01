"""Ingest the IBM Telco Customer Churn dataset into the offline store.

Steps
  1. Download the public IBM CSV (or generate a statistically similar synthetic copy with --synthetic / on failure).
  2. Load it into DuckDB and split into THREE raw tables: raw_telco_customer, raw_telco_services, raw_telco_billing.
  3. Run SQL ETL (cleaning + derived features) and write one Parquet file per feature view + a labels file.
     DuckDB file (data/telco.duckdb) + Parquet = the batch/offline store read by Feast.

The public dataset has no timestamps, so each customer receives a deterministic pseudo-random snapshot date in
[2025-01-01, 2025-06-30]; labels are stamped 2025-07-01. This lets Feast do true point-in-time joins.
"""
from __future__ import annotations

import argparse
import urllib.request

import duckdb
import numpy as np
import pandas as pd

import common as C


def download_or_generate(synthetic: bool, n: int = 7043, seed: int = 7) -> None:
    C.ensure_dirs()
    if C.RAW_CSV.exists() and not synthetic:
        print(f"[ingest] using cached {C.RAW_CSV}")
        return
    if not synthetic:
        try:
            print(f"[ingest] downloading {C.IBM_TELCO_URL}")
            urllib.request.urlretrieve(C.IBM_TELCO_URL, C.RAW_CSV)
            return
        except Exception as exc:  # network failure -> fall back to synthetic data
            print(f"[ingest] download failed ({exc}); generating synthetic Telco-like data")
    generate_synthetic(n, seed).to_csv(C.RAW_CSV, index=False)
    print(f"[ingest] wrote synthetic dataset ({n} rows) to {C.RAW_CSV}")


def generate_synthetic(n: int, seed: int) -> pd.DataFrame:
    """Synthetic Telco-like generator (schema identical to IBM file) used only when the download is unavailable."""
    rng = np.random.default_rng(seed)
    yn = lambda p: rng.choice(["Yes", "No"], n, p=[p, 1 - p])  # noqa: E731
    internet = rng.choice(["DSL", "Fiber optic", "No"], n, p=[0.34, 0.44, 0.22])
    addon = lambda: np.where(internet == "No", "No internet service", yn(0.4))  # noqa: E731
    phone = yn(0.9)
    contract = rng.choice(["Month-to-month", "One year", "Two year"], n, p=[0.55, 0.21, 0.24])
    tenure = np.clip(rng.gamma(2.0, 16.0, n).astype(int), 0, 72)
    monthly = np.round(np.where(internet == "No", 20, np.where(internet == "DSL", 55, 85)) + rng.normal(0, 10, n), 2).clip(18.25, 118.75)
    total = np.round(monthly * tenure, 2).astype(str)
    total[tenure == 0] = " "                                     # reproduce the IBM blank-string quirk
    pay = rng.choice(["Electronic check", "Mailed check", "Bank transfer (automatic)", "Credit card (automatic)"], n, p=[0.34, 0.23, 0.22, 0.21])
    logit = -0.8 + 1.1 * (contract == "Month-to-month") - 0.03 * tenure + 0.6 * (internet == "Fiber optic") + 0.5 * (pay == "Electronic check")
    churn = rng.random(n) < 1 / (1 + np.exp(-logit))
    return pd.DataFrame({
        "customerID": [f"{i:04d}-SYN{i % 97:02d}" for i in range(n)], "gender": rng.choice(["Female", "Male"], n),
        "SeniorCitizen": (rng.random(n) < 0.16).astype(int), "Partner": yn(0.48), "Dependents": yn(0.30), "tenure": tenure,
        "PhoneService": phone, "MultipleLines": np.where(phone == "No", "No phone service", yn(0.42)),
        "InternetService": internet, "OnlineSecurity": addon(), "OnlineBackup": addon(), "DeviceProtection": addon(),
        "TechSupport": addon(), "StreamingTV": addon(), "StreamingMovies": addon(), "Contract": contract,
        "PaperlessBilling": yn(0.59), "PaymentMethod": pay, "MonthlyCharges": monthly, "TotalCharges": total,
        "Churn": np.where(churn, "Yes", "No"),
    })


SQL_RAW = """
CREATE OR REPLACE TABLE raw_staging AS SELECT * FROM read_csv_auto('{csv}', header=true, all_varchar=true);

CREATE OR REPLACE TABLE raw_telco_customer AS
  SELECT customerID, gender, SeniorCitizen, Partner, Dependents, current_timestamp AS ingested_at FROM raw_staging;

CREATE OR REPLACE TABLE raw_telco_services AS
  SELECT customerID, PhoneService, MultipleLines, InternetService, OnlineSecurity, OnlineBackup, DeviceProtection,
         TechSupport, StreamingTV, StreamingMovies, current_timestamp AS ingested_at FROM raw_staging;

CREATE OR REPLACE TABLE raw_telco_billing AS
  SELECT customerID, tenure, Contract, PaperlessBilling, PaymentMethod, MonthlyCharges, TotalCharges, Churn,
         current_timestamp AS ingested_at FROM raw_staging;
"""

# snapshot_day is a deterministic hash of the customer id -> reproducible event timestamps
SQL_FEATURES = {
    "demographics": """
        SELECT customerID AS customer_id, gender, CAST(SeniorCitizen AS BIGINT) AS senior_citizen,
               Partner AS partner, Dependents AS dependents,
               CAST(hash(customerID) % {days} AS INTEGER) AS snapshot_day
        FROM raw_telco_customer""",
    "services": """
        SELECT customerID AS customer_id, PhoneService AS phone_service, MultipleLines AS multiple_lines,
               InternetService AS internet_service, OnlineSecurity AS online_security, OnlineBackup AS online_backup,
               DeviceProtection AS device_protection, TechSupport AS tech_support, StreamingTV AS streaming_tv,
               StreamingMovies AS streaming_movies,
               CAST((CASE WHEN OnlineSecurity='Yes' THEN 1 ELSE 0 END) + (CASE WHEN OnlineBackup='Yes' THEN 1 ELSE 0 END)
                    + (CASE WHEN DeviceProtection='Yes' THEN 1 ELSE 0 END) + (CASE WHEN TechSupport='Yes' THEN 1 ELSE 0 END)
                    + (CASE WHEN StreamingTV='Yes' THEN 1 ELSE 0 END) + (CASE WHEN StreamingMovies='Yes' THEN 1 ELSE 0 END) AS BIGINT) AS num_addon_services,
               CAST(hash(customerID) % {days} AS INTEGER) AS snapshot_day
        FROM raw_telco_services""",
    "billing": """
        SELECT customerID AS customer_id, CAST(tenure AS BIGINT) AS tenure, Contract AS contract,
               PaperlessBilling AS paperless_billing, PaymentMethod AS payment_method,
               CAST(MonthlyCharges AS DOUBLE) AS monthly_charges,
               COALESCE(TRY_CAST(NULLIF(TRIM(TotalCharges), '') AS DOUBLE), 0.0) AS total_charges,
               CASE WHEN CAST(tenure AS INTEGER) > 0
                    THEN COALESCE(TRY_CAST(NULLIF(TRIM(TotalCharges), '') AS DOUBLE), 0.0) / CAST(tenure AS INTEGER)
                    ELSE CAST(MonthlyCharges AS DOUBLE) END AS avg_monthly_spend,
               CAST(hash(customerID) % {days} AS INTEGER) AS snapshot_day
        FROM raw_telco_billing""",
}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--synthetic", action="store_true", help="generate synthetic data instead of downloading")
    args = ap.parse_args()

    download_or_generate(args.synthetic)
    con = duckdb.connect(str(C.DUCKDB_PATH))
    con.execute(SQL_RAW.format(csv=C.RAW_CSV.as_posix()))
    for t in ("raw_telco_customer", "raw_telco_services", "raw_telco_billing"):
        print(f"[ingest] {t}: {con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]} rows")

    start = pd.Timestamp(C.SNAPSHOT_START, tz="UTC")
    for name, sql in SQL_FEATURES.items():
        df = con.execute(sql.format(days=C.SNAPSHOT_DAYS)).df()
        df["event_timestamp"] = start + pd.to_timedelta(df.pop("snapshot_day"), unit="D")
        out = C.OFFLINE_DIR / f"{name}.parquet"
        df.to_parquet(out, index=False)
        con.register("tmp_df", df)
        con.execute(f"CREATE OR REPLACE TABLE feat_{name} AS SELECT * FROM tmp_df")
        con.unregister("tmp_df")
        print(f"[ingest] {out.name}: {len(df)} rows, cols={list(df.columns)}")

    labels = con.execute("SELECT customerID AS customer_id, CASE WHEN Churn='Yes' THEN 1 ELSE 0 END AS churn FROM raw_telco_billing").df()
    labels["event_timestamp"] = pd.Timestamp(C.LABEL_TIMESTAMP, tz="UTC")
    labels.to_parquet(C.OFFLINE_DIR / "labels.parquet", index=False)
    con.register("tmp_labels", labels)
    con.execute("CREATE OR REPLACE TABLE labels AS SELECT * FROM tmp_labels")
    print(f"[ingest] labels.parquet: {len(labels)} rows, churn rate={labels.churn.mean():.3%}")
    con.close()


if __name__ == "__main__":
    main()
