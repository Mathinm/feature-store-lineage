"""Train a baseline churn model from point-in-time-correct OFFLINE features, evaluate fairness, then serve
predictions from ONLINE features and verify online/offline parity + latency.

Both paths request the same Feast FeatureService (`churn_model_v1`), so the model sees one feature definition
in training and in serving.
"""
from __future__ import annotations

import json
import time

import numpy as np
import pandas as pd
from sklearn.metrics import f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier

import common as C

CAT, NUM = C.CATEGORICAL_FEATURES, C.CONTINUOUS_FEATURES
FEATURES = CAT + NUM
THRESHOLD = 0.5
SEED = 42


# ------------------------------------------------------------------ encoding shared by training AND serving
def fit_encoding(df: pd.DataFrame) -> dict:
    levels = {c: sorted(df[c].astype(str).unique().tolist()) for c in CAT}
    X = encode(df, {"levels": levels, "columns": None})
    return {"levels": levels, "columns": X.columns.tolist()}


def encode(df: pd.DataFrame, meta: dict) -> pd.DataFrame:
    parts = []
    for c in CAT:
        cat = pd.Categorical(df[c].astype(str), categories=meta["levels"][c])
        parts.append(pd.get_dummies(cat, prefix=c, dtype=float).set_axis(df.index))
    X = pd.concat(parts + [df[NUM].astype(float)], axis=1)
    return X if meta["columns"] is None else X.reindex(columns=meta["columns"], fill_value=0.0)


# ------------------------------------------------------------------ fairness
def slice_metrics(y, p, s, thr=THRESHOLD) -> dict:
    y, s = np.asarray(y), np.asarray(s)
    pred = (np.asarray(p) >= thr).astype(int)
    tp, fn = ((pred == 1) & (y == 1)).sum(), ((pred == 0) & (y == 1)).sum()
    fp, tn = ((pred == 1) & (y == 0)).sum(), ((pred == 0) & (y == 0)).sum()
    return {"n": int(len(y)), "base_rate": float(y.mean()), "selection_rate": float(pred.mean()),
            "tpr_recall": float(tp / max(tp + fn, 1)), "fpr": float(fp / max(fp + tn, 1)),
            "roc_auc": float(roc_auc_score(y, p)) if len(np.unique(y)) > 1 else None}


def fairness_report(test: pd.DataFrame, proba: np.ndarray) -> dict:
    out = {}
    for attr in C.SENSITIVE_FEATURES:
        groups = {str(g): slice_metrics(test.loc[m, "churn"], proba[m.values], None)
                  for g, m in ((g, test[attr].astype(str) == str(g)) for g in sorted(test[attr].astype(str).unique()))}
        sel = [v["selection_rate"] for v in groups.values()]
        tpr = [v["tpr_recall"] for v in groups.values()]
        out[attr] = {"groups": groups,
                     "demographic_parity_diff": float(max(sel) - min(sel)),
                     "disparate_impact_ratio": float(min(sel) / max(max(sel), 1e-9)),
                     "equal_opportunity_diff": float(max(tpr) - min(tpr))}
    return out


def train_model(X_tr, y_tr) -> XGBClassifier:
    spw = float((y_tr == 0).sum() / (y_tr == 1).sum())
    return XGBClassifier(n_estimators=300, max_depth=4, learning_rate=0.05, subsample=0.8, colsample_bytree=0.8,
                         scale_pos_weight=spw, eval_metric="logloss", random_state=SEED, n_jobs=2).fit(X_tr, y_tr)


def overall(y, p) -> dict:
    pred = (p >= THRESHOLD).astype(int)
    return {"roc_auc": float(roc_auc_score(y, p)), "f1": float(f1_score(y, pred)),
            "recall": float(recall_score(y, pred)), "precision": float(precision_score(y, pred)),
            "threshold": THRESHOLD}


