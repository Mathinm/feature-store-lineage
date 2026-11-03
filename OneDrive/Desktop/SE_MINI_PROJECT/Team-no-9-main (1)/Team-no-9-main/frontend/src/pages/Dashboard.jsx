import React, { useState, useEffect } from 'react';
// Import your freshly added background worker and configuration files
import { refreshAssetValuations } from '../valuationWorker';
import { configureAlertThreshold, evaluatePriceAlerts } from '../alertService';

export default function Dashboard() {
  // 1. Dynamic state variables for automatic price updates and stale flags
  const [stockValuation, setStockValuation] = useState({ price: 0, isStale: false });
  const [goldValuation, setGoldValuation] = useState({ price: 0, isStale: false });
  const [alertLogs, setAlertLogs] = useState([]);

  // 2. State hooks for tracking User Input Configurations
  const [assetType, setAssetType] = useState('stock');
  const [condition, setCondition] = useState('ABOVE');
  const [targetPrice, setTargetPrice] = useState('');

  // 3. React standard polling engine setup (PWM-F-020 & PWM-F-021 auto-refresh)
  useEffect(() => {
    const handleUpdate = (type, price, isStale) => {
      if (type === 'stock') setStockValuation({ price, isStale });
      if (type === 'gold') setGoldValuation({ price, isStale });
    };

    const handleAlertTrigger = (type, currentPrice) => {
      evaluatePriceAlerts(type, currentPrice, (userId, assetId, breachedPrice) => {
        setAlertLogs(prev => [
          ...prev, 
          `🚨 [ALERT TRIGGERED] ${assetId.toUpperCase()} hit target boundary price: $${breachedPrice}!`
        ]);
      });
    };

    // Execute initial poll sequence instantly on dashboard page mount
    refreshAssetValuations(handleUpdate, handleAlertTrigger);

    // Enforce 30-second automated refresh loop counter
    const interval = setInterval(() => {
      refreshAssetValuations(handleUpdate, handleAlertTrigger);
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  // 4. Save alert interface boundary configuration function callback
  const handleSaveAlert = () => {
    if (!targetPrice || parseFloat(targetPrice) <= 0) return;
    configureAlertThreshold("user_01", assetType, parseFloat(targetPrice), condition);
    setAlertLogs(prev => [...prev, `⚙️ Threshold Saved: ${assetType} ${condition} $${targetPrice}`]);
    setTargetPrice('');
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h2>📊 Financial Wealth Dashboard Summary Overview</h2>
      
      {/* Visual Asset Cards View Layout Grid (PWM-F-020, PWM-F-021 & PWM-F-024) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px' }}>
        
        {/* Automated Stock Asset Tracking Metric Card */}
        <div style={{ padding: '20px', border: '1px solid #d0d7de', borderRadius: '8px', background: '#fff' }}>
          <h3>📈 Live Automated Stock Valuation</h3>
          <p style={{ fontSize: '32px', fontWeight: 'bold', margin: '10px 0' }}>
            ${stockValuation.price.toFixed(2)}
          </p>
          {stockValuation.isStale ? (
            <span style={{ color: '#cf222e', background: '#ffe3e3', padding: '4px 10px', borderRadius: '4px', fontSize: '14px', fontWeight: 'bold' }}>⚠️ STALE CACHE RECOVERED</span>
          ) : (
            <span style={{ color: '#1a7f37', background: '#dafbe1', padding: '4px 10px', borderRadius: '4px', fontSize: '14px' }}>🟢 Live Market Stream</span>
          )}
        </div>

        {/* Automated Gold Asset Tracking Metric Card */}
        <div style={{ padding: '20px', border: '1px solid #d0d7de', borderRadius: '8px', background: '#fff' }}>
          <h3>✨ Live Automated Gold Valuation</h3>
          <p style={{ fontSize: '32px', fontWeight: 'bold', margin: '10px 0' }}>
            ${goldValuation.price.toFixed(2)}
          </p>
          {goldValuation.isStale ? (
            <span style={{ color: '#cf222e', background: '#ffe3e3', padding: '4px 10px', borderRadius: '4px', fontSize: '14px', fontWeight: 'bold' }}>⚠️ STALE CACHE RECOVERED</span>
          ) : (
            <span style={{ color: '#1a7f37', background: '#dafbe1', padding: '4px 10px', borderRadius: '4px', fontSize: '14px' }}>🟢 Live Market Stream</span>
          )}
        </div>

      </div>

      {/* User Threshold Alert Custom Configuration UI View Box (PWM-F-040) */}
      <div style={{ padding: '24px', border: '1px solid #d0d7de', borderRadius: '8px', background: '#f6f8fa', marginBottom: '30px' }}>
        <h3>🔔 Configure Custom Valuation Alert Boundaries</h3>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignmentItems: 'center' }}>
          <select value={assetType} onChange={e => setAssetType(e.target.value)} style={{ padding: '8px', borderRadius: '4px' }}>
            <option value="stock">Stock Portfolio</option>
            <option value="gold">Gold Holdings</option>
          </select>
          <select value={condition} onChange={e => setCondition(e.target.value)} style={{ padding: '8px', borderRadius: '4px' }}>
            <option value="ABOVE">Rises Above (≥)</option>
            <option value="BELOW">Drops Below (≤)</option>
          </select>
          <input 
            type="number" 
            value={targetPrice} 
            onChange={e => setTargetPrice(e.target.value)} 
            placeholder="Target Trigger Value"
            style={{ padding: '8px', borderRadius: '4px', border: '1px solid #d0d7de' }}
          />
          <button onClick={handleSaveAlert} style={{ padding: '8px 16px', background: '#1f883d', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
            Save Threshold Rule
          </button>
        </div>
      </div>

      {/* Dynamic System Output Monitor Terminal Area */}
      <div>
        <h4>🛡️ Live System Activity Audit Trail Logs</h4>
        <div style={{ background: '#24292f', color: '#f6f8fa', padding: '15px', borderRadius: '6px', height: '140px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '13px' }}>
          {alertLogs.length === 0 ? (
            <div style={{ color: '#8c959f' }}>System initialized. Monitoring asset boundaries...</div>
          ) : (
            alertLogs.map((log, index) => <div key={index} style={{ marginBottom: '4px' }}>{log}</div>)
          )}
        </div>
      </div>

    </div>
  );
}
