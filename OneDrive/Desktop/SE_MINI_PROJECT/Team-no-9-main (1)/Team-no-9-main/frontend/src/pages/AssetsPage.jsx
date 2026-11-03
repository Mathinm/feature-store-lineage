// Assets screen, starting with real estate (SAD 4.8): each property with its
// current value and when it was last valued, plus "Update value" (PWM-F-022)
// and "History" (PWM-F-023). The API only returns the user's own assets.
// Gold, stocks and cash are added with their asset issues.
import { listAssets } from '../api/assets.js';
import { useApiResource } from '../lib/useApiResource.js';
import { formatINR } from '../lib/money.js';
import { formatDate } from '../lib/dates.js';
import SessionExpired from '../components/SessionExpired.jsx';

export default function AssetsPage() {
  const realEstate = useApiResource(listAssets, 'REAL_ESTATE');

  return (
    <main className="page">
      <header className="page-header">
        <h1 tabIndex={-1}>Assets</h1>
        <p className="muted">Update a property's estimated value whenever it changes. Every update is kept in its history.</p>
      </header>

      {realEstate.status === 'unauthorized' ? (
        <SessionExpired />
      ) : (
        <section aria-labelledby="real-estate-heading">
          <h2 id="real-estate-heading" className="section-title">
            Real estate
          </h2>
          <RealEstateList resource={realEstate} />
        </section>
      )}
    </main>
  );
}

function RealEstateList({ resource }) {
  if (resource.status === 'loading') {
    return (
      <div className="card skeleton" role="status">
        <span className="sr-only">Loading your properties</span>
      </div>
    );
  }
  if (resource.status === 'error') {
    return (
      <div className="card error-card" role="alert">
        <p>We couldn't load your properties. {resource.error.message}</p>
        <button type="button" className="button" onClick={resource.retry}>
          Try again
        </button>
      </div>
    );
  }

  const properties = resource.data.items;
  if (properties.length === 0) {
    return (
      <div className="card notice-card" data-testid="real-estate-empty">
        <p className="notice-title">No properties yet</p>
        <p className="muted">Real estate you add will appear here, ready for value updates.</p>
      </div>
    );
  }
  return (
    <ul className="property-list">
      {properties.map((p) => (
        <PropertyCard key={p.id} property={p} />
      ))}
    </ul>
  );
}

function PropertyCard({ property }) {
  const base = `#/assets/${encodeURIComponent(property.id)}`;
  return (
    <li className="card property" data-testid="property" data-asset-id={property.id}>
      <div>
        <h3 className="property-name">{property.name}</h3>
        {property.location && <p className="muted">{property.location}</p>}
      </div>
      <dl className="facts">
        <div>
          <dt>Current value</dt>
          <dd className="property-value">{formatINR(property.currentValue)}</dd>
        </div>
        <div>
          <dt>Last valued</dt>
          <dd>{property.valuedAt ? formatDate(property.valuedAt) : 'Not yet'}</dd>
        </div>
      </dl>
      <div className="actions">
        <a className="button" href={`${base}/valuation`}>
          Update value<span className="sr-only"> of {property.name}</span>
        </a>
        <a className="button button-secondary" href={`${base}/history`}>
          History<span className="sr-only"> of {property.name}</span>
        </a>
      </div>
    </li>
  );
}
