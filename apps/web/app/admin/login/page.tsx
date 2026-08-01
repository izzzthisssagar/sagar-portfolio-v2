export default function Login() {
  return (
    <main id="main" className="login">
      <p className="eyebrow">Single administrator</p>
      <h1>Sign in</h1>
      <form>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            minLength={12}
            required
          />
        </div>
        <p id="login-help">
          Login is disabled until server credentials and a database are provisioned.
        </p>
        <button className="button" type="button" aria-describedby="login-help" aria-disabled="true">
          SIGN IN — SETUP REQUIRED
        </button>
      </form>
    </main>
  );
}
