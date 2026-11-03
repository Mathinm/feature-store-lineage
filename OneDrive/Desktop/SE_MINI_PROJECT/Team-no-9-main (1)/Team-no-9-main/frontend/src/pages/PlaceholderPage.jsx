// Stand-in for screens that are planned but not built yet (Reports, Settings).
export default function PlaceholderPage({ title }) {
  return (
    <main className="page">
      <header className="page-header">
        <h1 tabIndex={-1}>{title}</h1>
        <p className="muted">This screen isn't built yet.</p>
      </header>
    </main>
  );
}
