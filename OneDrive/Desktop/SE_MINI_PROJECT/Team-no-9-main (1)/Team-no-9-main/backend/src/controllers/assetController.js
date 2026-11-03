// Data layer fallback simulating data schemas from models
let mockAssetValuations = {
  stock: { currentPrice: 150.00, lastUpdated: new Date(), isStale: false },
  gold: { currentPrice: 2500.00, lastUpdated: new Date(), isStale: false }
};

let userAlertConfigs = []; // Stores threshold records
const THROTTLE_DURATION_MS = 60 * 60 * 1000; // 1-hour anti-spam threshold constraint

/**
 * PWM-F-020 & PWM-F-021: Handle live asset price feeds
 * PWM-F-024: Evaluate and attach the data status flag
 */
exports.getAssetPrices = async (req, res) => {
  try {
    const now = new Date();
    
    // Check if the server hasn't updated data within 1 minute
    for (let key in mockAssetValuations) {
      const timeDifference = now - mockAssetValuations[key].lastUpdated;
      if (timeDifference > 60000) {
        mockAssetValuations[key].isStale = true; // Flag stale cache status
      }
    }

    return res.status(200).json({
      success: true,
      data: mockAssetValuations
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PWM-F-040: Store boundary notification options from users
 */
exports.configureAlert = async (req, res) => {
  try {
    const { userId, assetType, targetPrice, condition } = req.body;
    
    if (!targetPrice || targetPrice <= 0) {
      return res.status(400).json({ success: false, message: "Invalid target price parameter" });
    }

    const newAlert = {
      userId,
      assetType,
      targetPrice: parseFloat(targetPrice),
      condition, // 'ABOVE' or 'BELOW'
      lastNotifiedAt: null
    };

    userAlertConfigs.push(newAlert);
    return res.status(201).json({ success: true, message: "Alert configuration saved successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PWM-F-041 & PWM-F-042: Evaluate alert conditions and execute throttled warnings
 */
exports.processIncomingMarketData = async (req, res) => {
  try {
    const { assetType, newPrice } = req.body;
    const now = Date.now();

    // Update local cache records
    if (mockAssetValuations[assetType]) {
      mockAssetValuations[assetType].currentPrice = parseFloat(newPrice);
      mockAssetValuations[assetType].lastUpdated = new Date();
      mockAssetValuations[assetType].isStale = false;
    }

    let notificationsTriggered = [];

    // Evaluate stored triggers
    userAlertConfigs.forEach(alert => {
      if (alert.assetType === assetType) {
        const isBreached = 
          (alert.condition === 'ABOVE' && newPrice >= alert.targetPrice) ||
          (alert.condition === 'BELOW' && newPrice <= alert.targetPrice);

        if (isBreached) {
          // PWM-F-042: Verify throttling rule constraint before dispatching
          if (!alert.lastNotifiedAt || (now - alert.lastNotifiedAt > THROTTLE_DURATION_MS)) {
            alert.lastNotifiedAt = now;
            notificationsTriggered.push(`🚨 Alert breached for ${assetType}! Target value hit $${newPrice}`);
          }
        }
      }
    });

    return res.status(200).json({
      success: true,
      message: "Market processing sequence executed successfully",
      alerts: notificationsTriggered
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
