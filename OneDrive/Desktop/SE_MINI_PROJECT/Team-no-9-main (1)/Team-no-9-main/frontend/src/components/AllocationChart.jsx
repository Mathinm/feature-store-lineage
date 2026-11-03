// PWM-F-031: asset allocation by class, as a donut chart with a legend.
// Drawn as plain SVG, so no chart library is needed. A circle with radius
// 100 / (2π) has a circumference of exactly 100, which lets each slice's
// stroke-dasharray be its percentage directly.
import { useState } from 'react';
import { assetTypeColor, assetTypeLabel } from '../lib/assetTypes.js';
import { formatINR, formatINRCompact } from '../lib/money.js';

const RADIUS = 100 / (2 * Math.PI);
const GAP = 0.6; // percent of the ring left blank between slices

export default function AllocationChart({ allocation, netWorth }) {
  const [active, setActive] = useState(null);

  if (allocation.length === 0) {
    return (
      <section className="card allocation" aria-labelledby="allocation-heading">
        <h2 id="allocation-heading" className="card-title">Asset allocation</h2>
        <p className="muted">Add your first asset to see how your wealth is split.</p>
      </section>
    );
  }

  const gap = allocation.length > 1 ? GAP : 0;
  // Each slice starts where the previous ones end.
  const slices = allocation.map((slice, i) => ({
    ...slice,
    pct: Number(slice.percent),
    start: allocation.slice(0, i).reduce((sum, prev) => sum + Number(prev.percent), 0),
  }));

  const summary = slices
    .map((s) => `${assetTypeLabel(s.assetType)} ${s.percent}%`)
    .join(', ');
  const focused = slices.find((s) => s.assetType === active);

  return (
    <section className="card allocation" aria-labelledby="allocation-heading">
      <h2 id="allocation-heading" className="card-title">Asset allocation</h2>

      <div className="allocation-body">
        <div className="donut-wrap">
          <svg
            className="donut"
            viewBox="0 0 42 42"
            role="img"
            aria-label={`Asset allocation: ${summary}`}
          >
            <circle className="donut-track" cx="21" cy="21" r={RADIUS} />
            {slices.map((s) => (
              <circle
                key={s.assetType}
                className={`donut-slice${active && active !== s.assetType ? ' dimmed' : ''}`}
                cx="21"
                cy="21"
                r={RADIUS}
                stroke={assetTypeColor(s.assetType)}
                strokeDasharray={`${Math.max(s.pct - gap, 0.01)} ${100 - Math.max(s.pct - gap, 0.01)}`}
                // Start at 12 o'clock, then go clockwise.
                strokeDashoffset={25 - s.start - gap / 2}
                onMouseEnter={() => setActive(s.assetType)}
                onMouseLeave={() => setActive(null)}
              />
            ))}
          </svg>
          <div className="donut-center" aria-hidden="true">
            <span className="donut-center-label">
              {focused ? assetTypeLabel(focused.assetType) : 'Total'}
            </span>
            <span className="donut-center-value">
              {focused ? `${focused.percent}%` : formatINRCompact(netWorth)}
            </span>
          </div>
        </div>

        <ul className="legend" data-testid="allocation-legend">
          {slices.map((s) => (
            <li
              key={s.assetType}
              className={`legend-item${active === s.assetType ? ' active' : ''}`}
              tabIndex={0}
              onMouseEnter={() => setActive(s.assetType)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(s.assetType)}
              onBlur={() => setActive(null)}
            >
              <span className="swatch" style={{ background: assetTypeColor(s.assetType) }} />
              <span className="legend-label">{assetTypeLabel(s.assetType)}</span>
              <span className="legend-percent">{s.percent}%</span>
              <span className="legend-value">{formatINR(s.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
