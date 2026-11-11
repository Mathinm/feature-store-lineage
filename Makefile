.PHONY: up local bench fairness test clean
up:        ## full stack with Redis (Docker)
	docker compose up --build
local:     ## no Docker: SQLite online store
	FEAST_ONLINE=sqlite python ingest_data.py && FEAST_ONLINE=sqlite python materialize.py && \
	FEAST_ONLINE=sqlite python train_and_serve.py && FEAST_ONLINE=sqlite python skew_detection.py --scenario all && \
	FEAST_ONLINE=sqlite python lineage.py
bench:     ## live Redis benchmark + scale test (needs Redis; set REDIS_URL, default redis://redis:6379/0)
	FEAST_ONLINE=redis python benchmark_and_scale.py --redis $${REDIS_URL:-redis://localhost:6379/0}
fairness:  ## post/pre-processing fairness mitigation comparison
	python fairness_mitigation.py
test:
	FEAST_ONLINE=sqlite python -m pytest -q tests
clean:
	rm -rf data/offline data/telco.duckdb data/registry.db data/online_store.db artifacts/*
