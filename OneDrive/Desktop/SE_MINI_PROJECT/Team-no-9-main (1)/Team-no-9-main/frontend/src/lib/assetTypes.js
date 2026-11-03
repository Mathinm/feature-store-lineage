// The four asset classes from the SRS, in a fixed display order.
// Colors are chosen to stay distinguishable in light and dark mode.
export const ASSET_TYPES = {
  REAL_ESTATE: { label: 'Real estate', color: 'var(--c-real-estate)' },
  STOCK: { label: 'Stocks', color: 'var(--c-stock)' },
  GOLD: { label: 'Gold', color: 'var(--c-gold)' },
  CASH: { label: 'Cash & bank', color: 'var(--c-cash)' },
};

export const ASSET_TYPE_ORDER = Object.keys(ASSET_TYPES);

export function assetTypeLabel(type) {
  return ASSET_TYPES[type]?.label ?? type;
}

export function assetTypeColor(type) {
  return ASSET_TYPES[type]?.color ?? 'var(--text-muted)';
}
