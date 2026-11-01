# Feature Store with Lineage: Detecting and Mitigating Training-Serving Skew in Telecom Churn Prediction

Team submission — Big Data Systems & Responsible AI Engineering Capstone (Topic 12)

## Abstract
Churn models fail silently when serving-time features differ from training-time features and when nobody can say where a feature came from. We build a feature store on the public IBM Telco Customer Churn dataset with Feast, a Parquet/DuckDB offline store and a Redis online store orchestrated by Docker Compose. Every feature view carries an owner, documentation and sensitivity tags; a lineage dictionary generated from the live registry maps each feature to its source table, column and transformation. A pure-Python/SciPy detector combines schema checks, the Population Stability Index (PSI), Kolmogorov–Smirnov and chi-square tests into a PASS/WARN/FAIL report. On 1,409 held-out customers the single feature definition gives zero online/offline mismatches and an XGBoost baseline reaches ROC-AUC 0.835. Against a live Redis 7.0.15 server, single-entity feature fetches take p50 3.4 ms / p99 6.4 ms; a synthetic scale test up to 211,290 entities shows linear storage growth (≈584 bytes/entity), flat lookup latency and ≈9–10k records/s materialization on one CPU core. Injected schema skew and drift are flagged FAIL while a clean control passes. A fairness audit exposes a severe senior-citizen gap (disparate-impact ratio 0.52); per-group equalized-odds thresholds raise it to 0.81 and cut the average-odds difference from 0.248 to 0.037 at a cost of 0.006 effective ROC-AUC.

## 1. Introduction and Problem Statement
Training-serving skew is a mismatch between the feature values a model was trained on and those it receives in production. Sculley et al. identify unstable data dependencies and glue code as a main source of ML technical debt [1]. In churn prediction it arises when (i) batch SQL builds training features while serving features are re-implemented in application code, (ii) an upstream system changes a type or encoding, or (iii) behaviour or pricing shifts so live distributions leave the training distribution [2]. Without lineage, a skew alert cannot be traced to a source table, transformation or owner, and sensitive attributes can flow into models unnoticed.

Goals: **G1** one governed definition of each feature shared by training and serving; **G2** lineage from each feature to its source with owners and sensitivity tags; **G3** statistically grounded detection of schema and distribution skew; **G4** measured serving latency and scalability of the online store; **G5** an audited and actively mitigated fairness gap. Data: IBM Telco Customer Churn, 7,043 customers, 26.5% churn, public, no real personal data.

## 2. System Architecture and Feature Store Design
**Pipeline.** `ingest_data.py` loads the CSV into DuckDB and splits it into `raw_telco_customer`, `raw_telco_services` and `raw_telco_billing`. SQL ETL cleans types, imputes the 11 blank `TotalCharges` values (tenure 0) to 0.0, derives `num_addon_services` and `avg_monthly_spend`, and writes one Parquet file per feature view plus labels. Because the public data has no timestamps, each customer receives a deterministic synthetic snapshot date in H1 2025 and labels are stamped 2025-07-01, enabling genuine point-in-time joins (an assumption, §5).

**Feast objects.** One entity (`customer_id`), three FeatureViews (21 features) and one FeatureService (`churn_model_v1`) that is the model's contract. Training calls `get_historical_features` (point-in-time join on Parquet); serving calls `get_online_features` on the same FeatureService; `materialize.py` syncs the latest value per entity into Redis. Defining each feature once removes the re-implementation path that causes skew: across all 1,409 test customers online values equal offline values (0 mismatches, prediction difference 0.0).

**Measured offline-store metrics.** The point-in-time join of 7,043 labelled entities against the three Parquet views (24 columns returned) took 0.38 s; the three Parquet files total 468 KB.

**Measured online-store latency (live Redis).** `benchmark_and_scale.py` was run against a real Redis 7.0.15 server (`artifacts/benchmark_metrics.json`). Environment: one vCPU, 3 GB RAM, Redis running as a local process on the same host, *not* inside the Docker container (the Compose run regenerates this file with container numbers). All requests use the 21-feature FeatureService on the 7,043-entity production store.

