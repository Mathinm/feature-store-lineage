# Presentation outline (10 slides, ~9 minutes) and 3-minute demo script

All numbers come from `artifacts/*.json` produced by the repo's own scripts (Redis 7.0.15, 1 vCPU, local process; re-run `docker compose up` to regenerate them from the container before presenting).

## Slides
| # | Slide | Content | Time |
|---|---|---|---|
| 1 | Title | Feature Store with Lineage — Telco churn; BDS + Responsible AI | 0:30 |
| 2 | Problem & goals | Training-serving skew + unknown provenance in a churn model; goals G1–G5 | 0:50 |
| 3 | Data & architecture | IBM Telco (7,043 rows, 26.5% churn, no real PII); CSV → DuckDB raw tables → Parquet offline → Feast registry → Redis online → model + skew monitor; Docker Compose | 1:10 |
| 4 | Governance & lineage | Entity / 3 FeatureViews / FeatureService; owner, description, tags (`sensitive: demographic`, `PII: none`, `fairness_audit: required`); lineage graph + dictionary; registry-coverage check | 1:00 |
| 5 | **Responsible AI & Fairness** | Baseline: seniors flagged **66% vs 35%**, FPR **53% vs 23%**, DI ratio **0.52**. Mitigation: equalized-odds threshold for seniors **0.50 → 0.73** ⇒ DI **0.81**, equal-opportunity diff **0.191 → 0.023**, average-odds diff **0.248 → 0.037**; cost: effective AUC **−0.006**, recall **−0.048** (F1 0.605 → 0.602). Reweighing alone: DI 0.68. Demographic parity: DI 0.96 but recall 0.67 and TPR gap reversed. Caveats: 229 seniors (CI 0.70–0.98), uses protected attribute at decision time, partner DI 0.57 → 0.51 | 1:30 |
| 6 | Skew detection | PSI (<0.1 / 0.1–0.2 / >0.2), KS, chi-square, schema checks; clean PASS; schema FAIL (`total_charges`, `senior_citizen`); drift FAIL (`monthly_charges` PSI 0.96, `tenure` 0.31) | 1:00 |
| 7 | **Latency & Benchmark Results** | Live Redis 7.0.15: single fetch p50 / p95 / p99 = **3.39 / 5.68 / 6.45 ms**; 100-entity batch p50 **25.1 ms** (p99 85.8); 1,000-entity p50 362.5 ms; raw PING 0.058 ms; end-to-end fetch + predict p50 20.2 ms. Online = offline: 0 mismatches / 1,409. Scale 7k → 211k entities: ≈**9–10k records/s**, Redis **123 MB** (584 B/entity), fetch p50 **7.8–8.5 ms** flat | 1:30 |
| 8 | Big-data limits | Linear storage, flat latency; 1 / 2 / 4 loader workers = 10.0k / 9.2k / 7.9k records/s on 1 CPU (no speed-up); extrapolation 100M entities ≈ 8 h, 58 GB ⇒ need sharded Redis, multi-core, Spark/Dask | 0:50 |
| 9 | Limitations & next steps | Synthetic timestamps/scale data, single run, local Redis not container, senior-only mitigation, multivariate drift, OpenLineage | 0:30 |
| 10 | Conclusion | Single definition ⇒ zero skew by construction; detectors catch what remains; fairness gap measurable and reducible at small cost; repo + 3-min video | 0:30 |

## 3-minute demo script (screen recording, one terminal + browser)
**Before recording:** `docker compose --profile ui up -d --build` and wait until it finishes (the `feature-store` service runs the full pipeline once, including the benchmark, then exits; `fsl-redis`, `fsl-jupyter` and `fsl-feast-ui` stay up).

| Time | Screen / command | Narration |
|---|---|---|
| 0:00–0:25 | **1. Containers.** `docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"` → show `fsl-redis` (healthy), `fsl-feast-ui`, `fsl-jupyter` Up; `docker ps -a --filter name=fsl-pipeline` → Exited (0). | "Redis is our online store; the Feast pipeline container ran ingest, materialization, training, skew detection, fairness mitigation and the benchmark, and exited cleanly." |
| 0:25–0:55 | **2. Lineage.** Open `docs/lineage.md` (rendered Mermaid) or Feast UI at localhost:8890 → `customer_demographics`; point at red node and tags; show dictionary row for `senior_citizen` and `total_charges`. | "Every feature traces to a raw table and column. Demographic features carry `sensitive: demographic`, `PII: none`, `fairness_audit: required`, owner Retention-Data-Team." |
| 0:55–1:30 | **3. Skew alert.** `docker compose run --rm feature-store python skew_detection.py --scenario all` → highlight clean **PASS**, then **FAIL** lines: `total_charges` dtype mismatch (blank strings), `senior_citizen` re-encoded, `monthly_charges` PSI 0.96. | "Clean traffic passes. When the CRM sends TotalCharges as strings and prices rise 25%, the detector fires: schema failure plus severe PSI and KS." |
| 1:30–2:20 | **4. Fairness mitigation.** `docker compose run --rm feature-store python fairness_mitigation.py` → read the printed line "senior_citizen threshold for group '1': baseline 0.50 -> equalized-odds 0.73" and the table rows baseline vs `threshold_equalized_odds`. | "Seniors were flagged 67% of the time versus 35%. We lift their threshold from 0.50 to 0.73, fitted on a calibration split. Disparate impact goes from 0.52 to 0.81, average-odds difference from 0.25 to 0.04, for 0.006 effective AUC." |
| 2:20–2:50 | **5. Benchmark.** `cat artifacts/benchmark_metrics.json` (or the notebook figure `benchmark_scale.png`). | "Against live Redis a single fetch is 3.4 ms at p50 and 6.4 ms at p99; scaling to 211 thousand entities keeps latency flat while memory grows linearly to 123 MB." |
| 2:50–3:00 | Title / repo URL | "Governed features, lineage, skew alerts, mitigated fairness — all reproducible with one `docker compose up`." |

Recording tips: pre-pull images; use font ≥ 16 pt; if `docker compose run` is too slow for the time limit, pre-run the commands and show their saved terminal output. Quote the numbers from your own regenerated `artifacts/` files if they differ from those above.
