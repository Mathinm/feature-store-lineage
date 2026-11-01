# Model Card — Telco Churn Baseline (XGBoost)

**Objective:** binary classification of whether a customer churns. **Model:** `XGBClassifier` (300 trees, depth 4, lr 0.05, subsample/colsample 0.8, `scale_pos_weight` = neg/pos). 
**Inputs:** 21 features from Feast `FeatureService churn_model_v1` (16 categorical, 5 numeric; one-hot encoded). **Output:** churn probability, label at threshold 0.5.
**Owner:** Retention-Data-Team. **Artifacts:** `artifacts/churn_xgb.json`, `model_meta.json`.

## Intended use
Rank customers for retention outreach in a classroom setting. Out of scope: automated adverse actions, pricing, or any use on real customers without a full fairness and privacy review.

## Training / evaluation data
5,634 train / 1,409 test customers (stratified, seed 42); training features come from the Feast offline store via point-in-time join. See `data_card.md`.

## Performance (test set, threshold 0.5, single run)
| Variant | ROC-AUC | F1 | Recall | Precision |
|---|---|---|---|---|
| All features (incl. sensitive) | 0.835 | 0.613 | 0.765 | 0.512 |
| Without protected attributes | 0.837 | 0.613 | 0.770 | 0.510 |

Top importances: Month-to-month contract (0.35), Fiber-optic internet (0.12), no tech support (0.06), no online security (0.04).
Serving: online features fetched from Redis reproduce offline values exactly (0 mismatches over 1,409 entities; prediction difference 0.0).
Measured on a live Redis 7.0.15 server (1 vCPU, local process, not the Docker container): single-entity feature fetch p50 3.39 / p95 5.68 / p99 6.45 ms; 100-entity fetch p50 25.1 ms; fetch + encode + predict end-to-end p50 20.2 / p95 32.4 ms (`artifacts/benchmark_metrics.json`, `metrics.json`).

## Fairness evaluation (test set, model with all features)
| Attribute | Group (n) | Base rate | Selection rate | Recall (TPR) | FPR | AUC |
|---|---|---|---|---|---|---|
| gender | Female (733) | .252 | .398 | .784 | .268 | .837 |
| | Male (676) | .280 | .395 | .746 | .259 | .835 |
| SeniorCitizen | 0 (1180) | .246 | .346 | .724 | .222 | .844 |
| | 1 (229) | .367 | .659 | .905 | .517 | .781 |
| Partner | No (731) | .326 | .501 | .815 | .349 | .816 |
| | Yes (678) | .201 | .285 | .676 | .186 | .841 |
| Dependents | No (1001) | .304 | .470 | .789 | .330 | .808 |
| | Yes (408) | .172 | .218 | .657 | .127 | .879 |

| Attribute | Demographic-parity diff | Disparate-impact ratio | Equal-opportunity diff |
|---|---|---|---|
| gender | 0.003 | 0.99 | 0.038 |
| SeniorCitizen | 0.314 | 0.52 | 0.181 |
| Partner | 0.216 | 0.57 | 0.139 |
| Dependents | 0.251 | 0.47 | 0.132 |

**Reading:** gender is balanced. Seniors are flagged far more often (66% vs 35%) with a much higher false-positive rate (52% vs 22%) — a cost if outreach is intrusive or discounts are given. Part of the gap reflects genuinely different base rates, but not all of it (FPR gap). 
**Mitigation tried (1):** dropping protected attributes barely changes AUC (0.837) and does not close the gaps (senior parity difference 0.256) because contract, tenure and charges act as proxies.

### Active mitigation for SeniorCitizen (`fairness_mitigation.py`)
Fit/calibration/test protocol (3,943 / 1,691 / 1,409; 229 test seniors); baseline retrained on the fit split (AUC 0.831).

| Method | Senior threshold | Disparate-impact ratio | Equal-opp. diff | Average-odds diff | Senior FPR | Effective AUC | F1 | Recall |
|---|---|---|---|---|---|---|---|---|
| Baseline | 0.50 | 0.518 | 0.191 | 0.248 | 0.53 | 0.831 | 0.605 | 0.757 |
| Reweighing | 0.50 | 0.681 | 0.058 | 0.097 | 0.37 | 0.829 | 0.605 | 0.741 |
| **Equalized-odds thresholds** | **0.73** | **0.808** | **0.023** | **0.037** | 0.28 | 0.825 | 0.602 | 0.709 |
| Demographic-parity thresholds | 0.81 | 0.960 | 0.178 | 0.095 | 0.21 | 0.818 | 0.587 | 0.674 |

**Recommended configuration:** equalized-odds thresholds (senior 0.73, others 0.50): −0.006 effective AUC and −0.048 recall for an 85% lower average-odds difference. Bootstrap 95% intervals are wide (DI 0.70–0.98) because of the small senior group. Side effects on other slices: partner DI 0.57 → 0.51, dependents 0.48 → 0.52, gender 0.99 → 0.95. **Caveat:** group-specific thresholds use a protected attribute at decision time (disparate treatment) and need legal/policy review before any real use.

## Failure conditions / limitations
* Training-serving skew: severe PSI (> 0.2) or schema breaks in `total_charges`, `senior_citizen`, `monthly_charges`, `tenure` invalidate predictions; the skew gate (`skew_detection.py --fail-on-alert`) should block serving.
* Cold start: customers with tenure 0 have imputed `total_charges = 0` — the least reliable segment.
* No temporal validation, no calibration analysis, no hyper-parameter search; one random seed, so differences of ±0.01 AUC are within noise. Mitigation covers SeniorCitizen only; partner and dependents gaps remain.
* Small subgroup (seniors, n = 229) → wide confidence intervals on slice metrics.
