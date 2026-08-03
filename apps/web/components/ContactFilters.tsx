'use client';

export function ContactFilters({ search, status }: { search: string; status: string }) {
  return (
    <form method="get" className="project-filters" role="search" aria-label="Filter messages">
      <div className="field">
        <label htmlFor="search">Search</label>
        <input
          id="search"
          name="search"
          type="search"
          defaultValue={search}
          placeholder="Name, email, or subject"
        />
      </div>
      <div className="field">
        <label htmlFor="status">Status</label>
        <select id="status" name="status" defaultValue={status}>
          <option value="">All</option>
          <option value="new">New</option>
          <option value="read">Read</option>
          <option value="replied">Replied</option>
          <option value="archived">Archived</option>
          <option value="spam">Spam</option>
        </select>
      </div>
      <button className="button" type="submit">
        APPLY
      </button>
    </form>
  );
}
