// frontend/src/valuationWorker.js

export const assetCache = {
  stock: { price: 0, lastUpdated: null, isStale: false },
  gold: { price: 0, lastUpdated: null, isStale: false }
};

const STALE_DATA_TIMEOUT_MS = 60000; 

export async function refreshAssetValuations(onUpdate, onAlertTrigger) {
  const assetsToFetch = [
    { type: 'stock', url: 'https://example.com' },
    { type: 'gold', url: 'https://example.com' }
  ];

  for (const asset of assetsToFetch) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); 

      const response = await fetch(asset.url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`Server returned status: ${response.status}`);
      
      const data = await response.json();
      
      assetCache[asset.type].price = data.price;
      assetCache[asset.type].lastUpdated = Date.now();
      assetCache[asset.type].isStale = false;
      
      if (onUpdate) onUpdate(asset.type, data.price, false);
      if (onAlertTrigger) onAlertTrigger(asset.type, data.price);
      
    } catch (error) {
      if (assetCache[asset.type].lastUpdated && (Date.now() - assetCache[asset.type].lastUpdated > STALE_DATA_TIMEOUT_MS)) {
        assetCache[asset.type].isStale = true;
        if (onUpdate) onUpdate(asset.type, assetCache[asset.type].price, true);
      }
    }
  }
}
