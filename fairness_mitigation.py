"""Active fairness mitigation for the churn model (protected attribute: SeniorCitizen by default).

Problem (see model card): the baseline flags 66% of senior citizens vs 35% of others and has a false-positive rate of
52% vs 22%. This script implements and compares four mitigations, all evaluated on the SAME held-out test customers:

  reweighing      pre-processing   Kamiran & Calders (2012) instance weights w(a,y) = P(a)P(y)/P(a,y), then retrain
  threshold_eo    post-processing  per-group decision threshold chosen on a calibration split to equalise TPR and FPR
                                   (equalized odds, Hardt et al. 2016) - reference group keeps threshold 0.5
  threshold_dp    post-processing  per-group threshold chosen so selection rates match (demographic parity)
  reweigh+eo      both             reweighed model followed by equalized-odds thresholds

Protocol: the training set is split 70/30 into FIT and CALIBRATION (stratified by churn x group). Models are fitted on FIT,
thresholds are fitted on CALIBRATION, nothing is tuned on the test set. 95% bootstrap intervals (test resampling) are reported.

Metrics (group a vs reference group r):
  disparate_impact_ratio     min(sel_a, sel_r) / max(sel_a, sel_r)            (>= 0.8 passes the four-fifths rule)
  equal_opportunity_diff     |TPR_a - TPR_r|
  average_odds_difference    0.5 * (|FPR_a - FPR_r| + |TPR_a - TPR_r|)
  equalized_odds_difference  max(|FPR_a - FPR_r|, |TPR_a - TPR_r|)            (Fairlearn definition)
  roc_auc                    ranking quality of the model; for threshold methods the "effective" AUC is computed on the
                             group-shifted score  s - (t_g - 0.5)  so that the cost of the group-specific cut-offs is visible.

NOTE: group-specific thresholds use the protected attribute at decision time (disparate treatment); see docs/model_card.md.
Output: artifacts/fairness_mitigated_report.json, artifacts/mitigated_thresholds.json
"""
from __future__ import annotations

import argparse
import json

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier

import common as C
from train_and_serve import CAT, FEATURES, NUM, SEED, encode  # noqa: F401

GRID = np.round(np.arange(0.05, 0.951, 0.01), 2)


# ----------------------------------------------------------------------------- data / models
def load() -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    meta = json.loads((C.ARTIFACT_DIR / "model_meta.json").read_text())
    labels = pd.read_parquet(C.OFFLINE_DIR / "labels.parquet")[["customer_id", "churn"]]
    train = pd.read_parquet(C.ARTIFACT_DIR / "train_features.parquet").merge(labels, on="customer_id")
    test = pd.read_parquet(C.ARTIFACT_DIR / "test_features.parquet")
    return train, test, meta


def fit_xgb(X, y, w=None) -> XGBClassifier:
    w = np.ones(len(y)) if w is None else np.asarray(w)
    spw = float(w[y == 0].sum() / w[y == 1].sum())
    return XGBClassifier(n_estimators=300, max_depth=4, learning_rate=0.05, subsample=0.8, colsample_bytree=0.8,
                         scale_pos_weight=spw, eval_metric="logloss", random_state=SEED, n_jobs=2).fit(X, y, sample_weight=w)


def reweighing_weights(y: np.ndarray, a: np.ndarray) -> np.ndarray:
    """Kamiran & Calders: weight each (a, y) cell by expected / observed frequency so that a and y are independent."""
    w = np.ones(len(y))
    for av in np.unique(a):
        for yv in (0, 1):
            m = (a == av) & (y == yv)
            if m.any():
                w[m] = (a == av).mean() * (y == yv).mean() / m.mean()
    return w


# ----------------------------------------------------------------------------- metrics
def rates(y, pred) -> tuple[float, float, float]:
    tpr = ((pred == 1) & (y == 1)).sum() / max((y == 1).sum(), 1)
    fpr = ((pred == 1) & (y == 0)).sum() / max((y == 0).sum(), 1)
    return float(tpr), float(fpr), float(pred.mean())


def fairness(y, pred, a, ref) -> dict:
    groups = [g for g in np.unique(a) if g != ref]
    g = groups[0]
    tr, fr, sr = rates(y[a == ref], pred[a == ref])
    tg, fg, sg = rates(y[a == g], pred[a == g])
    return {"selection_rate": {str(ref): sr, str(g): sg}, "tpr": {str(ref): tr, str(g): tg}, "fpr": {str(ref): fr, str(g): fg},
            "disparate_impact_ratio": min(sr, sg) / max(max(sr, sg), 1e-9), "demographic_parity_diff": abs(sg - sr),
            "equal_opportunity_diff": abs(tg - tr), "average_odds_difference": 0.5 * (abs(fg - fr) + abs(tg - tr)),
            "equalized_odds_difference": max(abs(fg - fr), abs(tg - tr))}


def decide(proba, a, thr: dict) -> np.ndarray:
    t = np.array([thr[str(v)] for v in a])
    return (proba >= t).astype(int)


