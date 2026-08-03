'use client';

export function MediaFilters({
  search,
  status,
  category,
}: {
  search: string;
  status: string;
  category: string;
}) {
  return (
    <form method="get" className="project-filters" role="search" aria-label="Filter media">
      <div className="field">
        <label htmlFor="search">Search</label>
        <input
          id="search"
          name="search"
          type="search"
          defaultValue={search}
          placeholder="Filename"
        />
      </div>
      <div className="field">
        <label htmlFor="status">Status</label>
        <select id="status" name="status" defaultValue={status}>
          <option value="">All</option>
          <option value="quarantined">Quarantined</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="archived">Archived</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="category">Category</label>
        <select id="category" name="category" defaultValue={category}>
          <option value="">All</option>
          <option value="image">Image</option>
          <option value="document">Document</option>
        </select>
      </div>
      <button className="button" type="submit">
        APPLY
      </button>
    </form>
  );
}
