CREATE TABLE IF NOT EXISTS gold_assets (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_name VARCHAR(150) NOT NULL,

    gold_type VARCHAR(20) NOT NULL
        CHECK (LOWER(gold_type) IN ('jewellery', 'coin', 'bar')),

    weight_grams NUMERIC(12, 3) NOT NULL
        CHECK (weight_grams > 0),

    purity VARCHAR(20) NOT NULL
        CHECK (purity IN ('18K', '22K', '24K')),

    purchase_value NUMERIC(15, 2) NOT NULL
        CHECK (purchase_value >= 0),

    purchase_date DATE NOT NULL,

    current_estimated_value NUMERIC(15, 2) NOT NULL
        CHECK (current_estimated_value >= 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);