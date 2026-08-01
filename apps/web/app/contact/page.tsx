export default function Contact() {
  return (
    <main id="main" className="page-shell">
      <div className="container">
        <p className="eyebrow">Contact</p>
        <h1 className="display">Start with context.</h1>
        <form className="login">
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" name="name" required autoComplete="name" />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="message">Message</label>
            <textarea id="message" name="message" rows={7} required />
          </div>
          <p>
            This Sprint 1 form is an accessible interface shell; delivery remains disabled until a
            recipient and anti-abuse service are configured.
          </p>
          <button className="button" type="button" aria-disabled="true">
            SEND — CONFIGURATION PENDING
          </button>
        </form>
      </div>
    </main>
  );
}