| Request | p50 (ms) | p95 (ms) | p99 (ms) |
|---|---|---|---|
| Raw Redis `PING` round trip (n = 2,000) | 0.058 | 0.109 | 0.139 |
| Single-entity fetch via Feast SDK (n = 1,000) | 3.39 | 5.68 | 6.45 |
| 100-entity batch fetch (n = 60) | 25.1 | 48.9 | 85.8 |
| 1,000-entity batch fetch (n = 20) | 362.5 | 537.6 | 543.6 |

The raw Redis round trip (0.06 ms) is under 2% of the 3.4 ms single-fetch time, so the remainder is Feast SDK work (request parsing, key serialisation, response conversion) plus the actual hash read, not network distance. Batching amortises it: 100 entities cost ≈ 0.25 ms each at p50. End-to-end single-customer inference (fetch + `to_df` + encoding + XGBoost) measured in `train_and_serve.py` was p50 20.2 ms / p95 32.4 ms (n = 200), and 24.5 ms p50 for a 100-entity fetch. An earlier SQLite-backed run gave p50 16.0 ms for the same end-to-end path; SQLite and Redis are therefore similar at this size because SDK overhead dominates, and Redis's advantage is concurrency and capacity rather than single-request latency (not measured here).

## 3. Responsible AI and Lineage Tracking
**Ownership and tags.** Every FeatureView sets `owner` (Retention-Data-Team) and a description; every field has its own description and tags. Demographic fields (`gender`, `senior_citizen`, `partner`, `dependents`) are tagged `sensitive: demographic, PII: none, fairness_audit: required`; billing fields are tagged `sensitive: financial` as possible socio-economic proxies. No direct identifiers exist; `customer_id` is pseudonymous.

**Lineage.** `lineage.py` joins the Feast registry with a declared source map to generate a lineage dictionary (feature → source table → column(s) → transformation → owner → sensitivity) and a Mermaid graph covering raw tables → ETL → offline store → feature views → online store → classifier and skew monitor. It aborts if any registered feature lacks a mapping, so documentation cannot drift from the registry.

**Fairness audit.** The baseline (all features, threshold 0.5) flags 66% of senior citizens versus 35% of others (disparate-impact ratio 0.52, false-positive rate 52% vs 22%); partner and dependents show ratios 0.57 and 0.47; gender is balanced (0.99). Removing protected attributes did not help (senior demographic-parity difference 0.314 → 0.256) because contract, tenure and charges act as proxies.

**Active mitigation (`fairness_mitigation.py`).** We implemented four methods for `senior_citizen`: Kamiran–Calders *reweighing* (pre-processing), per-group thresholds for *equalized odds* and for *demographic parity* (post-processing), and reweighing followed by equalized-odds thresholds. Protocol: training data is split 70/30 into fit (3,943) and calibration (1,691) sets; models are fitted on the former, thresholds on the latter, and all results are reported on the 1,409 test customers (229 seniors) with 300-resample bootstrap intervals. The baseline in this table is the model retrained on the 70% fit split (ROC-AUC 0.831; the 0.835 above uses all training data).

| Method | Senior threshold | Selection rate (non-senior / senior) | FPR (non-senior / senior) | Disparate-impact ratio [95% CI] | Equal-opp. diff | Average-odds diff [95% CI] | Effective ROC-AUC (Δ) | F1 | Recall |
|---|---|---|---|---|---|---|---|---|---|
| Baseline XGBoost | 0.50 | 0.35 / 0.67 | 0.23 / 0.53 | 0.518 [0.46, 0.58] | 0.191 | 0.248 [0.19, 0.30] | 0.831 (—) | 0.605 | 0.757 |
| Reweighing | 0.50 | 0.36 / 0.52 | 0.24 / 0.37 | 0.681 [0.60, 0.80] | 0.058 | 0.097 [0.04, 0.15] | 0.829 (−0.002) | 0.605 | 0.741 |
| **Threshold, equalized odds** | **0.73** | 0.35 / 0.43 | 0.23 / 0.28 | **0.808** [0.70, 0.98] | **0.023** | **0.037** [0.01, 0.10] | 0.825 (−0.006) | 0.602 | 0.709 |
| Threshold, demographic parity | 0.81 | 0.35 / 0.33 | 0.23 / 0.21 | 0.960 [0.77, 0.99] | 0.178 | 0.095 [0.05, 0.17] | 0.818 (−0.013) | 0.587 | 0.674 |
| Reweighing + equalized odds | 0.60* | 0.36 / 0.43 | 0.24 / 0.28 | 0.825 [0.71, 0.98] | 0.037 | 0.042 [0.02, 0.11] | 0.824 (−0.007) | 0.602 | 0.719 |

