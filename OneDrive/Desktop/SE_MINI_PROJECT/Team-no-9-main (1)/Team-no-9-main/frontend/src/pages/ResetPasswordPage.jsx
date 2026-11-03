// Choose a new password from the emailed link (PWM-F-003, TC-Auth-03; SAD 3.9).
// The token comes from #/reset-password?token=... The server checks that it
// exists, is less than 30 minutes old and unused, then marks it used and ends
// every existing session (users.token_valid_after). Invalid, expired and
// already-used links each get their own screen with a way to request a new one.
import { useEffect, useRef, useState } from 'react';
import { resetPassword } from '../api/auth.js';
import { fieldErrors } from '../api/http.js';
import { validatePassword, validatePasswordConfirmation } from '../lib/validation.js';

const LINK_PROBLEMS = {
  invalid: {
    title: "This reset link isn't valid",
    text: 'It may be incomplete. Copy the whole link from the email, or request a new one.',
  },
  expired: {
    title: 'This reset link has expired',
    text: 'Reset links work for 30 minutes. Request a new one and use it straight away.',
  },
  used: {
    title: 'This reset link has already been used',
    text: 'Each link works only once. If you still need to reset your password, request a new link.',
  },
};

const ERROR_CODES = {
  RESET_TOKEN_INVALID: 'invalid',
  RESET_TOKEN_EXPIRED: 'expired',
  RESET_TOKEN_USED: 'used',
};

export default function ResetPasswordPage({ token }) {
  // null while the form is shown; then 'done' or one of the LINK_PROBLEMS keys.
  const [outcome, setOutcome] = useState(token ? null : 'invalid');
  const headingRef = useRef(null);

  // Announce the new screen: move focus to its heading when the outcome changes.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [outcome]);

  const problem = LINK_PROBLEMS[outcome];
  const title = outcome === 'done' ? 'Your password has been reset' : problem ? problem.title : 'Choose a new password';

  return (
    <main className="page auth-page">
      <div className="card auth-card">
        <h1 ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
        {outcome === null && <ResetForm token={token} onOutcome={setOutcome} />}
        {outcome === 'done' && <ResetDone />}
        {problem && <LinkProblem kind={outcome} text={problem.text} />}
      </div>
    </main>
  );
}

function ResetForm({ token, onOutcome }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const passwordRef = useRef(null);
  const confirmRef = useRef(null);

  const check = (pw, confirm) => ({
    password: validatePassword(pw),
    confirmation: validatePasswordConfirmation(pw, confirm),
  });

  async function handleSubmit(event) {
    event.preventDefault();
    setAttempted(true);
    setFormError(null);
    const found = check(password, confirmation);
    setErrors(found);
    if (found.password || found.confirmation) {
      (found.password ? passwordRef : confirmRef).current?.focus();
      return;
    }
    setSaving(true);
    try {
      await resetPassword(token, password);
      onOutcome('done');
    } catch (err) {
      setSaving(false);
      if (ERROR_CODES[err.code]) {
        onOutcome(ERROR_CODES[err.code]);
      } else if (err.status === 400 && err.fields.length > 0) {
        const fields = fieldErrors(err);
        if (fields.token) {
          onOutcome('invalid');
          return;
        }
        setErrors({ password: fields.newPassword ?? err.message, confirmation: null });
        passwordRef.current?.focus();
      } else if (err.status === 429) {
        setFormError('Too many attempts. Please wait a few minutes and try again.');
      } else {
        setFormError(`We couldn't reset your password. ${err.message}`);
      }
    }
  }

  const describedBy = (id, error) => [`${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ');

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="new-password">New password</label>
        <input
          ref={passwordRef}
          id="new-password"
          name="newPassword"
          type={show ? 'text' : 'password'}
          className="input"
          autoComplete="new-password"
          maxLength={256}
          value={password}
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={describedBy('new-password', errors.password)}
          onChange={(e) => {
            setPassword(e.target.value);
            if (attempted) setErrors(check(e.target.value, confirmation));
          }}
        />
        <p id="new-password-hint" className="field-hint">
          At least 10 characters, with letters and numbers.
        </p>
        {errors.password && (
          <p id="new-password-error" className="field-error">
            {errors.password}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="confirm-password">Confirm new password</label>
        <input
          ref={confirmRef}
          id="confirm-password"
          name="confirmPassword"
          type={show ? 'text' : 'password'}
          className="input"
          autoComplete="new-password"
          maxLength={256}
          value={confirmation}
          aria-invalid={errors.confirmation ? true : undefined}
          aria-describedby={describedBy('confirm-password', errors.confirmation)}
          onChange={(e) => {
            setConfirmation(e.target.value);
            if (attempted) setErrors(check(password, e.target.value));
          }}
        />
        <p id="confirm-password-hint" className="sr-only">
          Type the same password again.
        </p>
        {errors.confirmation && (
          <p id="confirm-password-error" className="field-error">
            {errors.confirmation}
          </p>
        )}
      </div>

      <label className="checkbox">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        Show passwords
      </label>

      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <button type="submit" className="button button-block" disabled={saving}>
        {saving ? 'Saving…' : 'Reset password'}
      </button>
    </form>
  );
}

function ResetDone() {
  return (
    <div className="auth-result" role="status" data-testid="reset-done">
      <p>You can now log in with your new password.</p>
      <p className="muted">
        For your security, every session that was signed in with your old password has been signed out, on all devices
        and browsers.
      </p>
      <a className="button button-block" href="#/login">
        Go to login
      </a>
    </div>
  );
}

function LinkProblem({ kind, text }) {
  return (
    <div className="auth-result" role="alert" data-testid={`reset-link-${kind}`}>
      <p className="muted">{text}</p>
      <div className="actions">
        <a className="button" href="#/forgot-password">
          Request a new link
        </a>
        <a className="button button-secondary" href="#/login">
          Back to log in
        </a>
      </div>
    </div>
  );
}
