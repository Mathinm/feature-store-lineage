// PWM-F-030: total net worth across all asset classes.
import { formatINR, formatINRCompact } from '../lib/money.js';
import StaleBadge from './StaleBadge.jsx';

const asOfFormat = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

export default function NetWorthCard({ netWorth, asOf, hasStaleData, classCount }) {
  return (
    <section className="card net-worth" aria-labelledby="net-worth-heading">
      <div className="card-header">
        <h2 id="net-worth-heading" className="card-title">Total net worth</h2>
        {hasStaleData && <StaleBadge />}
      </div>

      <p className="net-worth-value" data-testid="net-worth-value">
        {formatINR(netWorth)}
      </p>
      <p className="net-worth-sub">
        {classCount === 0
          ? 'No assets added yet'
          : `${formatINRCompact(netWorth)} across ${classCount} asset ${classCount === 1 ? 'class' : 'classes'}`}
      </p>

      {asOf && (
        <p className="muted small">
          Valued as of <time dateTime={asOf}>{asOfFormat.format(new Date(asOf))} IST</time>
        </p>
      )}
    </section>
  );
}
