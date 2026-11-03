// Manual valuation of a property (PWM-F-022, TC-Val-03). The new estimated
// value is checked before anything is sent, saved with its date, and added to
// the history; the earlier value is kept. After saving, notifyAssetsChanged()
// makes the dashboard's net worth, allocation and trend refresh.
import { useRef, useState } from 'react';
import { getAsset, updateValuation } from '../api/assets.js';
import { notifyAssetsChanged } from '../api/assetEvents.js';
import { fieldErrors, isUnauthorized } from '../api/http.js';
import { useApiResource } from '../lib/useApiResource.js';
import { validateAmount } from '../lib/validation.js';
import { formatINR, formatINRCompact } from '../lib/money.js';
import { formatDate, formatDateTime } from '../lib/dates.js';
import AssetLoadError from '../components/AssetLoadError.jsx';
import SessionExpired from '../components/SessionExpired.jsx';

export default function ValuationPage({ assetId }) {
  const asset = useApiResource(getAsset, assetId, { live: false });
  const [saved, setSaved] = useState(null);
  const [sessionEnded, setSessionEnded] = useState(false);

  let body;
  if (sessionEnded || asset.status === 'unauthorized') {
    body = <SessionExpired />;
  } else if (asset.status === 'loading') {
    body = (
      <div className="card skeleton" role="status">
        <span className="sr-only">Loading the property</span>
      </div>
    );
  } else if (asset.status === 'error') {
    body = <AssetLoadError error={asset.error} retry={asset.retry} />;
  } else if (saved) {
    body = <SavedNotice asset={saved} />;
  } else if (asset.data.assetType !== 'REAL_ESTATE') {
    body = (
      <div className="card notice-card" role="alert">
        <p className="notice-title">Only real estate is valued by hand here</p>
        <p className="muted">Stocks and gold are valued from market prices.</p>
      </div>
    );
  } else {
    body = <ValuationForm asset={asset.data} onSaved={setSaved} onSessionEnded={() => setSessionEnded(true)} />;
  }

  const showDetails = asset.status === 'ready' && !sessionEnded;
  return (
    <main className="page narrow-page">
      <a className="back-link" href="#/assets">
        ← Back to assets
      </a>
      <header className="page-header">
        <h1 tabIndex={-1}>Update property value</h1>
        {showDetails && (
          <p className="muted">
            {asset.data.name}
            {asset.data.location ? `, ${asset.data.location}` : ''}
          </p>
        )}
      </header>
      {body}
    </main>
  );
}

function ValuationForm({ asset, onSaved, onSessionEnded }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState(null);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const inputRef = useRef(null);

  const preview = validateAmount(input);
  const describedBy = ['valuation-hint', error && 'valuation-error'].filter(Boolean).join(' ');

  async function handleSubmit(event) {
    event.preventDefault();
    setAttempted(true);
    setFormError(null);
    const result = validateAmount(input);
    if (result.error) {
      // Invalid input never leaves the browser.
      setError(result.error);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const updated = await updateValuation(asset.id, result.value);
      notifyAssetsChanged();
      onSaved(updated);
    } catch (err) {
      setSaving(false);
      if (isUnauthorized(err)) {
        onSessionEnded();
      } else if (err.status === 400 && err.fields.length > 0) {
        const fields = fieldErrors(err);
        setError(fields.value ?? null);
        if (!fields.value) setFormError(err.message);
        inputRef.current?.focus();
      } else if (err.status === 403) {
        setFormError("You can't edit this asset.");
      } else if (err.status === 404) {
        setFormError('This property no longer exists. It may have been deleted.');
      } else {
        setFormError(`We couldn't save the new value. ${err.message}`);
      }
    }
  }

  return (
    <form className="card form" onSubmit={handleSubmit} noValidate>
      <dl className="facts">
        <div>
          <dt>Current value</dt>
          <dd className="property-value">{formatINR(asset.currentValue)}</dd>
        </div>
        <div>
          <dt>Last valued</dt>
          <dd>{asset.valuedAt ? formatDate(asset.valuedAt) : 'Not yet'}</dd>
        </div>
      </dl>

      <div className="field">
        <label htmlFor="valuation-value">New estimated value (₹)</label>
        <input
          ref={inputRef}
          id="valuation-value"
          name="value"
          className="input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="e.g. 85,00,000"
          value={input}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          // Checked on submit, then on every change. Not on blur: an error appearing
          // as the field loses focus pushes the Save button down mid-click, and the
          // click is lost.
          onChange={(e) => {
            setInput(e.target.value);
            if (attempted) setError(validateAmount(e.target.value).error ?? null);
          }}
        />
        <p id="valuation-hint" className="field-hint">
          {preview.value && !error
            ? `${formatINR(preview.value)} (${formatINRCompact(preview.value)})`
            : 'Rupees, up to 2 decimal places. Commas are fine.'}
        </p>
        {error && (
          <p id="valuation-error" className="field-error">
            {error}
          </p>
        )}
      </div>

      {formError && (
        <p id="valuation-form-error" className="form-error" role="alert">
          {formError}
        </p>
      )}

      <div className="actions">
        <button type="submit" className="button" disabled={saving}>
          {saving ? 'Saving…' : 'Save new value'}
        </button>
        <a className="button button-secondary" href="#/assets">
          Cancel
        </a>
      </div>
    </form>
  );
}

function SavedNotice({ asset }) {
  return (
    <div className="card notice-card" role="status" data-testid="valuation-saved">
      <h2 className="notice-title">New value saved</h2>
      <dl className="facts">
        <div>
          <dt>New value</dt>
          <dd className="property-value">{formatINR(asset.currentValue)}</dd>
        </div>
        <div>
          <dt>Valued on</dt>
          <dd>{formatDateTime(asset.valuedAt)}</dd>
        </div>
      </dl>
      <p className="muted">
        Your net worth, allocation and trend now use this value. The previous value is kept in the history.
      </p>
      <div className="actions">
        <a className="button" href={`#/assets/${encodeURIComponent(asset.id)}/history`}>
          View history
        </a>
        <a className="button button-secondary" href="#/assets">
          Back to assets
        </a>
      </div>
    </div>
  );
}
