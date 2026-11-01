"""Live Redis benchmark + synthetic scale test for the Feast online store.

Part A  Serving latency on the production feature store (project telco_churn_fs, Redis DB 0):
        raw Redis PING round trip, single-entity fetch (p50/p95/p99), batched fetch (1/10/100/1000 entities).
Part B  Scale test: the 7,043-customer cohort is replicated into N entity partitions (ids '<customerID>-p<k>'),
        written as Parquet, registered in a dedicated Feast project and materialized into Redis DB 1.
        Per scale we record: Parquet size, materialization time and throughput (records/sec), Redis memory,
        and online fetch latency over the whole keyspace  ->  does latency stay flat as storage grows?
Part C  Partition-parallel writers: the largest scale is loaded with 1/2/4 worker processes
        (each worker writes its entity partitions with store.write_to_online_store) to expose how throughput
        scales with workers on THIS machine (cpu count is recorded: no speed-up is possible beyond it).

Usage:  python benchmark_and_scale.py --redis redis://redis:6379/0 --multipliers 1,5,15,30 --workers 1,2,4
Output: artifacts/benchmark_metrics.json  (every number in the report comes from this file)
"""
from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import platform
import shutil
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import numpy as np
import pandas as pd
import redis
from feast import Entity, FeatureStore, FeatureView, FileSource, RepoConfig

import common as C
from feature_store.features import billing_fv, customer, demographics_fv, services_fv

SCALE_DIR = C.DATA_DIR / "scale"
VIEWS = {"customer_demographics": (demographics_fv, "demographics"),
         "customer_services": (services_fv, "services"),
         "customer_billing": (billing_fv, "billing")}


# ----------------------------------------------------------------------------- helpers
def parse_redis(url: str) -> tuple[str, int, int]:
    if "://" not in url:
        url = "redis://" + url
    u = urlparse(url)
    return u.hostname or "localhost", u.port or 6379, int((u.path or "/0").strip("/") or 0)


def pct(xs, qs=(50, 95, 99)) -> dict:
    return {f"p{q}": round(float(np.percentile(xs, q)), 3) for q in qs} | {"mean": round(float(np.mean(xs)), 3), "n": len(xs)}


def timed(fn, n: int, warmup: int = 30) -> list[float]:
    for _ in range(warmup):
        fn()
    out = []
    for _ in range(n):
        t = time.perf_counter()
        fn()
        out.append((time.perf_counter() - t) * 1000.0)
    return out


def scale_store(mult: int, host: str, port: int, db: int = 1) -> FeatureStore:
    d = SCALE_DIR / f"{mult}x"
    d.mkdir(parents=True, exist_ok=True)
    cfg = RepoConfig(project=f"telco_scale_{mult}x", provider="local", registry=str(d / "registry.db"),
                     online_store={"type": "redis", "redis_type": "redis", "connection_string": f"{host}:{port},db={db}"},
                     offline_store={"type": "file"}, entity_key_serialization_version=2, repo_path=C.FEATURE_REPO)
    return FeatureStore(config=cfg)


def scale_objects(mult: int):
    """Same schema/metadata as the production feature views, but reading the replicated Parquet files."""
    d = SCALE_DIR / f"{mult}x"
    objs = []
    for name, (fv, stem) in VIEWS.items():
        src = FileSource(name=f"{stem}_scale_source", path=str(d / f"{stem}.parquet"), timestamp_field="event_timestamp")
        objs.append(FeatureView(name=name, entities=[customer], ttl=fv.ttl, schema=list(fv.features), source=src,
                                online=True, owner=fv.owner, description=fv.description, tags=fv.tags))
    return [customer, *objs]


def write_scaled_parquet(mult: int) -> dict:
    d = SCALE_DIR / f"{mult}x"
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    sizes, rows = {}, 0
    for _, (_, stem) in VIEWS.items():
        base = pd.read_parquet(C.OFFLINE_DIR / f"{stem}.parquet")
        parts = []
        for k in range(mult):
            p = base.copy()
            p["customer_id"] = p["customer_id"] + f"-p{k}"
            parts.append(p)
        df = pd.concat(parts, ignore_index=True)
        df.to_parquet(d / f"{stem}.parquet", index=False)
        sizes[stem] = (d / f"{stem}.parquet").stat().st_size
        rows = len(df)
    return {"entities": rows, "parquet_bytes_total": int(sum(sizes.values())), "parquet_bytes_by_view": sizes}


