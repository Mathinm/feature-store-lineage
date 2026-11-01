import numpy as np

import benchmark_and_scale as B
import fairness_mitigation as F


def test_reweighing_makes_group_and_label_independent():
    rng = np.random.default_rng(0)
    a = rng.integers(0, 2, 5000)
    y = (rng.random(5000) < np.where(a == 1, 0.4, 0.15)).astype(int)
    w = F.reweighing_weights(y, a)
    rate = lambda g: (w * (y == 1) * (a == g)).sum() / (w * (a == g)).sum()  # noqa: E731
    assert abs(rate(0) - rate(1)) < 1e-9


def test_equalized_odds_threshold_shrinks_gap():
    rng = np.random.default_rng(1)
    a = np.array(["0"] * 4000 + ["1"] * 1000)
    y = np.concatenate([rng.random(4000) < .2, rng.random(1000) < .35]).astype(int)
    p = np.clip(0.35 * y + rng.normal(0.3, 0.15, 5000) + (a == "1") * 0.15, 0, 1)   # group 1 scored systematically higher
    base = F.fairness(y, (p >= .5).astype(int), a, "0")["average_odds_difference"]
    t = F.fit_threshold(y, p, a, "0", "1", "equalized_odds")
    thr = {"0": .5, "1": t}
    new = F.fairness(y, F.decide(p, a, thr), a, "0")["average_odds_difference"]
    assert t > 0.5 and new < base / 2


def test_fairness_metric_definitions():
    y = np.array([1, 1, 0, 0, 1, 1, 0, 0]); a = np.array(["r"] * 4 + ["g"] * 4)
    pred = np.array([1, 0, 0, 0, 1, 1, 1, 0])
    f = F.fairness(y, pred, a, "r")
    assert f["selection_rate"] == {"r": 0.25, "g": 0.75} and abs(f["disparate_impact_ratio"] - 1 / 3) < 1e-9
    assert abs(f["average_odds_difference"] - 0.5 * (0.5 + 0.5)) < 1e-9


def test_redis_url_parsing_and_percentiles():
    assert B.parse_redis("redis://redis:6379/0") == ("redis", 6379, 0)
    assert B.parse_redis("localhost:6380") == ("localhost", 6380, 0)
    assert B.pct([1, 2, 3, 4, 100])["p50"] == 3
