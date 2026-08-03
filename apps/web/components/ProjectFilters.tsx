'use client';

export function ProjectFilters({
  search,
  status,
  sort,
  direction,
}: {
  search: string;
  status: string;
  sort: string;
  direction: string;
}) {
  return (
    <form method="get" className="project-filters" role="search" aria-label="Filter projects">
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
        <label htmlFor="sort">Sort by</label>
        <select id="sort" name="sort" defaultValue={sort}>
          <option value="order">Display order</option>
          <option value="title">Title</option>
          <option value="createdAt">Created</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="direction">Direction</label>
        <select id="direction" name="direction" defaultValue={direction}>
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </div>
      <button className="button" type="submit">
        APPLY
      </button>
    </form>
  );
}
