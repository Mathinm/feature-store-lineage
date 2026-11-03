// Data store simulating a local database cache
const assetCache = {
  stock: { price: 0, lastUpdated: null, isStale: false },
  gold: { price: 0, lastUpdated: null, isStale: false }
};

// Configuration constants
const STALE_DATA_TIMEOUT_MS = 60000; // 1 minute threshold for stale classification

/**
 * PWM-F-020 & PWM-F-021: Fetches live asset rates automatically
 * PWM-F-024: Flags cached data as stale if network fails or latency times out
 */
async function refreshAssetValuations() {
  const assetsToFetch = [
    { type: 'stock', url: 'https://example.com' },
    { type: 'gold', url: 'https://example.com' }
  ];

  for (const asset of assetsToFetch) {
    try {
      // Fetch with an explicit timeout configuration to enforce valuation performance
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5-second performance cutoff

      const response = await fetch(asset.url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`Server returned status: ${response.status}`);
      
      const data = await response.json();
      
      // Update Cache with fresh values
      assetCache[asset.type].price = data.price;
      assetCache[asset.type].lastUpdated = Date.now();
      assetCache[asset.type].isStale = false;
      
      console.log(`[SUCCESS] Automatically refreshed ${asset.type} valuation: $${data.price}`);
    } catch (error) {
      console.error(`[ERROR] Failed to refresh ${asset.type} valuation:`, error.message);
      
      // PWM-F-024: Evaluate and apply stale-data flag if existing cache is too old
      if (assetCache[asset.type].lastUpdated && (Date.now() - assetCache[asset.type].lastUpdated > STALE_DATA_TIMEOUT_MS)) {
        assetCache[asset.type].isStale = true;
        console.warn(`[STALE FLAG] ${asset.type} data marked as stale. Utilizing last known cached price: $${assetCache[asset.type].price}`);
      }
    }
  }
}

// Automatically poll prices every 30 seconds
setInterval(refreshAssetValuations, 30000);
