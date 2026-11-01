"""Feast definitions: entity, three governed feature views (one per raw source table) and the model feature service.

Governance metadata (owner / description / tags) is attached at three levels:
  * FeatureView  -> owner, description, tags (sensitive / PII / fairness_audit)
  * Field        -> per-feature description and tags
  * FeatureService -> the model that consumes the views (the last hop of the lineage graph)
"""
from datetime import timedelta
from pathlib import Path

from feast import Entity, FeatureService, FeatureView, Field, FileSource
from feast.types import Float64, Int64, String

OFFLINE = Path(__file__).resolve().parents[1] / "data" / "offline"
OWNER = "Retention-Data-Team"
TTL = timedelta(days=365)

customer = Entity(
    name="customer_id",
    join_keys=["customer_id"],
    description="Telecom subscriber identifier (IBM Telco 'customerID', synthetic/pseudonymous, no direct PII).",
    owner=OWNER,
    tags={"PII": "none", "pseudonymous_key": "true"},
)

# ---------------------------------------------------------------- sources (offline store = Parquet built via DuckDB)
demographics_source = FileSource(
    name="demographics_source",
    path=str(OFFLINE / "demographics.parquet"),
    timestamp_field="event_timestamp",
    description="Parquet snapshot of raw_telco_customer produced by ingest_data.py",
    owner="Customer-Data-Platform",
)
services_source = FileSource(
    name="services_source",
    path=str(OFFLINE / "services.parquet"),
    timestamp_field="event_timestamp",
    description="Parquet snapshot of raw_telco_services produced by ingest_data.py",
    owner="Product-Data-Team",
)
billing_source = FileSource(
    name="billing_source",
    path=str(OFFLINE / "billing.parquet"),
    timestamp_field="event_timestamp",
    description="Parquet snapshot of raw_telco_billing produced by ingest_data.py",
    owner="Finance-Data-Team",
)

SENSITIVE = {"sensitive": "demographic", "PII": "none", "fairness_audit": "required"}
NOT_SENSITIVE = {"sensitive": "none", "PII": "none", "fairness_audit": "not_required"}
FINANCIAL = {"sensitive": "financial", "PII": "none", "fairness_audit": "proxy_check"}

# ---------------------------------------------------------------- feature views
demographics_fv = FeatureView(
    name="customer_demographics",
    entities=[customer],
    ttl=TTL,
    source=demographics_source,
    schema=[
        Field(name="gender", dtype=String, description="Self-reported gender (Female/Male). Protected attribute.", tags=SENSITIVE),
        Field(name="senior_citizen", dtype=Int64, description="1 if customer is 65+, else 0. Protected attribute (age).", tags=SENSITIVE),
        Field(name="partner", dtype=String, description="Whether the customer has a partner (Yes/No). Marital-status proxy.", tags=SENSITIVE),
        Field(name="dependents", dtype=String, description="Whether the customer has dependents (Yes/No). Family-status proxy.", tags=SENSITIVE),
    ],
    online=True,
    owner=OWNER,
    description="Customer demographic attributes. Contains sensitive attributes that must be audited for fairness.",
    tags={"domain": "customer", "sensitive": "demographic", "PII": "none", "fairness_audit": "required",
          "source_table": "raw_telco_customer"},
)

services_fv = FeatureView(
    name="customer_services",
    entities=[customer],
    ttl=TTL,
    source=services_source,
    schema=[
        Field(name="phone_service", dtype=String, description="Has phone service (Yes/No).", tags=NOT_SENSITIVE),
        Field(name="multiple_lines", dtype=String, description="Multiple phone lines (Yes/No/No phone service).", tags=NOT_SENSITIVE),
        Field(name="internet_service", dtype=String, description="Internet provider type (DSL/Fiber optic/No).", tags=NOT_SENSITIVE),
        Field(name="online_security", dtype=String, description="Online-security add-on (Yes/No/No internet service).", tags=NOT_SENSITIVE),
        Field(name="online_backup", dtype=String, description="Online-backup add-on (Yes/No/No internet service).", tags=NOT_SENSITIVE),
        Field(name="device_protection", dtype=String, description="Device-protection add-on (Yes/No/No internet service).", tags=NOT_SENSITIVE),
        Field(name="tech_support", dtype=String, description="Tech-support add-on (Yes/No/No internet service).", tags=NOT_SENSITIVE),
        Field(name="streaming_tv", dtype=String, description="Streaming-TV add-on (Yes/No/No internet service).", tags=NOT_SENSITIVE),
        Field(name="streaming_movies", dtype=String, description="Streaming-movies add-on (Yes/No/No internet service).", tags=NOT_SENSITIVE),
        Field(name="num_addon_services", dtype=Int64, description="DERIVED: count of the six add-ons whose value is 'Yes' (0-6).", tags=NOT_SENSITIVE),
    ],
    online=True,
    owner=OWNER,
    description="Subscribed telecom services and derived add-on count.",
    tags={"domain": "product", "sensitive": "none", "PII": "none", "fairness_audit": "not_required",
          "source_table": "raw_telco_services"},
)

billing_fv = FeatureView(
    name="customer_billing",
    entities=[customer],
    ttl=TTL,
    source=billing_source,
    schema=[
        Field(name="tenure", dtype=Int64, description="Months the customer has been subscribed (0-72).", tags=NOT_SENSITIVE),
        Field(name="contract", dtype=String, description="Contract type (Month-to-month/One year/Two year).", tags=NOT_SENSITIVE),
        Field(name="paperless_billing", dtype=String, description="Paperless billing enabled (Yes/No).", tags=NOT_SENSITIVE),
        Field(name="payment_method", dtype=String, description="Payment method (Electronic check/Mailed check/Bank transfer (automatic)/Credit card (automatic)). Possible socio-economic proxy.", tags=FINANCIAL),
        Field(name="monthly_charges", dtype=Float64, description="Current monthly charge in USD.", tags=FINANCIAL),
        Field(name="total_charges", dtype=Float64, description="Lifetime charges in USD. Source has 11 blank strings (tenure=0) imputed to 0.0 in ETL.", tags=FINANCIAL),
        Field(name="avg_monthly_spend", dtype=Float64, description="DERIVED: total_charges / tenure (monthly_charges when tenure = 0).", tags=FINANCIAL),
    ],
    online=True,
    owner=OWNER,
    description="Contract, billing and payment features including derived average monthly spend.",
    tags={"domain": "billing", "sensitive": "financial", "PII": "none", "fairness_audit": "proxy_check",
          "source_table": "raw_telco_billing"},
)

# ---------------------------------------------------------------- feature service = the model contract
churn_model_v1 = FeatureService(
    name="churn_model_v1",
    features=[demographics_fv, services_fv, billing_fv],
    owner=OWNER,
    description="Exact feature set consumed by the XGBoost churn classifier for BOTH training and serving "
                "(single definition -> no training-serving skew by construction).",
    tags={"model": "churn_xgboost_baseline", "stage": "capstone", "fairness_audit": "required"},
)

ALL_OBJECTS = [customer, demographics_source, services_source, billing_source,
               demographics_fv, services_fv, billing_fv, churn_model_v1]
