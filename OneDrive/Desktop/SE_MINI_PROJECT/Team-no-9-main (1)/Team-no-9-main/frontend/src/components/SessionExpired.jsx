// Shown in place of a screen's data when the API answers 401 (session missing,
// expired or revoked). Nothing from the previous session stays on screen.
export default function SessionExpired() {
  return (
    <div className="card notice-card" role="alert" data-testid="session-expired">
      <h2 className="notice-title">Please log in again</h2>
      <p className="muted">Your session has ended, so we can't show your data.</p>
      <a className="button" href="#/login">
        Go to login
      </a>
    </div>
  );
}
