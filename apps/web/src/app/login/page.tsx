/**
 * Login page: same markup and stylesheet as templates/login.html. The form
 * posts to /login, which middleware hands to the route handler.
 */
export const metadata = { title: "Login - Job Tracker" };

type Search = Promise<{ error?: string; next?: string }>;

export default async function LoginPage({ searchParams }: { searchParams: Search }) {
  const { error, next } = await searchParams;
  return (
    <>
      <link rel="stylesheet" href="/static/css/login.css" />
      <main className="login-container">
        <img className="login-mark" src="/static/img/logo.svg" alt="" width={56} height={56} />
        <h1 className="login-logo">Job Tracker</h1>
        <p className="subtitle">Sign in to see your applications.</p>
        {error ? <div className="error-message" role="alert">Invalid username or password</div> : null}
        <form method="POST" action="/login">
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input type="text" id="username" name="username" required autoFocus autoComplete="username" />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input type="password" id="password" name="password" required autoComplete="current-password" />
          </div>
          <button type="submit" className="btn-login">Sign in</button>
        </form>
      </main>
    </>
  );
}
