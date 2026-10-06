import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../api";
import { slugify } from "../utils/slug";

export default function Signup() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // null while loading. A failed status check falls back to showing the
  // form - the server still refuses the actual signup if it's disabled.
  const [signupsEnabled, setSignupsEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .getSignupStatus()
      .then(({ signupsEnabled }) => setSignupsEnabled(signupsEnabled))
      .catch(() => setSignupsEnabled(true));
  }, []);

  if (!loading && user) return <Navigate to="/" replace />;

  function onCompanyNameChange(value: string) {
    setCompanyName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.signup({ companyName, slug, email, password });
      await refresh();
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Signup failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (signupsEnabled === null) {
    return (
      <div className="login-page">
        <div className="login-box">
          <p className="muted">Loading…</p>
        </div>
      </div>
    );
  }

  if (!signupsEnabled) {
    return (
      <div className="login-page">
        <div className="login-box">
          <h1>Signups disabled</h1>
          <p className="muted">
            New company signups are currently turned off. Contact the platform administrator if you need an
            account.
          </p>
          <p className="muted" style={{ marginTop: 12, textAlign: "center" }}>
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <form className="login-box" onSubmit={onSubmit}>
        <h1>Create your company</h1>
        {error && <div className="error-banner">{error}</div>}
        <div className="field">
          <label>Company name</label>
          <input value={companyName} onChange={(e) => onCompanyNameChange(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label>Company URL</label>
          <div className="muted" style={{ marginBottom: 6 }}>
            This becomes the address your devices point at:{" "}
            <code className="mono">
              {window.location.origin}/{slug || "your-company"}/&lt;device-secret&gt;
            </code>
          </div>
          <input
            value={slug}
            onChange={(e) => {
              setSlug(slugify(e.target.value));
              setSlugTouched(true);
            }}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            minLength={3}
            maxLength={63}
            required
          />
        </div>
        <div className="field">
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: "100%" }}>
          {submitting ? "Creating…" : "Create company"}
        </button>
        <p className="muted" style={{ marginTop: 12, textAlign: "center" }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
