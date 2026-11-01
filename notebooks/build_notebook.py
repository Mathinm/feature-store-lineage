"""Builds notebooks/results.ipynb (run: python notebooks/build_notebook.py)."""
import nbformat as nbf

nb = nbf.v4.new_notebook()
md, code = nbf.v4.new_markdown_cell, nbf.v4.new_code_cell
nb.cells = [
 md("# Feature Store with Lineage — Results Notebook\nTelco churn · Feast (offline Parquet/DuckDB + online Redis) · skew detection · lineage · fairness.\n"
    "Run the pipeline first (`docker compose up --build` or `make local`)."),
 code("import os, sys, json\nsys.path.insert(0, os.path.abspath('..')); os.chdir(os.path.abspath('..'))\n"
      "os.environ.setdefault('FEAST_ONLINE', 'redis'); os.environ.setdefault('REDIS_CONNECTION', 'redis:6379')\n"
      "import pandas as pd, numpy as np, matplotlib.pyplot as plt\nimport common as C, skew_detection as S\nstore = C.get_store()\nprint('online backend:', C.online_backend())"),
 md("## 1. Registry & governance metadata"),
 code("rows = [dict(view=fv.name, owner=fv.owner, n_features=len(fv.features), sensitive=fv.tags.get('sensitive'), PII=fv.tags.get('PII'), fairness_audit=fv.tags.get('fairness_audit'), source_table=fv.tags.get('source_table')) for fv in store.list_feature_views()]\npd.DataFrame(rows)"),
 md("## 2. Offline (point-in-time) vs online features for the same customers"),
 code("svc = store.get_feature_service(C.FEATURE_SERVICE)\nlabels = pd.read_parquet(C.OFFLINE_DIR/'labels.parquet').head(5)\n"
      "off = store.get_historical_features(entity_df=labels[['customer_id','event_timestamp']], features=svc).to_df()\n"
      "on = store.get_online_features(features=svc, entity_rows=[{'customer_id': c} for c in labels.customer_id]).to_df()\n"
      "print('OFFLINE'); display(off.iloc[:, :8]); print('ONLINE'); display(on.iloc[:, :8])"),
 md("## 3. Model performance, latency and online/offline parity"),
 code("m = json.load(open(C.ARTIFACT_DIR/'metrics.json'))\npd.DataFrame({'all features': m['all_features'], 'without sensitive': m['without_sensitive']}).T"),
 code("print(json.dumps({k: m[k] for k in ['online_latency_ms','online_offline_parity']}, indent=2))"),
 md("## 4. Fairness across demographic slices"),
 code("fr = json.load(open(C.ARTIFACT_DIR/'fairness_report.json'))\n"
      "tab = pd.DataFrame({a: {'DP diff': r['demographic_parity_diff'], 'DI ratio': r['disparate_impact_ratio'], 'EO diff': r['equal_opportunity_diff']} for a, r in fr['with_sensitive'].items()}).T\ntab.round(3)"),
 code("rows=[]\nfor a, r in fr['with_sensitive'].items():\n    for g, v in r['groups'].items(): rows.append(dict(attribute=a, group=g, n=v['n'], base_rate=v['base_rate'], selection_rate=v['selection_rate'], recall=v['tpr_recall'], fpr=v['fpr'], auc=v['roc_auc']))\npd.DataFrame(rows).round(3)"),
 md("## 5. Skew detection — three scenarios\n`clean` = online store vs training (control); `schema` = type/encoding skew; `drift` = value/distribution skew."),
 code("reports = S.run('all', n=1200)\nprint({r['scenario']: r['overall_status'] for r in reports})"),
 code("fig, axes = plt.subplots(1, 3, figsize=(16, 4.5), sharey=False)\nfor ax, r in zip(axes, reports):\n    psi = pd.Series({f: min(v['psi'], 1.5) for f, v in r['features'].items()}).sort_values()\n"
      "    colors = ['#2e7d32' if x < .1 else '#f9a825' if x <= .2 else '#c62828' for x in psi]\n    ax.barh(psi.index, psi.values, color=colors); ax.axvline(.1, ls='--', c='grey'); ax.axvline(.2, ls='--', c='k')\n"
      "    ax.set_title(f\"{r['scenario']}  [{r['overall_status']}]\", fontsize=10); ax.set_xlabel('PSI (capped at 1.5)'); ax.tick_params(labelsize=7)\nplt.tight_layout(); plt.savefig(C.ARTIFACT_DIR/'psi_by_scenario.png', dpi=150); plt.show()"),
 code("base, live = S.load_baseline(), S.fetch_online(1200); drift = S.inject_drift(live)\nfig, ax = plt.subplots(1, 2, figsize=(11, 3.8))\n"
      "ax[0].hist(base.monthly_charges, bins=30, alpha=.6, density=True, label='train (offline)'); ax[0].hist(drift.monthly_charges, bins=30, alpha=.6, density=True, label='live (drifted)'); ax[0].set_title('monthly_charges'); ax[0].legend()\n"
      "pd.concat([base.payment_method.value_counts(normalize=True).rename('train'), drift.payment_method.value_counts(normalize=True).rename('live (drifted)')], axis=1).plot.bar(ax=ax[1], title='payment_method'); plt.tight_layout(); plt.savefig(C.ARTIFACT_DIR/'drift_distributions.png', dpi=150); plt.show()"),
 code("print(json.dumps(reports[1]['schema_issues'], indent=1))"),
 md("## 7. Live Redis benchmark and scale test (`benchmark_and_scale.py`)"),
 code("b = json.load(open(C.ARTIFACT_DIR/'benchmark_metrics.json'))\nprint(json.dumps(b['environment'], indent=1))\nsl = b['serving_latency']\n"
      "pd.DataFrame({k: v for k, v in sl.items() if k.startswith(('single','batch','raw'))}).T[['p50','p95','p99','mean','n']]"),
 code("sc = pd.DataFrame([{'entities': s['entities'], 'records': s['records_materialized'], 'seconds': s['materialize_seconds'], 'records_per_sec': s['throughput_records_per_sec'], 'redis_MB': s['redis_used_memory_mb'], 'parquet_MB': s['parquet_bytes_total']/1e6, 'single_p50_ms': s['online_latency']['single_entity_ms']['p50'], 'single_p99_ms': s['online_latency']['single_entity_ms']['p99'], 'batch100_p50_ms': s['online_latency']['batch_100_ms']['p50']} for s in b['scale_test']])\nsc.round(2)"),
 code("fig, ax = plt.subplots(1, 3, figsize=(15, 3.8))\nax[0].plot(sc.entities, sc.redis_MB, 'o-'); ax[0].set_title('Redis memory (MB)'); ax[0].set_xlabel('entities')\n"
      "ax[1].plot(sc.entities, sc.single_p50_ms, 'o-', label='p50'); ax[1].plot(sc.entities, sc.single_p99_ms, 's--', label='p99'); ax[1].set_title('single-entity fetch latency (ms)'); ax[1].legend(); ax[1].set_ylim(0, None); ax[1].set_xlabel('entities')\n"
      "pl = pd.DataFrame(b['parallel_loading']['runs']); ax[2].bar(pl.workers.astype(str), pl.throughput_records_per_sec); ax[2].set_title(f\"parallel loader records/s (cpus={b['parallel_loading']['cpu_count']})\"); ax[2].set_xlabel('workers')\n"
      "plt.tight_layout(); plt.savefig(C.ARTIFACT_DIR/'benchmark_scale.png', dpi=150); plt.show()"),
 md("## 8. Fairness mitigation (`fairness_mitigation.py`)"),
 code("fm = json.load(open(C.ARTIFACT_DIR/'fairness_mitigated_report.json'))\nt = pd.DataFrame(fm['comparison_table']).set_index('method')\n"
      "t[['threshold_1','selection_rate_ref','selection_rate_target','fpr_ref','fpr_target','disparate_impact_ratio','equal_opportunity_diff','average_odds_difference','roc_auc_effective','roc_auc_degradation_vs_baseline','f1','recall','di_95ci']]"),
 code("fig, ax = plt.subplots(1, 2, figsize=(11, 3.8)); x = np.arange(len(t)); w = .38\n"
      "ax[0].bar(x - w/2, t.selection_rate_ref, w, label='non-senior'); ax[0].bar(x + w/2, t.selection_rate_target, w, label='senior'); ax[0].set_xticks(x); ax[0].set_xticklabels(t.index, rotation=30, ha='right', fontsize=7); ax[0].set_title('selection rate'); ax[0].legend()\n"
      "ax[1].bar(x - w/2, t.fpr_ref, w, label='non-senior'); ax[1].bar(x + w/2, t.fpr_target, w, label='senior'); ax[1].set_xticks(x); ax[1].set_xticklabels(t.index, rotation=30, ha='right', fontsize=7); ax[1].set_title('false-positive rate')\n"
      "plt.tight_layout(); plt.savefig(C.ARTIFACT_DIR/'fairness_mitigation.png', dpi=150); plt.show()"),
 md("## 9. Lineage dictionary (generated from the live Feast registry)"),
 code("pd.read_json('docs/lineage_dictionary.json')[['feature','source_table','source_columns','transformation','owner','sensitive_tag']]"),
 code("print(open('docs/lineage.mmd').read()[:600], '...')  # full Mermaid graph in docs/lineage.md"),
]
nb.metadata["kernelspec"] = {"display_name": "Python 3", "language": "python", "name": "python3"}
nbf.write(nb, "notebooks/results.ipynb")
