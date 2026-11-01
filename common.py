"""Shared paths, constants and Feast store factory for the Feature-Store-with-Lineage project."""
from __future__ import annotations

import os
from pathlib import Path

from feast import FeatureStore, RepoConfig

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("FSL_DATA_DIR", ROOT / "data"))
RAW_DIR = DATA_DIR / "raw"
OFFLINE_DIR = DATA_DIR / "offline"
ARTIFACT_DIR = Path(os.getenv("FSL_ARTIFACT_DIR", ROOT / "artifacts"))
FEATURE_REPO = ROOT / "feature_store"
DUCKDB_PATH = DATA_DIR / "telco.duckdb"
REGISTRY_PATH = DATA_DIR / "registry.db"

RAW_CSV = RAW_DIR / "Telco-Customer-Churn.csv"
IBM_TELCO_URL = (
    "https://raw.githubusercontent.com/IBM/telco-customer-churn-on-icp4d/"
    "master/data/Telco-Customer-Churn.csv"
)

# Time window used to synthesise feature snapshot timestamps (the public dataset has none).
SNAPSHOT_START = "2025-01-01"
SNAPSHOT_DAYS = 180            # snapshots fall in [2025-01-01, 2025-06-30]
LABEL_TIMESTAMP = "2025-07-01"  # churn outcome is observed after all snapshots

FEATURE_SERVICE = "churn_model_v1"
SENSITIVE_FEATURES = ["gender", "senior_citizen", "partner", "dependents"]
CONTINUOUS_FEATURES = ["tenure", "monthly_charges", "total_charges", "avg_monthly_spend", "num_addon_services"]
CATEGORICAL_FEATURES = [
    "gender", "senior_citizen", "partner", "dependents", "phone_service", "multiple_lines",
    "internet_service", "online_security", "online_backup", "device_protection", "tech_support",
    "streaming_tv", "streaming_movies", "contract", "paperless_billing", "payment_method",
]


def ensure_dirs() -> None:
    for d in (DATA_DIR, RAW_DIR, OFFLINE_DIR, ARTIFACT_DIR):
        d.mkdir(parents=True, exist_ok=True)


def online_backend() -> str:
    """'redis' (default, used in Docker) or 'sqlite' (zero-dependency local fallback)."""
    return os.getenv("FEAST_ONLINE", "redis").lower()


def get_store() -> FeatureStore:
    """Build the FeatureStore programmatically so the same code runs in Docker (Redis) and locally (SQLite).

    The equivalent declarative config for the Feast CLI lives in feature_store/feature_store.yaml.
    """
    ensure_dirs()
    if online_backend() == "sqlite":
        online = {"type": "sqlite", "path": str(DATA_DIR / "online_store.db")}
    else:
        online = {
            "type": "redis",
            "redis_type": "redis",
            "connection_string": os.getenv("REDIS_CONNECTION", "localhost:6379"),
        }
    config = RepoConfig(
        project="telco_churn_fs",
        provider="local",
        registry=str(REGISTRY_PATH),
        online_store=online,
        offline_store={"type": "file"},
        entity_key_serialization_version=2,
        repo_path=FEATURE_REPO,
    )
    return FeatureStore(config=config)