def sample_ids(mult: int, n: int, seed: int = 3) -> list[str]:
    base = pd.read_parquet(C.OFFLINE_DIR / "labels.parquet").customer_id.to_numpy()
    rng = np.random.default_rng(seed)
    return [f"{rng.choice(base)}-p{rng.integers(0, mult)}" for _ in range(n)]


def fetch_latency(store: FeatureStore, svc_features, id_fn, single_n: int, batch_sizes=(1, 10, 100, 1000), reps: int = 60) -> dict:
    single = timed(lambda: store.get_online_features(features=svc_features, entity_rows=[{"customer_id": id_fn(1)[0]}]).to_dict(), single_n)
    out = {"single_entity_ms": pct(single, (50, 95, 99))}
    for b in batch_sizes:
        lat = timed(lambda: store.get_online_features(features=svc_features, entity_rows=[{"customer_id": i} for i in id_fn(b)]).to_dict(),
                    reps if b <= 100 else max(reps // 3, 10), warmup=5)
        out[f"batch_{b}_ms"] = pct(lat, (50, 95, 99)) | {"per_entity_p50_us": round(float(np.percentile(lat, 50)) / b * 1000, 1)}
    return out


# ----------------------------------------------------------------------------- Part A
def part_a(host: str, port: int, db: int, single_n: int) -> dict:
    os.environ.update(FEAST_ONLINE="redis", REDIS_CONNECTION=f"{host}:{port}")
    r = redis.Redis(host=host, port=port, db=db)
    ping = timed(r.ping, 2000, warmup=100)
    store = C.get_store()
    svc = store.get_feature_service(C.FEATURE_SERVICE)
    pool = pd.read_parquet(C.OFFLINE_DIR / "labels.parquet").customer_id.to_numpy()
    rng = np.random.default_rng(1)
    ids = lambda n: rng.choice(pool, n, replace=False).tolist()  # noqa: E731
    res = fetch_latency(store, svc, ids, single_n)
    res["raw_redis_ping_ms"] = pct(ping, (50, 95, 99))
    res["features_per_request"] = len(svc.feature_view_projections) and sum(len(p.features) for p in svc.feature_view_projections)
    res["keys_in_db"] = r.dbsize()
    return res


# ----------------------------------------------------------------------------- Part B
def materialize_scale(mult: int, host: str, port: int, single_n: int) -> dict:
    r = redis.Redis(host=host, port=port, db=1)
    r.flushdb()
    mem0 = r.info("memory")["used_memory"]
    info = write_scaled_parquet(mult)
    store = scale_store(mult, host, port)
    store.apply(scale_objects(mult))
    t0 = time.perf_counter()
    store.materialize(start_date=datetime(2024, 12, 31, tzinfo=timezone.utc), end_date=datetime(2025, 7, 2, tzinfo=timezone.utc))
    secs = time.perf_counter() - t0
    records = info["entities"] * len(VIEWS)
    mem = r.info("memory")["used_memory"] - mem0
    feats = [f"{n}:{f.name}" for n, (fv, _) in VIEWS.items() for f in fv.features]
    lat = fetch_latency(store, feats, lambda n: sample_ids(mult, n), single_n, batch_sizes=(1, 100), reps=40)
    return {"multiplier": mult, **info, "records_materialized": records, "materialize_seconds": round(secs, 2),
            "throughput_records_per_sec": round(records / secs), "throughput_entities_per_sec": round(info["entities"] / secs),
            "redis_keys": r.dbsize(), "redis_used_memory_mb": round(mem / 1e6, 1),
            "redis_bytes_per_entity": round(mem / info["entities"]), "online_latency": lat}


# ----------------------------------------------------------------------------- Part C
def _worker(args) -> int:
    mult, host, port, parts = args
    store = scale_store(mult, host, port)
    d = SCALE_DIR / f"{mult}x"
    n = 0
    for name, (_, stem) in VIEWS.items():
        df = pd.read_parquet(d / f"{stem}.parquet")
        suffix = df["customer_id"].str.rsplit("-p", n=1).str[-1].astype(int)
        part = df[suffix.isin(parts)]
        for i in range(0, len(part), 20000):
            store.write_to_online_store(name, part.iloc[i:i + 20000])
        n += len(part)
    return n


def part_c(mult: int, host: str, port: int, workers: list[int]) -> list[dict]:
    r = redis.Redis(host=host, port=port, db=1)
    out = []
    ctx = mp.get_context("spawn")
    for w in workers:
        r.flushdb()
        partitions = [list(range(i, mult, w)) for i in range(w)]
        t0 = time.perf_counter()
        with ctx.Pool(w) as pool:
            n = sum(pool.map(_worker, [(mult, host, port, p) for p in partitions]))
        secs = time.perf_counter() - t0
        out.append({"workers": w, "records": n, "seconds": round(secs, 2), "throughput_records_per_sec": round(n / secs),
                    "redis_keys": r.dbsize(), "includes_worker_startup_and_parquet_read": True})
    return out


# ----------------------------------------------------------------------------- main
def main() -> None:
    default = os.getenv("REDIS_URL") or (("redis://" + os.environ["REDIS_CONNECTION"]) if os.getenv("REDIS_CONNECTION") else "redis://redis:6379/0")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--redis", default=default, help="redis://host:port/db of the LIVE Redis (default: Docker service)")
    ap.add_argument("--multipliers", default="1,5,15,30", help="cohort replication factors (7,043 x m entities)")
    ap.add_argument("--workers", default="1,2,4", help="worker counts for the parallel loader test (Part C)")
    ap.add_argument("--single-n", type=int, default=1000, help="single-entity requests per latency run")
    ap.add_argument("--skip-parallel", action="store_true")
    args = ap.parse_args()

    host, port, db = parse_redis(args.redis)
    r = redis.Redis(host=host, port=port, db=db)
    r.ping()  # fail fast if Redis is not reachable
    server = r.info("server")
    env = {"redis_url": f"redis://{host}:{port}/{db}", "redis_version": server["redis_version"], "redis_os": server.get("os"),
           "in_docker_container": os.path.exists("/.dockerenv"), "python": platform.python_version(), "cpu_count": os.cpu_count(),
           "machine": platform.machine(), "timestamp_utc": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    print(f"[bench] Redis {env['redis_version']} at {env['redis_url']} | cpus={env['cpu_count']} | docker={env['in_docker_container']}")

    result = {"environment": env}
    print("[bench] Part A: serving latency on the production feature store")
    result["serving_latency"] = part_a(host, port, db, args.single_n)
    a = result["serving_latency"]
    print(f"        single p50/p95/p99 = {a['single_entity_ms']['p50']}/{a['single_entity_ms']['p95']}/{a['single_entity_ms']['p99']} ms | "
          f"batch100 p50 = {a['batch_100_ms']['p50']} ms | raw PING p50 = {a['raw_redis_ping_ms']['p50']} ms")

    mults = [int(x) for x in args.multipliers.split(",")]
    result["scale_test"] = []
    for m in mults:
        print(f"[bench] Part B: scale x{m} ({7043 * m:,} entities)")
        res = materialize_scale(m, host, port, args.single_n)
        result["scale_test"].append(res)
        print(f"        {res['materialize_seconds']}s -> {res['throughput_records_per_sec']:,} records/s | Redis {res['redis_used_memory_mb']} MB | "
              f"single p99 {res['online_latency']['single_entity_ms']['p99']} ms")
        (C.ARTIFACT_DIR / "benchmark_metrics.json").write_text(json.dumps(result, indent=2))   # checkpoint after each scale

    if not args.skip_parallel:
        m = max(mults)
        print(f"[bench] Part C: partition-parallel loading at x{m}")
        result["parallel_loading"] = {"multiplier": m, "cpu_count": os.cpu_count(), "runs": part_c(m, host, port, [int(x) for x in args.workers.split(",")])}
        for run in result["parallel_loading"]["runs"]:
            print(f"        workers={run['workers']}: {run['throughput_records_per_sec']:,} records/s ({run['seconds']}s)")

    redis.Redis(host=host, port=port, db=1).flushdb()                                      # leave no scale data behind
    (C.ARTIFACT_DIR / "benchmark_metrics.json").write_text(json.dumps(result, indent=2))
    print(f"[bench] wrote {C.ARTIFACT_DIR / 'benchmark_metrics.json'}")


if __name__ == "__main__":
    main()
