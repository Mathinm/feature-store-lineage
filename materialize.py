"""Register Feast objects (equivalent of `feast apply`) and materialize offline -> online store for a time window."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone

import common as C
from feature_store.features import ALL_OBJECTS


def parse(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--start", default=C.SNAPSHOT_START, help="window start (ISO date, UTC)")
    ap.add_argument("--end", default=C.LABEL_TIMESTAMP, help="window end (ISO date, UTC)")
    args = ap.parse_args()

    store = C.get_store()
    store.apply(ALL_OBJECTS)
    print(f"[materialize] registered: {[fv.name for fv in store.list_feature_views()]} "
          f"| online backend = {C.online_backend()}")
    store.materialize(start_date=parse(args.start), end_date=parse(args.end))

    # sanity probe: read one entity back from the online store
    import pandas as pd
    ids = pd.read_parquet(C.OFFLINE_DIR / "labels.parquet").customer_id.head(3).tolist()
    probe = store.get_online_features(features=store.get_feature_service(C.FEATURE_SERVICE),
                                      entity_rows=[{"customer_id": i} for i in ids]).to_df()
    print("[materialize] online probe:\n", probe.iloc[:, :8].to_string(index=False))


if __name__ == "__main__":
    main()
