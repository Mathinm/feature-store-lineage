# Data Card — IBM Telco Customer Churn

| Field | Value |
|---|---|
| Source | IBM sample dataset "Telco Customer Churn" (public GitHub: `IBM/telco-customer-churn-on-icp4d`) |
| Size | 7,043 customers × 21 columns; churn rate 26.5% (1,869 churners) |
| Granularity | One row per customer (no native timestamps) |
| Personal data | None real; `customerID` is a pseudonymous key. No names, addresses, phone numbers or card numbers. |
| License / use | Publicly distributed sample data; used here for academic purposes only |

## Intended use
Academic demonstration of a governed feature store, lineage and training-serving skew detection for churn prediction.
**Not** intended for real customer decisions (pricing, credit, service denial) or for inference about real individuals.

## Raw tables created by `ingest_data.py`
`raw_telco_customer` (gender, SeniorCitizen, Partner, Dependents) · `raw_telco_services` (phone/internet and six add-ons) ·
`raw_telco_billing` (tenure, Contract, PaperlessBilling, PaymentMethod, MonthlyCharges, TotalCharges, Churn label).

## Splits
Stratified 80/20 by churn, seed 42: **5,634 train / 1,409 test**. The test customers are also the "live traffic" pool for skew tests.
Feature snapshots carry deterministic synthetic dates in 2025-01-01…2025-06-30; labels are stamped 2025-07-01.

## Sensitive / protected attributes (tagged `sensitive: demographic`, `fairness_audit: required`)
`SeniorCitizen` (age proxy), `Partner` and `Dependents` (family/marital-status proxies), and `gender`.
`PaymentMethod`, `MonthlyCharges`, `TotalCharges`, `avg_monthly_spend` are tagged `sensitive: financial` (possible socio-economic proxies).

## Known data quality issues
* `TotalCharges` has 11 blank strings (all `tenure = 0`) — the IBM file stores them as `" "`; ETL imputes 0.0. This quirk is the basis of the schema-skew experiment.
* The label is a single churn snapshot; there is no churn date, so true temporal validation is impossible.

## Potential biases and limitations
* Base rates differ by group (test set): senior citizens 36.7% vs 24.6% non-seniors; no partner 32.6% vs 20.1%; no dependents 30.4% vs 17.2%. A model can reproduce these gaps.
* Group sizes are uneven (229 senior citizens in the test split), so slice metrics are noisy.
* Gender is binary in the source; other identities are not represented.
* Single telecom provider; IBM sample dataset — findings may not transfer to real operators.
