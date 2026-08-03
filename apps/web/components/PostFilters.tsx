'use client';

export function PostFilters({
  search,
  status,
  tag,
}: {
  search: string;
  status: string;
  tag: string;
}) {
  return (
    <form method="get" className="project-filters" role="search" aria-label="Filter posts">
      <div className="field">
        <label htmlFor="search">Search</label>
        <input
          id="search"
          name="search"
          type="search"
          defaultValue={search}
          placeholder="Title or slug"
        />
      </div>
      <div className="field">
        <label htmlFor="status">Status</label>
        <select id="status" name="status" defaultValue={status}>
          <option value="">All</option>
          <option value="draft">Draft</option>
          <option value="review">In review</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="tag">Tag</label>
        <input id="tag" name="tag" defaultValue={tag} placeholder="e.g. testing" />
      </div>
      <button className="button" type="submit">
        APPLY
      </button>
    </form>
  );
}