*Threshold fitted on the reweighed model's calibration scores. "Effective" ROC-AUC is computed on the group-shifted score s − (t_g − 0.5); threshold methods leave the model's own ranking AUC unchanged (0.831), so this exposes the cost of unequal cut-offs.

**Findings.** (i) Equalized-odds thresholds raise the disparate-impact ratio from 0.52 to 0.81 (above the four-fifths line, though the interval reaches 0.70), reduce the TPR gap from 0.191 to 0.023 and the average-odds difference by 85%, at −0.006 effective AUC, −0.003 F1 and −0.048 recall: seniors who truly churn are caught slightly less often, which is the price of halving their false alarms. (ii) Demographic parity gives the best ratio (0.96) but only moves the TPR gap from 0.191 to a *reversed* 0.178: senior recall falls to 0.54 versus 0.71 for non-seniors, and F1/recall are lowest, so it is the wrong target when churn base rates genuinely differ (36.7% vs 24.6%). (iii) Reweighing alone helps but does not reach 0.8 and adds nothing once thresholds are applied. (iv) Side effects: the senior-targeted thresholds change other slices — gender ratio 0.99 → 0.95, dependents 0.48 → 0.52, partner 0.57 → 0.51 — so partner/dependents still need their own mitigation. (v) Group-specific thresholds use the protected attribute at decision time (disparate treatment), which may be unlawful or unacceptable in some deployments; the senior group is small (229), hence the wide intervals.

## 4. Skew Detection Methodology, Experimental Results and Scale Benchmark
**Method.** Baseline = training features; live = features served from the online store. Continuous features: PSI (ten baseline-quantile bins) and the two-sample KS test; categorical: PSI over category shares and chi-square on a 2×K table [3–5]. PSI < 0.1 stable, 0.1–0.2 moderate, > 0.2 severe. A feature is FAIL if PSI > 0.2 or it has a schema issue (dtype family change, unseen categories), WARN if PSI ∈ [0.1, 0.2] or a test is significant (p < 0.01) with effect size > 0.1, else PASS; overall status is the worst feature status and `--fail-on-alert` returns exit code 1.

| Scenario (1,200 live vs 5,634 training rows) | Overall | Key findings |
|---|---|---|
| Clean control | **PASS** | all 21 features PSI ≤ 0.027, no alerts |
| Schema/type skew (`total_charges` as strings with blank for tenure ≤ 2; `senior_citizen` 0/1 → "No"/"Yes") | **FAIL** | dtype mismatch on both (130 unparseable `total_charges`, 1,200 `senior_citizen`); after naive median imputation `total_charges` PSI 0.33, KS D 0.15 |
| Distribution drift (price ×1.25, 40% new-tenure cohort, 30% moved to Electronic check) | **FAIL** | `monthly_charges` PSI 0.96 (KS D 0.27), `tenure` PSI 0.31; `payment_method` 0.16, `total_charges` 0.13, `avg_monthly_spend` 0.13 → WARN |

The clean control validates the thresholds (no false alarms) but is not independent evidence of absence of skew since online data derive from the same Parquet source; the injected failures are simulations, not production observations.

**Synthetic scale test (Big Data pillar).** The cohort was replicated into 1, 5, 15 and 30 entity partitions (ids `<customerID>-p<k>`), written to Parquet, registered in a separate Feast project and fully materialized into Redis (DB 1). Records = entities × 3 feature views.

| Entities | Records | Materialize (s) | Records/s | Redis memory (MB) | Bytes/entity | Parquet (MB) | Single fetch p50 / p99 (ms) | 100-batch p50 (ms) |
|---|---|---|---|---|---|---|---|---|
| 7,043 | 21,129 | 2.36 | 8,953 | 4.1 | 585 | 0.47 | 8.3 / 13.3 | 41.7 |
| 35,215 | 105,645 | 11.89 | 8,885 | 20.7 | 589 | 1.86 | 8.5 / 14.1 | 32.1 |
| 105,645 | 316,935 | 35.31 | 8,976 | 61.7 | 584 | 4.96 | 7.8 / 14.2 | 35.2 |
| 211,290 | 633,870 | 63.41 | 9,996 | 123.4 | 584 | 9.37 | 7.9 / 13.9 | 32.2 |

