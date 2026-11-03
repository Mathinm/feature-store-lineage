// Login screen. A placeholder until the auth API (register / login) is merged:
// the form is laid out, but signing in isn't wired up yet. "Forgot password?"
// starts the reset flow (PWM-F-003). The "Please log in again" message links here.
import { useState } from 'react';

export default function LoginPage() {
  const [notice, setNotice] = useState(false);

  return (
    <main className="page auth-page">
      <div className="card auth-card">
        <h1 tabIndex={-1}>Log in</h1>
        <form
          className="form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setNotice(true);
          }}
        >
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input id="login-email" name="email" type="email" className="input" autoComplete="username" />
          </div>
          <div className="field">
            <div className="field-label-row">
              <label htmlFor="login-password">Password</label>
              <a className="text-link" href="#/forgot-password">
                Forgot password?
              </a>
            </div>
            <input id="login-password" name="password" type="password" className="input" autoComplete="current-password" />
          </div>
          {notice && (
            <p className="form-note" role="status">
              Logging in isn't connected yet. It will work once the authentication API is merged.
            </p>
          )}
          <button type="submit" className="button button-block">
            Log in
          </button>
        </form>
      </div>
    </main>
  );
}
