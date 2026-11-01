import numpy as np
import pandas as pd

import skew_detection as S


def test_psi_identical_is_zero():
    x = np.random.default_rng(0).normal(size=5000)
    assert S.psi_continuous(x, x) < 1e-9


def test_psi_thresholds_monotonic():
    rng = np.random.default_rng(1)
    base = rng.normal(0, 1, 20000)
    small, mid, big = (S.psi_continuous(base, rng.normal(m, 1, 20000)) for m in (0.05, 0.4, 1.5))
    assert small < S.PSI_STABLE < mid < big
    assert big > S.PSI_SEVERE
    assert S.psi_level(0.05) == "stable" and S.psi_level(0.15) == "moderate" and S.psi_level(0.25) == "severe"


def test_categorical_psi_and_chi2_detect_shift():
    e = ["a"] * 700 + ["b"] * 300
    a = ["a"] * 400 + ["b"] * 600
    assert S.psi_categorical(e, a) > S.PSI_SEVERE
    assert S.chi_square_test(e, a)["p_value"] < 1e-6
    assert S.chi_square_test(e, e)["p_value"] > 0.99


def test_ks_detects_shift_not_noise():
    rng = np.random.default_rng(2)
    assert S.ks_test(rng.normal(0, 1, 3000), rng.normal(0, 1, 3000))["p_value"] > 0.01
    assert S.ks_test(rng.normal(0, 1, 3000), rng.normal(1, 1, 3000))["p_value"] < 1e-10


def test_schema_check_flags_string_numeric():
    base = pd.DataFrame({"total_charges": [1.0, 2.0, 3.0], "contract": ["a", "b", "a"]})
    live = pd.DataFrame({"total_charges": ["1.0", " ", "3.0"], "contract": ["a", "b", "z"]})
    kinds = {(i["feature"], i["issue"]) for i in S.schema_check(base, live, ["total_charges", "contract"])}
    assert ("total_charges", "dtype_mismatch") in kinds and ("contract", "unseen_categories") in kinds
