"""Generate lineage artifacts from the LIVE Feast registry:
   docs/lineage_dictionary.json|.md  (feature -> source table/column -> transformation -> owner -> sensitivity)
   docs/lineage.mmd                  (Mermaid graph: raw tables -> ETL -> Parquet/DuckDB -> Feast views -> online store -> model/skew monitor)

Feature -> source column mappings (SOURCE_MAP) mirror the SQL in ingest_data.py; the script FAILS if any feature
registered in Feast has no mapping, so lineage cannot silently go stale.
"""
from __future__ import annotations

import json
import sys

import common as C
from feature_store.features import ALL_OBJECTS  # noqa: F401  (ensures definitions importable)

RAW = {"customer_demographics": "raw_telco_customer", "customer_services": "raw_telco_services", "customer_billing": "raw_telco_billing"}
SOURCE_MAP = {  # feature: (source columns, transformation logic)
    "gender": (["gender"], "Copied as-is"),
    "senior_citizen": (["SeniorCitizen"], "CAST to BIGINT (0/1)"),
    "partner": (["Partner"], "Copied as-is"),
    "dependents": (["Dependents"], "Copied as-is"),
    "phone_service": (["PhoneService"], "Copied as-is"),
    "multiple_lines": (["MultipleLines"], "Copied as-is"),
    "internet_service": (["InternetService"], "Copied as-is"),
    "online_security": (["OnlineSecurity"], "Copied as-is"),
    "online_backup": (["OnlineBackup"], "Copied as-is"),
    "device_protection": (["DeviceProtection"], "Copied as-is"),
    "tech_support": (["TechSupport"], "Copied as-is"),
    "streaming_tv": (["StreamingTV"], "Copied as-is"),
    "streaming_movies": (["StreamingMovies"], "Copied as-is"),
    "num_addon_services": (["OnlineSecurity", "OnlineBackup", "DeviceProtection", "TechSupport", "StreamingTV", "StreamingMovies"],
                           "Sum of (col = 'Yes') over the six add-on columns -> 0..6"),
    "tenure": (["tenure"], "CAST to BIGINT"),
    "contract": (["Contract"], "Copied as-is"),
    "paperless_billing": (["PaperlessBilling"], "Copied as-is"),
    "payment_method": (["PaymentMethod"], "Copied as-is"),
    "monthly_charges": (["MonthlyCharges"], "CAST to DOUBLE"),
    "total_charges": (["TotalCharges"], "TRIM -> NULLIF('') -> TRY_CAST DOUBLE -> COALESCE(0.0) (11 blank strings where tenure=0)"),
    "avg_monthly_spend": (["TotalCharges", "tenure", "MonthlyCharges"], "total_charges / tenure if tenure > 0 else monthly_charges"),
}


def build_dictionary() -> list[dict]:
    store = C.get_store()
    store.apply(ALL_OBJECTS)
    svc = store.get_feature_service(C.FEATURE_SERVICE)
    rows, missing = [], []
    for fv in store.list_feature_views():
        for f in fv.features:
            if f.name not in SOURCE_MAP:
                missing.append(f.name); continue
            cols, logic = SOURCE_MAP[f.name]
            tags = {**fv.tags, **f.tags}
            rows.append({"feature": f.name, "feature_view": fv.name, "dtype": str(f.dtype), "source_table": RAW[fv.name],
                         "source_columns": cols, "transformation": logic, "owner": fv.owner,
                         "sensitive_tag": tags.get("sensitive"), "pii_tag": tags.get("PII"),
                         "fairness_audit": tags.get("fairness_audit"), "offline_source": fv.batch_source.path.split("/")[-1],
                         "consumed_by": [p.name for p in [svc]]})
    if missing:
        sys.exit(f"LINEAGE ERROR: no source mapping for registered features: {missing}")
    return rows


