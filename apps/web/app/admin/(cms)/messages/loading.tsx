export default function MessagesLoading() {
  return (
    <main id="main">
      <p className="eyebrow">Admin / Messages</p>
      <h1>Contact messages</h1>
      <p role="status" aria-live="polite">
        Loading messages…
      </p>
    </main>
  );
}