def effective_score(proba, a, thr: dict) -> np.ndarray:
    return proba - (np.array([thr[str(v)] for v in a]) - 0.5)


def evaluate(name, y, proba, a, ref, thr: dict, extra_attrs: dict, note="") -> dict:
    pred = decide(proba, a, thr)
    out = {"method": name, "thresholds": thr, "note": note,
           "overall": {"roc_auc_model": float(roc_auc_score(y, proba)), "roc_auc_effective": float(roc_auc_score(y, effective_score(proba, a, thr))),
                       "f1": float(f1_score(y, pred)), "recall": float(recall_score(y, pred)), "precision": float(precision_score(y, pred)),
                       "accuracy": float(accuracy_score(y, pred)), "positive_rate": float(pred.mean())},
           "fairness_target": fairness(y, pred, a, ref)}
    # collateral effect on the other protected attributes (decisions identical, only the grouping changes)
    out["collateral"] = {k: {m: round(v, 4) for m, v in fairness(y, pred, vals, sorted(np.unique(vals))[0]).items() if not isinstance(v, dict)}
                         for k, vals in extra_attrs.items()}
    return out


def bootstrap_ci(y, proba, a, ref, thr, n_boot=300, seed=SEED) -> dict:
    rng, n = np.random.default_rng(seed), len(y)
    vals = {k: [] for k in ("disparate_impact_ratio", "equal_opportunity_diff", "average_odds_difference")}
    pred = decide(proba, a, thr)
    for _ in range(n_boot):
        i = rng.integers(0, n, n)
        if len(np.unique(a[i])) < 2:
            continue
        f = fairness(y[i], pred[i], a[i], ref)
        for k in vals:
            vals[k].append(f[k])
    return {k: [round(float(np.percentile(v, 2.5)), 3), round(float(np.percentile(v, 97.5)), 3)] for k, v in vals.items()}


# ----------------------------------------------------------------------------- threshold fitting (on CALIBRATION data only)
def fit_threshold(y, proba, a, ref, target_group, objective: str) -> float:
    """Pick the target group's threshold on a grid; the reference group's threshold stays 0.5."""
    r = a == ref
    tr, fr, sr = rates(y[r], (proba[r] >= 0.5).astype(int))
    g = a == target_group
    best, best_cost = 0.5, np.inf
    for t in GRID:
        tg, fg, sg = rates(y[g], (proba[g] >= t).astype(int))
        cost = (abs(tg - tr) + abs(fg - fr)) if objective == "equalized_odds" else abs(sg - sr)
        cost += 1e-6 * abs(t - 0.5)                      # tie-break: stay close to the default
        if cost < best_cost:
            best, best_cost = float(t), cost
    return best


