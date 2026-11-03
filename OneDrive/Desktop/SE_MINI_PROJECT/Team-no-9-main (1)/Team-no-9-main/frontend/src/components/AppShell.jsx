// App frame: top bar with the product name and main navigation. Auth screens
// (login, password reset) get the bar without the navigation.
// Reports and Settings are placeholders until those screens exist (SAD 4.8).
const NAV = [
  { label: 'Dashboard', href: '#/' },
  { label: 'Assets', href: '#/assets' },
  { label: 'Reports', href: '#/reports' },
  { label: 'Settings', href: '#/settings' },
];

export default function AppShell({ children, current, variant }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/">
            <span className="brand-mark" aria-hidden="true">₹</span>
            <span>Wealth</span>
          </a>
          {variant !== 'auth' && (
            <nav aria-label="Main">
              <ul className="nav">
                {NAV.map((item) => (
                  <li key={item.label}>
                    <a
                      href={item.href}
                      className={item.label === current ? 'nav-link current' : 'nav-link'}
                      aria-current={item.label === current ? 'page' : undefined}
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      </header>
      {children}
    </div>
  );
}
