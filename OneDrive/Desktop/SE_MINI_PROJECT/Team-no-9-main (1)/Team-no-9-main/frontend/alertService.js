// frontend/src/alertService.js

const alertConfigurations = []; 
const THROTTLE_WINDOW_MS = 3600000; 

export function configureAlertThreshold(userId, assetId, targetPrice, conditionType) {
  const newThreshold = {
    userId,
    assetId,
    targetPrice,
    conditionType, 
    lastNotifiedAt: null
  };
  alertConfigurations.push(newThreshold);
}

export function evaluatePriceAlerts(assetId, currentPrice, onNotify) {
  const matchingAlerts = alertConfigurations.filter(alert => alert.assetId === assetId);

  matchingAlerts.forEach(alert => {
    const isBreached = 
      (alert.conditionType === 'ABOVE' && currentPrice >= alert.targetPrice) ||
      (alert.conditionType === 'BELOW' && currentPrice <= alert.targetPrice);

    if (isBreached) {
      const now = Date.now();
      if (!alert.lastNotifiedAt || (now - alert.lastNotifiedAt > THROTTLE_WINDOW_MS)) {
        alert.lastNotifiedAt = now;
        if (onNotify) onNotify(alert.userId, alert.assetId, currentPrice);
      }
    }
  });
}
