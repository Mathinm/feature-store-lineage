export default function NotFoundPage() {
  return (
    <main className="page">
      <header className="page-header">
        <h1 tabIndex={-1}>Page not found</h1>
        <p className="muted">This page doesn't exist.</p>
      </header>
      <a className="button" href="#/">
        Go to the dashboard
      </a>
    </main>
  );
}
