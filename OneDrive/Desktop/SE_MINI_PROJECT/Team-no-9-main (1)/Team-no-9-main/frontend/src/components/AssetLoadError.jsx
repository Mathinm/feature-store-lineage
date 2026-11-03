// Why an asset couldn't be loaded: not yours (403), gone (404) or another error.
// Nothing about the asset is shown in any of these cases.
export default function AssetLoadError({ error, retry, action = 'edit' }) {
  if (error.status === 403) {
    return (
      <div className="card notice-card" role="alert" data-testid="asset-forbidden">
        <h2 className="notice-title">You can't {action} this asset</h2>
        <p className="muted">It isn't one of your assets.</p>
        <a className="button" href="#/assets">
          Back to your assets
        </a>
      </div>
    );
  }
  if (error.status === 404) {
    return (
      <div className="card notice-card" role="alert" data-testid="asset-not-found">
        <h2 className="notice-title">We couldn't find this property</h2>
        <p className="muted">It may have been deleted.</p>
        <a className="button" href="#/assets">
          Back to your assets
        </a>
      </div>
    );
  }
  return (
    <div className="card error-card" role="alert">
      <p>We couldn't load this property. {error.message}</p>
      <button type="button" className="button" onClick={retry}>
        Try again
      </button>
    </div>
  );
}