(Latencies in this table use a per-view feature-reference request, so they are comparable across rows but not with the FeatureService numbers in §2.) Storage grows linearly (≈584 bytes per entity in Redis, ≈44 bytes in Parquet), lookup latency is flat across a 30× increase (p50 7.8–8.5 ms, p99 13.3–14.2 ms), and materialization throughput is constant at 8.9–10.0k records/s.

**Partition-parallel loading.** At 211,290 entities we loaded the partitions with 1, 2 and 4 worker processes (`write_to_online_store`): 10,036, 9,197 and 7,925 records/s. With one available CPU core there is no speed-up and oversubscription costs up to 21%; the experiment therefore demonstrates the partitioned design and correctness (211,290 keys written in every run) but not multi-core scaling, which we could not measure.

## 5. Limitations and Future Work
* **Throughput limits.** A single Feast process sustains ≈3.0–3.3k entities/s (≈9–10k records/s) on one core. Linear extrapolation (not measured) puts 100 M entities at ≈8 hours and ≈58 GB of Redis memory with this configuration, which would require sharded Redis, multi-core or multi-node workers and a batch engine (Spark/Dask) for the offline side. The throughput ceiling was not profiled; per-row Python serialisation in the SDK is the likely cause, not Redis.
* **Environment.** Benchmarks ran on one vCPU against a local Redis process, not the Docker container and not under concurrent load; no multi-client throughput, tail latency under contention, persistence overhead or network hop was measured. Re-run `docker compose up` to regenerate `benchmark_metrics.json` on the target machine.
* **Synthetic scale data.** Replicated customers have identical feature distributions and timestamps; this tests storage and lookup scaling, not realistic key skew, hot keys or cache effects.
* **Synthetic timestamps.** Snapshot dates are generated, so point-in-time correctness is shown mechanically rather than on real histories; there is no temporal validation.
* **Single run and small groups.** One seed and split; seniors number 229 in the test set and the disparate-impact interval for the best method spans 0.70–0.98.
* **Fairness scope.** Mitigation was applied to `senior_citizen` only and shifts other slices (partner ratio fell to 0.51); intersectional groups, calibration, and a legal review of group-specific thresholds remain future work, as do in-processing methods (e.g. Fairlearn's reductions).
* **Detector scope.** Univariate tests only; add multivariate drift tests, streaming windows, Evidently AI reports and alert routing to the feature owner. Lineage mappings are declared by hand and validated against the registry; OpenLineage would capture ETL lineage automatically.

## 6. References
1. D. Sculley et al., "Hidden Technical Debt in Machine Learning Systems," NeurIPS, 2015.
2. S. Rabanser, S. Günnemann, Z. Lipton, "Failing Loudly: An Empirical Study of Methods for Detecting Dataset Shift," NeurIPS, 2019.
3. N. Siddiqi, *Credit Risk Scorecards*, Wiley, 2006 (Population Stability Index).
4. F. J. Massey, "The Kolmogorov–Smirnov Test for Goodness of Fit," J. Am. Stat. Assoc., 46(253), 1951.
5. P. Virtanen et al., "SciPy 1.0," Nature Methods, 17, 2020.
6. M. Hardt, E. Price, N. Srebro, "Equality of Opportunity in Supervised Learning," NeurIPS, 2016.
7. F. Kamiran, T. Calders, "Data Preprocessing Techniques for Classification without Discrimination," Knowledge and Information Systems, 33, 2012.
8. T. Chen, C. Guestrin, "XGBoost: A Scalable Tree Boosting System," KDD, 2016.
9. M. Mitchell et al., "Model Cards for Model Reporting," FAT*, 2019; T. Gebru et al., "Datasheets for Datasets," CACM, 2021.
10. Feast documentation, https://docs.feast.dev; Redis documentation, https://redis.io/docs.
11. IBM, "Telco Customer Churn" sample dataset, https://github.com/IBM/telco-customer-churn-on-icp4d.
