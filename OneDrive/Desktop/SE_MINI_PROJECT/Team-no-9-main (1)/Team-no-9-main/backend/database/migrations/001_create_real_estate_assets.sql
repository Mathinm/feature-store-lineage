CREATE TABLE IF NOT EXISTS real_estate_assets (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    property_name VARCHAR(150) NOT NULL,
    location VARCHAR(255) NOT NULL,
    purchase_value NUMERIC(15, 2) NOT NULL CHECK (purchase_value >= 0),
    purchase_date DATE NOT NULL,
    current_estimated_value NUMERIC(15, 2) NOT NULL
        CHECK (current_estimated_value >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);