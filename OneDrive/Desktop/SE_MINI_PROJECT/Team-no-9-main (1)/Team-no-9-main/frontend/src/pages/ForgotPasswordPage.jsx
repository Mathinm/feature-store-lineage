// Forgot password (PWM-F-003, TC-Auth-03). Whatever email is entered, the reply
// is the same message, so this page never reveals whether an account exists
// (the API answers 202 either way, SAD 4.3.4).
import { useRef, useState } from 'react';
import { requestPasswordReset } from '../api/auth.js';
import { fieldErrors } from '../api/http.js';
import { validateEmail } from '../lib/validation.js';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);

  return (
    <main className="page auth-page">
      <div className="card auth-card">
        <h1 tabIndex={-1}>Reset your password</h1>
        {sent ? <RequestSent onSendAnother={() => setSent(false)} /> : <RequestForm onSent={() => setSent(true)} />}
      </div>
    </main>
  );
}

function RequestForm({ onSent }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [attempted, setAttempted] = useState(false);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState(null);
  const inputRef = useRef(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setAttempted(true);
    setFormError(null);
    const problem = validateEmail(email);
    setError(problem);
    if (problem) {
      inputRef.current?.focus();
      return;
    }
    setSending(true);
    try {
      await requestPasswordReset(email.trim());
      onSent();
    } catch (err) {
      setSending(false);
      if (err.status === 400 && err.fields.length > 0) {
        setError(fieldErrors(err).email ?? err.message);
        inputRef.current?.focus();
      } else if (err.status === 429) {
        setFormError('Too many reset requests. Please wait a few minutes and try again.');
      } else {
        setFormError(`We couldn't send the request. ${err.message}`);
      }
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <p className="muted">Enter the email you use for your account and we'll send you a link to choose a new password.</p>
      <div className="field">
        <label htmlFor="forgot-email">Email</label>
        <input
          ref={inputRef}
          id="forgot-email"
          name="email"
          type="email"
          className="input"
          autoComplete="email"
          value={email}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'forgot-email-error' : undefined}
          onChange={(e) => {
            setEmail(e.target.value);
            if (attempted) setError(validateEmail(e.target.value));
          }}
        />
        {error && (
          <p id="forgot-email-error" className="field-error">
            {error}
          </p>
        )}
      </div>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <button type="submit" className="button button-block" disabled={sending}>
        {sending ? 'Sending…' : 'Send reset link'}
      </button>
      <a className="text-link" href="#/login">
        Back to log in
      </a>
    </form>
  );
}

function RequestSent({ onSendAnother }) {
  return (
    <div className="auth-result" role="status" data-testid="reset-requested">
      <p className="notice-title">Check your email</p>
      <p>If an account exists for that email, we've sent a reset link.</p>
      <p className="muted">
        The link works once and expires after 30 minutes. If it doesn't arrive in a few minutes, check your spam folder.
      </p>
      <div className="actions">
        <a className="button" href="#/login">
          Back to log in
        </a>
        <button type="button" className="button button-secondary" onClick={onSendAnother}>
          Send another link
        </button>
      </div>
    </div>
  );
}
