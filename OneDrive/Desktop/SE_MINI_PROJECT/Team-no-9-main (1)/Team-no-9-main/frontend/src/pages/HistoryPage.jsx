// Valuation history of one property, newest first (PWM-F-022, PWM-F-023).
// Every saved update adds a row; earlier values are never overwritten.
import { fetchValuationHistory, getAsset } from '../api/assets.js';
import { useApiResource } from '../lib/useApiResource.js';
import { formatINR, fromPaise, toPaise } from '../lib/money.js';
import { formatDate, formatDateTime } from '../lib/dates.js';
import AssetLoadError from '../components/AssetLoadError.jsx';
import SessionExpired from '../components/SessionExpired.jsx';

const SOURCE_LABELS = { MANUAL: 'Manual', MARKET: 'Market price' };

async function loadHistory(assetId) {
  const [asset, history] = await Promise.all([getAsset(assetId), fetchValuationHistory(assetId)]);
  // The API returns newest first; sort anyway so the order never depends on it.
  const items = [...history.items].sort((a, b) => (a.valuedAt < b.valuedAt ? 1 : a.valuedAt > b.valuedAt ? -1 : 0));
  return { asset, items };
}

export default function HistoryPage({ assetId }) {
  const resource = useApiResource(loadHistory, assetId);

  let body;
  if (resource.status === 'unauthorized') {
    body = <SessionExpired />;
  } else if (resource.status === 'loading') {
    body = (
      <div className="card skeleton" role="status">
        <span className="sr-only">Loading the valuation history</span>
      </div>
    );
  } else if (resource.status === 'error') {
    body = <AssetLoadError error={resource.error} retry={resource.retry} action="view" />;
  } else {
    body = <HistoryTable asset={resource.data.asset} items={resource.data.items} />;
  }

  const asset = resource.status === 'ready' ? resource.data.asset : null;
  return (
    <main className="page narrow-page">
      <a className="back-link" href="#/assets">
        ← Back to assets
      </a>
      <header className="page-header">
        <h1 tabIndex={-1}>Valuation history</h1>
        {asset && (
          <p className="muted">
            {asset.name}
            {asset.location ? `, ${asset.location}` : ''}
          </p>
        )}
      </header>
      {body}
    </main>
  );
}

function HistoryTable({ asset, items }) {
  if (items.length === 0) {
    return (
      <div className="card notice-card" data-testid="history-empty">
        <p className="notice-title">No valuations recorded yet</p>
      </div>
    );
  }
  return (
    <>
      <div className="card table-card">
        <table className="history-table" data-testid="valuation-history">
          <caption className="sr-only">Valuations of {asset.name}, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Valued on</th>
              <th scope="col">Value</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row, i) => (
              <tr key={row.id}>
                <td>
                  <time dateTime={row.valuedAt} title={formatDateTime(row.valuedAt)}>
                    {formatDate(row.valuedAt)}
                  </time>
                  {i === 0 && <span className="badge badge-accent">Current</span>}
                </td>
                <td>
                  <span className="history-value">{formatINR(row.value)}</span>
                  <Change value={row.value} previous={items[i + 1]?.value} />
                </td>
                <td>{SOURCE_LABELS[row.source] ?? row.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions page-actions">
        <a className="button" href={`#/assets/${encodeURIComponent(asset.id)}/valuation`}>
          Update value
        </a>
      </div>
    </>
  );
}

/** Difference from the previous (older) valuation, e.g. "+₹6,50,000.00". */
function Change({ value, previous }) {
  if (previous === undefined) return <span className="history-change muted">First valuation</span>;
  const diff = toPaise(value) - toPaise(previous);
  if (diff === 0n) return <span className="history-change muted">No change</span>;
  const abs = fromPaise(diff < 0n ? -diff : diff);
  return (
    <span className={`history-change ${diff > 0n ? 'text-positive' : 'text-negative'}`}>
      {diff > 0n ? '+' : '−'}
      {formatINR(abs)}
    </span>
  );
}
