// Shown when a value uses a cached market price because the latest refresh
// failed (PWM-F-024, SAD 4.8).
export default function StaleBadge() {
  return (
    <span
      className="badge badge-warn"
      title="Some market prices could not be refreshed. The last known price is being used."
    >
      Some prices outdated
    </span>
  );
}
