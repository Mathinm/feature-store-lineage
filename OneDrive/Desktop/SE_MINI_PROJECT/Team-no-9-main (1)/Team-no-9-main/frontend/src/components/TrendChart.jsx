// PWM-F-032: net worth over time, with a 1M / 6M / 1Y / All range selector.
// Plain SVG like the allocation chart. The chart is drawn at the container's real
// pixel width (ResizeObserver), so axis text keeps its size on every screen.
// Hover, tap, or focus the chart and use the arrow keys to read a day's exact value.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatINR } from '../lib/money.js';
import {
  computeChange,
  dateTicks,
  formatAxisDate,
  formatAxisINR,
  formatLongDate,
  formatWeekdayDate,
  nearestIndex,
  niceTicks,
  RANGES,
  toDayNumber,
} from '../lib/trend.js';

export default function TrendChart({ range, onRangeChange, trend }) {
  return (
    <section className="card trend" aria-labelledby="trend-heading">
      <div className="card-header">
        <h2 id="trend-heading" className="card-title">Net worth over time</h2>
        <div className="segmented" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              className="segmented-option"
              aria-pressed={r.id === range}
              onClick={() => onRangeChange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <TrendBody trend={trend} range={range} />
    </section>
  );
}

function TrendBody({ trend, range }) {
  if (trend.status === 'loading') {
    return (
      <div className="skeleton trend-skeleton" role="status">
        <span className="sr-only">Loading net-worth history</span>
      </div>
    );
  }
  if (trend.status === 'error') {
    return (
      <div className="trend-message error-text" role="alert">
        <p>We couldn't load your net-worth history. {trend.error.message}</p>
        <button type="button" className="button" onClick={trend.retry}>
          Try again
        </button>
      </div>
    );
  }
  // 'unauthorized' is handled by the page, which replaces every card.
  if (trend.status !== 'ready') return null;

  const { points } = trend.data;
  // While another range loads, keep the previous chart on screen, dimmed.
  const busy = trend.data.range !== range;
  return (
    <div className={busy ? 'trend-body is-pending' : 'trend-body'} aria-busy={busy}>
      {points.length < 2 ? (
        <EmptyTrend points={points} />
      ) : (
        <>
          <ChangeSummary points={points} range={trend.data.range} />
          <TrendPlot points={points} range={trend.data.range} />
        </>
      )}
    </div>
  );
}

function EmptyTrend({ points }) {
  return (
    <div className="trend-message" data-testid="trend-empty">
      <p className="trend-empty-title">No history for this period yet</p>
      <p className="muted">
        {points.length === 1
          ? `Your first daily snapshot (${formatINR(points[0].netWorth)} on ${formatLongDate(points[0].date)}) is saved. The trend line appears after the next one.`
          : 'Your net worth is saved once a day, so the trend appears here after your first two daily snapshots.'}
      </p>
    </div>
  );
}

function ChangeSummary({ points, range }) {
  const change = computeChange(points);
  const period = RANGES.find((r) => r.id === range)?.period ?? `since ${formatLongDate(points[0].date)}`;
  const sign = change.direction === 'up' ? '+' : change.direction === 'down' ? '−' : '';
  const arrow = change.direction === 'up' ? '▲' : change.direction === 'down' ? '▼' : '■';
  const amount = formatINR(change.amount.replace('-', ''));
  const percent = change.percent === null ? '' : ` (${sign}${change.percent.replace('-', '')}%)`;
  return (
    <p className="trend-summary" data-testid="trend-change">
      <span className={`trend-change trend-change-${change.direction}`}>
        <span aria-hidden="true">{arrow} </span>
        {sign}
        {amount}
        {percent}
      </span>{' '}
      <span className="muted">{period}</span>
    </p>
  );
}

function TrendPlot({ points, range }) {
  const wrapRef = useRef(null);
  const width = useElementWidth(wrapRef);
  const [active, setActive] = useState(null);
  const [shownPoints, setShownPoints] = useState(points);
  if (shownPoints !== points) {
    // New data (range switch or refresh): clear the highlighted day.
    setShownPoints(points);
    setActive(null);
  }

  const chart = useMemo(() => (width > 0 ? layoutChart(points, width) : null), [points, width]);
  const last = points.length - 1;
  const activePoint = active === null ? null : points[active];

  const pick = (event) => {
    if (!chart) return;
    const box = event.currentTarget.getBoundingClientRect();
    setActive(nearestIndex(chart.xs, event.clientX - box.left));
  };

  const onKeyDown = (event) => {
    const current = active ?? last;
    const jump = Math.max(1, Math.round(points.length / 10));
    const moves = {
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      PageUp: current - jump,
      PageDown: current + jump,
      Home: 0,
      End: last,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    setActive(Math.min(last, Math.max(0, moves[event.key])));
  };

  const first = points[0];
  const final = points[last];
  const label =
    `Net worth from ${formatLongDate(first.date)} (${formatINR(first.netWorth)}) ` +
    `to ${formatLongDate(final.date)} (${formatINR(final.netWorth)}). ` +
    'Use the left and right arrow keys to read each day.';

  return (
    <div
      ref={wrapRef}
      className="trend-plot"
      tabIndex={0}
      role="group"
      aria-label={label}
      data-testid="trend-chart"
      data-range={range}
      data-point-count={points.length}
      data-first-date={first.date}
      data-last-date={final.date}
      data-last-value={final.netWorth}
      data-active-date={activePoint?.date}
      onKeyDown={onKeyDown}
      onFocus={() => setActive((a) => a ?? last)}
      onBlur={() => setActive(null)}
    >
      {chart && (
        <svg
          className="trend-svg"
          width={chart.width}
          height={chart.height}
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          aria-hidden="true"
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
        >
          {chart.yTicks.map((t) => (
            <g key={t.label}>
              <line className="trend-grid" x1={chart.pad.left} x2={chart.width - chart.pad.right} y1={t.y} y2={t.y} />
              <text className="trend-axis trend-y-label" x={chart.pad.left - 8} y={t.y} textAnchor="end" dominantBaseline="middle">
                {t.label}
              </text>
            </g>
          ))}
          <path className="trend-area" d={chart.area} />
          <path className="trend-line" d={chart.line} />
          {chart.xTicks.map((t, i) => (
            <text
              key={t.date}
              className="trend-axis trend-x-label"
              x={t.x}
              y={chart.height - 8}
              textAnchor={i === 0 ? 'start' : i === chart.xTicks.length - 1 ? 'end' : 'middle'}
            >
              {t.label}
            </text>
          ))}
          {activePoint && (
            <g>
              <line
                className="trend-guide"
                x1={chart.xs[active]}
                x2={chart.xs[active]}
                y1={chart.pad.top}
                y2={chart.height - chart.pad.bottom}
              />
              <circle className="trend-dot" cx={chart.xs[active]} cy={chart.ys[active]} r="4.5" />
            </g>
          )}
        </svg>
      )}
      {chart && activePoint && (
        <div
          className={`trend-tooltip trend-tooltip-${tooltipSide(chart.xs[active], chart.width)}`}
          style={{ left: chart.xs[active] }}
          role="status"
          data-testid="trend-tooltip"
        >
          <span className="trend-tooltip-date">{formatWeekdayDate(activePoint.date)}</span>
          <span className="trend-tooltip-value">{formatINR(activePoint.netWorth)}</span>
        </div>
      )}
    </div>
  );
}

/** Keep the tooltip inside the card: anchor it left, centred or right of the point. */
function tooltipSide(x, width) {
  if (x < width / 3) return 'start';
  if (x > (width * 2) / 3) return 'end';
  return 'middle';
}

function useElementWidth(ref) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function layoutChart(points, width) {
  const narrow = width < 480;
  const height = narrow ? 200 : 260;
  const values = points.map((p) => Number(p.netWorth));
  const scale = niceTicks(Math.min(...values), Math.max(...values), narrow ? 4 : 5);
  const yLabels = scale.ticks.map((t) => formatAxisINR(t, scale.step, scale.max));
  // Room for the longest value label at 12px (about 7px per character).
  const longest = Math.max(...yLabels.map((l) => l.length));
  const pad = { top: 12, right: 12, bottom: 28, left: Math.ceil(longest * 7 + 14) };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;

  const firstDay = toDayNumber(points[0].date);
  const span = Math.max(toDayNumber(points[points.length - 1].date) - firstDay, 1);
  const x = (date) => pad.left + ((toDayNumber(date) - firstDay) / span) * plotWidth;
  const y = (value) => pad.top + (1 - (value - scale.min) / (scale.max - scale.min)) * plotHeight;

  const xs = points.map((p) => x(p.date));
  const ys = values.map(y);
  const line = xs.map((px, i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${ys[i].toFixed(1)}`).join('');
  const bottom = (pad.top + plotHeight).toFixed(1);
  const area = `${line}L${xs[xs.length - 1].toFixed(1)},${bottom}L${xs[0].toFixed(1)},${bottom}Z`;

  const tickCount = narrow ? 3 : width < 768 ? 4 : 6;
  const xTicks = dateTicks(points, tickCount).map((date) => ({ date, x: x(date), label: formatAxisDate(date, span) }));
  const yTicks = scale.ticks.map((t, i) => ({ y: y(t), label: yLabels[i] }));

  return { width, height, pad, xs, ys, line, area, xTicks, yTicks };
}
