"""Training-serving skew detection (pure Python / NumPy / SciPy).

Baseline  = feature frame the model was TRAINED on (artifacts/train_features.parquet, from the Feast offline store).
Live      = features fetched at SERVING time from the Feast ONLINE store (+ injected failure modes for the demo).

Checks per feature
  * Schema/type check   : dtype family, null-rate change, unparseable strings in numeric columns, unseen categories
  * PSI                 : <0.1 stable | 0.1-0.2 moderate | >0.2 severe  (quantile bins from the baseline)
  * KS 2-sample test    : continuous features   (statistic D = effect size, p-value)
  * Chi-square test     : categorical features  (2 x K contingency table, Cramer's V = effect size)

Decision rule
  FAIL  if any schema issue or PSI > 0.2          WARN if 0.1 <= PSI <= 0.2 or (p < alpha and effect size > 0.1)
  PASS  otherwise.   Overall status = worst feature status.  `--fail-on-alert` exits 1 on FAIL (CI gate).
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from scipy import stats

import common as C

PSI_STABLE, PSI_SEVERE = 0.1, 0.2
EPS = 1e-4
ALPHA = 0.01
EFFECT_MIN = 0.1


# ----------------------------------------------------------------------------- statistics
def _psi(e_pct: np.ndarray, a_pct: np.ndarray) -> float:
    e, a = np.clip(e_pct, EPS, None), np.clip(a_pct, EPS, None)
    return float(np.sum((a - e) * np.log(a / e)))


def psi_continuous(expected, actual, bins: int = 10) -> float:
    """PSI with bin edges taken from baseline quantiles, so each baseline bin holds ~1/bins of the mass."""
    expected, actual = np.asarray(expected, float), np.asarray(actual, float)
    edges = np.unique(np.quantile(expected, np.linspace(0, 1, bins + 1)))
    edges[0], edges[-1] = -np.inf, np.inf
    e = np.histogram(expected, edges)[0] / len(expected)
    a = np.histogram(actual, edges)[0] / len(actual)
    return _psi(e, a)


def psi_categorical(expected, actual) -> float:
    cats = sorted(set(map(str, expected)) | set(map(str, actual)))
    e = pd.Series(list(map(str, expected))).value_counts(normalize=True).reindex(cats, fill_value=0).values
    a = pd.Series(list(map(str, actual))).value_counts(normalize=True).reindex(cats, fill_value=0).values
    return _psi(e, a)


def psi_level(v: float) -> str:
    return "stable" if v < PSI_STABLE else "moderate" if v <= PSI_SEVERE else "severe"


def ks_test(expected, actual) -> dict:
    r = stats.ks_2samp(np.asarray(expected, float), np.asarray(actual, float))
    return {"test": "ks_2samp", "statistic": float(r.statistic), "p_value": float(r.pvalue), "effect_size": float(r.statistic)}


def chi_square_test(expected, actual) -> dict:
    cats = sorted(set(map(str, expected)) | set(map(str, actual)))
    table = np.vstack([pd.Series(list(map(str, s))).value_counts().reindex(cats, fill_value=0).values for s in (expected, actual)])
    table = table[:, table.sum(axis=0) > 0]
    if table.shape[1] < 2:
        return {"test": "chi2_contingency", "statistic": 0.0, "p_value": 1.0, "effect_size": 0.0}
    chi2, p, _, _ = stats.chi2_contingency(table)
    return {"test": "chi2_contingency", "statistic": float(chi2), "p_value": float(p),
            "effect_size": float(np.sqrt(chi2 / table.sum()))}  # Cramer's V for a 2 x K table


# ----------------------------------------------------------------------------- schema / type checks
def schema_check(base: pd.DataFrame, live: pd.DataFrame, features: list[str]) -> list[dict]:
    issues = []
    for f in features:
        if f not in live.columns:
            issues.append({"feature": f, "issue": "missing_column"}); continue
        b_num, l_num = pd.api.types.is_numeric_dtype(base[f]), pd.api.types.is_numeric_dtype(live[f])
        if b_num != l_num:
            msg = {"feature": f, "issue": "dtype_mismatch", "expected": str(base[f].dtype), "actual": str(live[f].dtype)}
            if b_num and not l_num:
                parsed = pd.to_numeric(live[f], errors="coerce")
                msg["unparseable_values"] = int(parsed.isna().sum())
                msg["examples"] = live.loc[parsed.isna(), f].astype(str).str.replace(" ", "<space>").unique()[:3].tolist()
            issues.append(msg)
        null_delta = float(live[f].isna().mean() - base[f].isna().mean())
        if abs(null_delta) > 0.01:
            issues.append({"feature": f, "issue": "null_rate_shift", "delta": round(null_delta, 4)})
        if not b_num:
            unseen = sorted(set(live[f].dropna().astype(str)) - set(base[f].dropna().astype(str)))
            if unseen:
                issues.append({"feature": f, "issue": "unseen_categories", "values": unseen[:5]})
    return issues


# ----------------------------------------------------------------------------- report
def compare(base: pd.DataFrame, live: pd.DataFrame, scenario: str, alpha: float = ALPHA) -> dict:
    features = C.CATEGORICAL_FEATURES + C.CONTINUOUS_FEATURES
    issues = schema_check(base, live, features)
    bad_schema = {i["feature"] for i in issues if i["issue"] in ("dtype_mismatch", "missing_column", "unseen_categories")}
    rows = {}
    for f in features:
        if f not in live.columns:
            rows[f] = {"kind": "n/a", "status": "FAIL", "reason": "missing column"}; continue
        if f in C.CONTINUOUS_FEATURES:
            lv = pd.to_numeric(live[f], errors="coerce")                       # unparseable -> NaN, counted by schema_check
            lv_clean = lv.dropna()
            psi = psi_continuous(base[f].dropna(), lv_clean) if len(lv_clean) else float("inf")
            test = ks_test(base[f].dropna(), lv_clean) if len(lv_clean) else {"test": "ks_2samp", "statistic": 1.0, "p_value": 0.0, "effect_size": 1.0}
            kind = "continuous"
        else:
            psi, test, kind = psi_categorical(base[f], live[f]), chi_square_test(base[f], live[f]), "categorical"
        stat_alert = test["p_value"] < alpha and test["effect_size"] > EFFECT_MIN
        status = "FAIL" if (psi > PSI_SEVERE or f in bad_schema) else "WARN" if (psi >= PSI_STABLE or stat_alert) else "PASS"
        rows[f] = {"kind": kind, "psi": round(psi, 4), "psi_level": psi_level(psi), **{k: (round(v, 6) if isinstance(v, float) else v) for k, v in test.items()},
                   "stat_alert": bool(stat_alert), "status": status}
    order = {"PASS": 0, "WARN": 1, "FAIL": 2}
    overall = max((r["status"] for r in rows.values()), key=order.get, default="PASS")
    if any(i["issue"] in ("dtype_mismatch", "missing_column", "unseen_categories") for i in issues):
        overall = "FAIL"
    alerts = [f"{f}: {r['status']} (PSI={r.get('psi')}, {r.get('test')} p={r.get('p_value')})" for f, r in rows.items() if r["status"] != "PASS"]
    alerts += [f"schema: {i['feature']} -> {i['issue']} {({k: v for k, v in i.items() if k not in ('feature', 'issue')})}" for i in issues]
    return {"scenario": scenario, "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "baseline_rows": len(base), "live_rows": len(live), "thresholds": {"psi_stable": PSI_STABLE, "psi_severe": PSI_SEVERE, "alpha": alpha, "min_effect": EFFECT_MIN},
            "overall_status": overall, "schema_issues": issues, "features": rows, "alerts": alerts}


def print_report(rep: dict) -> None:
    print(f"\n=== Skew report [{rep['scenario']}]  ->  {rep['overall_status']}  (baseline n={rep['baseline_rows']}, live n={rep['live_rows']}) ===")
    print(f"{'feature':22s}{'kind':12s}{'PSI':>8s}  {'level':9s}{'test':18s}{'stat':>9s}{'p-value':>10s}  status")
    for f, r in rep["features"].items():
        print(f"{f:22s}{r['kind']:12s}{r.get('psi', float('nan')):8.4f}  {r.get('psi_level', ''):9s}{r.get('test', ''):18s}{r.get('statistic', float('nan')):9.3f}{r.get('p_value', float('nan')):10.2e}  {r['status']}")
    for a in rep["alerts"]:
        print("ALERT ->", a)


# ----------------------------------------------------------------------------- data sources + failure injection
def load_baseline() -> pd.DataFrame:
    return pd.read_parquet(C.ARTIFACT_DIR / "train_features.parquet")


def fetch_online(n: int = 1200, seed: int = 11) -> pd.DataFrame:
    """Live frame: features served by the Feast online store for a random sample of customers."""
    store = C.get_store()
    pool = pd.read_parquet(C.ARTIFACT_DIR / "test_features.parquet").customer_id   # held-out customers = 'new traffic'
    ids = pool.sample(min(n, len(pool)), random_state=seed).tolist()
    df = store.get_online_features(features=store.get_feature_service(C.FEATURE_SERVICE),
                                   entity_rows=[{"customer_id": i} for i in ids]).to_df()
    return df[["customer_id"] + C.CATEGORICAL_FEATURES + C.CONTINUOUS_FEATURES]


def inject_schema_skew(live: pd.DataFrame) -> pd.DataFrame:
    """Failure mode 1 - upstream CRM change: TotalCharges serialised as strings with blank ' ' for new customers
    (the real IBM quirk, now leaking into serving) and SeniorCitizen re-encoded from 0/1 to 'No'/'Yes'."""
    d = live.copy()
    tc = d["total_charges"].round(2).astype(str)
    tc[d["tenure"] <= 2] = " "
    d["total_charges"] = tc
    d["senior_citizen"] = d["senior_citizen"].map({0: "No", 1: "Yes"})
    return d


def naive_coercion(d: pd.DataFrame) -> pd.DataFrame:
    """What a careless serving layer does after the schema break: coerce + impute with the MEDIAN (training used 0.0)."""
    out = d.copy()
    out["total_charges"] = pd.to_numeric(out["total_charges"], errors="coerce")
    out["total_charges"] = out["total_charges"].fillna(out["total_charges"].median())
    return out


def inject_drift(live: pd.DataFrame, seed: int = 5) -> pd.DataFrame:
    """Failure mode 2 - distribution / value skew: +25% price change, promo cohort of new customers,
    and a shift of payment method toward Electronic check."""
    rng = np.random.default_rng(seed)
    d = live.copy()
    d["monthly_charges"] = (d["monthly_charges"] * 1.25 + rng.normal(0, 2, len(d))).round(2)
    promo = rng.random(len(d)) < 0.40
    d.loc[promo, "tenure"] = rng.integers(0, 12, promo.sum())
    d.loc[promo, "total_charges"] = (d.loc[promo, "tenure"] * d.loc[promo, "monthly_charges"]).round(2)
    d["avg_monthly_spend"] = np.where(d["tenure"] > 0, d["total_charges"] / d["tenure"].clip(lower=1), d["monthly_charges"])
    ec = rng.random(len(d)) < 0.30
    d.loc[ec, "payment_method"] = "Electronic check"
    return d


def run(scenario: str, n: int = 1200, alpha: float = ALPHA) -> list[dict]:
    base, live = load_baseline(), fetch_online(n)
    reports = []
    if scenario in ("clean", "all"):
        reports.append(compare(base, live, "clean_online_vs_train", alpha))
    if scenario in ("schema", "all"):
        broken = inject_schema_skew(live)
        rep = compare(base, broken, "schema_type_skew", alpha)
        rep["after_naive_coercion"] = compare(base, naive_coercion(broken), "schema_skew_after_median_imputation", alpha)["features"]["total_charges"]
        reports.append(rep)
    if scenario in ("drift", "all"):
        reports.append(compare(base, inject_drift(live), "distribution_drift", alpha))
    for rep in reports:
        (C.ARTIFACT_DIR / f"skew_report_{rep['scenario']}.json").write_text(json.dumps(rep, indent=2, default=str))
        print_report(rep)
    return reports


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scenario", choices=["clean", "schema", "drift", "all"], default="all")
    ap.add_argument("--n", type=int, default=1200, help="online sample size (max = held-out test set, 1409)")
    ap.add_argument("--alpha", type=float, default=ALPHA)
    ap.add_argument("--fail-on-alert", action="store_true", help="exit 1 if any report is FAIL (CI gate)")
    args = ap.parse_args()
    reports = run(args.scenario, args.n, args.alpha)
    if args.fail_on_alert and any(r["overall_status"] == "FAIL" for r in reports):
        sys.exit(1)


if __name__ == "__main__":
    main()