# ------------------------------------------------------------------ main
def main() -> None:
    C.ensure_dirs()
    store = C.get_store()
    svc = store.get_feature_service(C.FEATURE_SERVICE)

    # 1) OFFLINE: point-in-time join of each customer's latest snapshot <= label timestamp
    entity_df = pd.read_parquet(C.OFFLINE_DIR / "labels.parquet")[["customer_id", "event_timestamp", "churn"]]
    t0 = time.perf_counter()
    hist = store.get_historical_features(entity_df=entity_df, features=svc).to_df()
    print(f"[train] offline PIT join: {hist.shape} in {time.perf_counter() - t0:.2f}s")
    assert hist[FEATURES].isna().sum().sum() == 0, "null features after point-in-time join"

    tr_ids, te_ids = train_test_split(hist.customer_id, test_size=0.2, stratify=hist.churn, random_state=SEED)
    train, test = hist[hist.customer_id.isin(tr_ids)].reset_index(drop=True), hist[hist.customer_id.isin(te_ids)].reset_index(drop=True)
    meta = fit_encoding(train)
    X_tr, X_te = encode(train, meta), encode(test, meta)
    model = train_model(X_tr, train.churn)
    proba = model.predict_proba(X_te)[:, 1]
    metrics = {"all_features": overall(test.churn, proba), "n_train": len(train), "n_test": len(test),
               "churn_rate_train": float(train.churn.mean())}
    fair = fairness_report(test, proba)

    # fairness-through-unawareness comparison: retrain without protected attributes
    keep = [c for c in X_tr.columns if not any(c == s or c.startswith(s + "_") for s in C.SENSITIVE_FEATURES)]
    m2 = train_model(X_tr[keep], train.churn)
    p2 = m2.predict_proba(X_te[keep])[:, 1]
    metrics["without_sensitive"] = overall(test.churn, p2)
    fair_unaware = fairness_report(test, p2)

    meta.update({"features": FEATURES, "feature_service": C.FEATURE_SERVICE, "threshold": THRESHOLD})
    model.save_model(str(C.ARTIFACT_DIR / "churn_xgb.json"))
    (C.ARTIFACT_DIR / "model_meta.json").write_text(json.dumps(meta, indent=2))
    train[["customer_id"] + FEATURES].to_parquet(C.ARTIFACT_DIR / "train_features.parquet", index=False)  # skew baseline
    test[["customer_id"] + FEATURES + ["churn"]].to_parquet(C.ARTIFACT_DIR / "test_features.parquet", index=False)
    imp = pd.Series(model.feature_importances_, index=X_tr.columns).sort_values(ascending=False).head(10)
    metrics["top_features"] = {k: float(v) for k, v in imp.items()}

    # 2) ONLINE: low-latency inference from the key-value store
    ids = test.customer_id.tolist()
    rng = np.random.default_rng(SEED)
    single = rng.choice(ids, 200, replace=False)
    lat = []
    for cid in single:
        t = time.perf_counter()
        online = store.get_online_features(features=svc, entity_rows=[{"customer_id": cid}]).to_df()
        _ = model.predict_proba(encode(online, meta))[:, 1]
        lat.append((time.perf_counter() - t) * 1000)
    batch_ids = rng.choice(ids, 100, replace=False).tolist()
    blat = []
    for _ in range(20):
        t = time.perf_counter()
        store.get_online_features(features=svc, entity_rows=[{"customer_id": c} for c in batch_ids]).to_df()
        blat.append((time.perf_counter() - t) * 1000)
    metrics["online_latency_ms"] = {"backend": C.online_backend(), "single_p50": float(np.percentile(lat, 50)),
                                    "single_p95": float(np.percentile(lat, 95)),
                                    "batch100_p50": float(np.percentile(blat, 50))}

    # 3) PARITY: online values must equal offline training values for the same entities
    on = store.get_online_features(features=svc, entity_rows=[{"customer_id": c} for c in ids]).to_df().set_index("customer_id")
    off = test.set_index("customer_id").loc[on.index]
    mism = {}
    for c in FEATURES:
        bad = (~np.isclose(on[c].astype(float), off[c].astype(float))).sum() if c in NUM else (on[c].astype(str) != off[c].astype(str)).sum()
        if bad:
            mism[c] = int(bad)
    metrics["online_offline_parity"] = {"entities": len(on), "mismatching_features": mism, "pass": not mism}
    online_pred = model.predict_proba(encode(on.reset_index(), meta))[:, 1]
    metrics["online_offline_prediction_max_abs_diff"] = float(np.abs(online_pred - proba[test.set_index("customer_id").index.get_indexer(on.index)]).max())

    (C.ARTIFACT_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2))
    (C.ARTIFACT_DIR / "fairness_report.json").write_text(json.dumps({"with_sensitive": fair, "without_sensitive": fair_unaware}, indent=2))

    print(json.dumps({k: metrics[k] for k in ("all_features", "without_sensitive", "online_latency_ms", "online_offline_parity")}, indent=2))
    for a, r in fair.items():
        print(f"[fairness] {a:15s} DP diff={r['demographic_parity_diff']:.3f}  DI ratio={r['disparate_impact_ratio']:.3f}  EO diff={r['equal_opportunity_diff']:.3f}")


if __name__ == "__main__":
    main()
