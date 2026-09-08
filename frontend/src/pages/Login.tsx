import { useState, type FormEvent } from "react";
import { describeError } from "../components/ControlPanel";
import { api } from "../services/api";
import { auth } from "../services/auth";

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const r = await api.auth.login(username.trim(), password);
      auth.set(r.token, r.username);
      onLogin();
    } catch (err) { setError(describeError(err)); } finally { setBusy(false); }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={(e) => void submit(e)}>
        <div className="brand"><span className="brand-mark">GC</span><span>Ground Control<small>VEHICLE DASHBOARD</small></span></div>
        <div className="card-b stack">
          <div className="form-field"><label htmlFor="u">Username</label><input id="u" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus /></div>
          <div className="form-field"><label htmlFor="p">Password</label><input id="p" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          {error && <div className="alert-banner critical">{error}</div>}
          <button className="btn primary block lg" type="submit" disabled={busy || !username || !password}>{busy ? "Signing in…" : "Sign in"}</button>
          <div className="muted small">Credentials are set in <code>.env</code> (AUTH_USERNAME / AUTH_PASSWORD).</div>
        </div>
      </form>
    </div>
  );
}