# ----------------------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--attribute", default="senior_citizen", choices=["senior_citizen", "partner", "dependents", "gender"])
    ap.add_argument("--bootstrap", type=int, default=300)
    args = ap.parse_args()

    train, test, meta = load()
    attr = args.attribute
    a_train, a_test = train[attr].astype(str).to_numpy(), test[attr].astype(str).to_numpy()
    strata = train.churn.astype(str) + "_" + train[attr].astype(str)
    fit_idx, cal_idx = train_test_split(np.arange(len(train)), test_size=0.30, stratify=strata, random_state=SEED)
    fit, cal = train.iloc[fit_idx].reset_index(drop=True), train.iloc[cal_idx].reset_index(drop=True)
    a_fit, a_cal = a_train[fit_idx], a_train[cal_idx]
    X_fit, X_cal, X_te = encode(fit, meta), encode(cal, meta), encode(test, meta)
    y_fit, y_cal, y_te = fit.churn.to_numpy(), cal.churn.to_numpy(), test.churn.to_numpy()
    extra = {k: test[k].astype(str).to_numpy() for k in C.SENSITIVE_FEATURES}

    base = fit_xgb(X_fit, y_fit)
    p_cal, p_te = base.predict_proba(X_cal)[:, 1], base.predict_proba(X_te)[:, 1]
    sel_by_group = {g: float((p_te[a_test == g] >= 0.5).mean()) for g in np.unique(a_test)}
    ref = min(sel_by_group, key=sel_by_group.get)           # reference = group the baseline flags least
    target = [g for g in np.unique(a_test) if g != ref][0]
    print(f"[mitigate] attribute={attr}: reference group={ref}, mitigated group={target}; baseline selection rates {sel_by_group}")

    default = {str(ref): 0.5, str(target): 0.5}
    results = [evaluate("baseline_xgboost", y_te, p_te, a_test, ref, default, extra, "global threshold 0.5, fitted on FIT split")]

    # post-processing on the baseline scores
    thr_eo = {str(ref): 0.5, str(target): fit_threshold(y_cal, p_cal, a_cal, ref, target, "equalized_odds")}
    thr_dp = {str(ref): 0.5, str(target): fit_threshold(y_cal, p_cal, a_cal, ref, target, "demographic_parity")}
    results.append(evaluate("threshold_equalized_odds", y_te, p_te, a_test, ref, thr_eo, extra, "per-group threshold, TPR/FPR matched on calibration split"))
    results.append(evaluate("threshold_demographic_parity", y_te, p_te, a_test, ref, thr_dp, extra, "per-group threshold, selection rate matched on calibration split"))

    # pre-processing: reweighing, then (optionally) thresholds on the reweighed model
    w = reweighing_weights(y_fit, a_fit)
    rw = fit_xgb(X_fit, y_fit, w)
    prw_cal, prw_te = rw.predict_proba(X_cal)[:, 1], rw.predict_proba(X_te)[:, 1]
    results.append(evaluate("reweighing", y_te, prw_te, a_test, ref, default, extra, "Kamiran-Calders weights, global threshold 0.5"))
    thr_rw_eo = {str(ref): 0.5, str(target): fit_threshold(y_cal, prw_cal, a_cal, ref, target, "equalized_odds")}
    results.append(evaluate("reweighing+threshold_eo", y_te, prw_te, a_test, ref, thr_rw_eo, extra, "reweighed model + equalized-odds threshold"))

    probas = {"baseline_xgboost": p_te, "threshold_equalized_odds": p_te, "threshold_demographic_parity": p_te,
              "reweighing": prw_te, "reweighing+threshold_eo": prw_te}
    base_auc = results[0]["overall"]["roc_auc_model"]
    table = []
    for r in results:
        f, o = r["fairness_target"], r["overall"]
        ci = bootstrap_ci(y_te, probas[r["method"]], a_test, ref, r["thresholds"], args.bootstrap)
        r["bootstrap_95ci"] = ci
        table.append({"method": r["method"], f"threshold_{target}": r["thresholds"][str(target)],
                      "selection_rate_ref": round(f["selection_rate"][str(ref)], 3), "selection_rate_target": round(f["selection_rate"][str(target)], 3),
                      "fpr_ref": round(f["fpr"][str(ref)], 3), "fpr_target": round(f["fpr"][str(target)], 3),
                      "tpr_ref": round(f["tpr"][str(ref)], 3), "tpr_target": round(f["tpr"][str(target)], 3),
                      "disparate_impact_ratio": round(f["disparate_impact_ratio"], 3), "equal_opportunity_diff": round(f["equal_opportunity_diff"], 3),
                      "average_odds_difference": round(f["average_odds_difference"], 3), "equalized_odds_difference": round(f["equalized_odds_difference"], 3),
                      "roc_auc_effective": round(o["roc_auc_effective"], 4), "roc_auc_degradation_vs_baseline": round(base_auc - o["roc_auc_effective"], 4),
                      "f1": round(o["f1"], 3), "recall": round(o["recall"], 3), "precision": round(o["precision"], 3),
                      "di_95ci": ci["disparate_impact_ratio"], "aod_95ci": ci["average_odds_difference"]})

    report = {"attribute": attr, "reference_group": ref, "mitigated_group": target, "n_fit": len(fit), "n_calibration": len(cal), "n_test": len(test),
              "n_test_by_group": {g: int((a_test == g).sum()) for g in np.unique(a_test)}, "protocol": "fit/cal split of training data; test used only for reporting",
              "comparison_table": table, "details": results,
              "caveat": "Group-specific thresholds use the protected attribute at decision time; small target group => wide intervals."}
    (C.ARTIFACT_DIR / "fairness_mitigated_report.json").write_text(json.dumps(report, indent=2))
    (C.ARTIFACT_DIR / "mitigated_thresholds.json").write_text(json.dumps(
        {"attribute": attr, "equalized_odds": thr_eo, "demographic_parity": thr_dp, "reweighing_equalized_odds": thr_rw_eo}, indent=2))

    print(f"[mitigate] {attr} threshold for group '{target}': baseline 0.50 -> equalized-odds {thr_eo[str(target)]:.2f} | demographic-parity {thr_dp[str(target)]:.2f}")
    print(f"\n{'method':32s}{'DI':>7s}{'EOpp':>7s}{'AOD':>7s}{'EODmax':>8s}{'selR/selT':>12s}{'fprR/fprT':>12s}{'AUCeff':>8s}{'dAUC':>8s}{'F1':>7s}{'rec':>7s}")
    for t in table:
        print(f"{t['method']:32s}{t['disparate_impact_ratio']:7.3f}{t['equal_opportunity_diff']:7.3f}{t['average_odds_difference']:7.3f}{t['equalized_odds_difference']:8.3f}"
              f"{t['selection_rate_ref']:6.2f}/{t['selection_rate_target']:<5.2f}{t['fpr_ref']:6.2f}/{t['fpr_target']:<5.2f}{t['roc_auc_effective']:8.4f}"
              f"{t['roc_auc_degradation_vs_baseline']:8.4f}{t['f1']:7.3f}{t['recall']:7.3f}")


if __name__ == "__main__":
    main()