def mermaid() -> str:
    return """flowchart LR
  subgraph SRC["Raw sources (DuckDB data/telco.duckdb)"]
    CSV[("IBM Telco CSV<br/>public dataset")]
    RC[("raw_telco_customer")]
    RS[("raw_telco_services")]
    RB[("raw_telco_billing")]
  end
  CSV -- "ingest_data.py<br/>split by column group" --> RC & RS & RB
  subgraph ETL["ETL / transformation layer (DuckDB SQL)"]
    T1["clean + CAST<br/>snapshot event_timestamp"]
    T2["num_addon_services<br/>= count of 'Yes' add-ons"]
    T3["total_charges: blank->0.0<br/>avg_monthly_spend = total/tenure"]
  end
  RC --> T1
  RS --> T2
  RB --> T3
  subgraph OFF["Feast OFFLINE store (Parquet)"]
    P1[("demographics.parquet")]
    P2[("services.parquet")]
    P3[("billing.parquet")]
    PL[("labels.parquet<br/>churn @ 2025-07-01")]
  end
  T1 --> P1
  T2 --> P2
  T3 --> P3
  RB -- "Churn column" --> PL
  subgraph FEAST["Feast registry (data/registry.db)"]
    FV1["customer_demographics<br/>owner: Retention-Data-Team<br/>sensitive: demographic"]
    FV2["customer_services<br/>sensitive: none"]
    FV3["customer_billing<br/>sensitive: financial"]
    FS{{"FeatureService<br/>churn_model_v1"}}
  end
  P1 --> FV1
  P2 --> FV2
  P3 --> FV3
  FV1 & FV2 & FV3 --> FS
  ON[("Feast ONLINE store<br/>Redis (SQLite locally)")]
  FV1 & FV2 & FV3 -- "materialize.py<br/>offline -> online" --> ON
  FS -- "get_historical_features<br/>point-in-time join" --> TR["train_and_serve.py<br/>XGBoost churn model"]
  PL --> TR
  TR --> M[["Churn classifier<br/>artifacts/churn_xgb.json"]]
  TR -- "train_features.parquet<br/>(baseline)" --> SK
  ON -- "get_online_features<br/>low-latency" --> M
  ON -- "live features" --> SK["skew_detection.py<br/>Skew Monitoring Service<br/>PSI / KS / chi-square / schema"]
  SK --> AL(["PASS / WARN / FAIL<br/>alert report JSON"])
  M --> PRED(["Churn probability<br/>to retention team"])
  classDef sens fill:#fde2e2,stroke:#c0392b;
  class FV1 sens;
"""


def markdown_table(rows: list[dict]) -> str:
    h = "| Feature | Feature view | Source table | Source column(s) | Transformation logic | Owner | Sensitive tag | PII | Fairness audit |\n|---|---|---|---|---|---|---|---|---|\n"
    return h + "\n".join(f"| `{r['feature']}` | {r['feature_view']} | `{r['source_table']}` | {', '.join('`'+c+'`' for c in r['source_columns'])} | {r['transformation']} | {r['owner']} | {r['sensitive_tag']} | {r['pii_tag']} | {r['fairness_audit']} |" for r in rows) + "\n"


def main() -> None:
    docs = C.ROOT / "docs"
    docs.mkdir(exist_ok=True)
    rows = build_dictionary()
    (docs / "lineage_dictionary.json").write_text(json.dumps(rows, indent=2))
    (docs / "lineage_dictionary.md").write_text(markdown_table(rows))
    (docs / "lineage.mmd").write_text(mermaid())
    (docs / "lineage.md").write_text("# Data lineage & provenance\n\nGenerated by `lineage.py` from the live Feast registry. "
        "Red node = feature view holding sensitive demographic attributes.\n\n```mermaid\n" + mermaid() + "```\n\n"
        "## Lineage dictionary\n\n" + markdown_table(rows) + "\nMachine-readable copy: `lineage_dictionary.json`.\n")
    print(f"[lineage] {len(rows)} features documented -> docs/lineage_dictionary.(json|md), docs/lineage.mmd")
    sens = [r["feature"] for r in rows if r["sensitive_tag"] == "demographic"]
    print(f"[lineage] sensitive demographic features: {sens}")


if __name__ == "__main__":
    main()
