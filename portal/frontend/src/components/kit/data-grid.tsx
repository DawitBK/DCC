'use client';

import { useId, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { downloadCsv } from './csv';

export type GridColumn<Row> = {
  /** Stable id (used for sorting and the column chooser). */
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  /** Makes the column sortable; also the value exported when `exportValue` is not given. */
  sortValue?: (row: Row) => string | number | null;
  /** The text of the cell in the exported CSV file. */
  exportValue?: (row: Row) => string;
  align?: 'right';
  /** Hidden until the person turns it on in "Columns". */
  hiddenByDefault?: boolean;
};

export type GridFilter<Row> = {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  test: (row: Row, value: string) => boolean;
};

type Sort = { id: string; direction: 'asc' | 'desc' } | null;

const PAGE_SIZES = [10, 25, 50, 100];

const TEXT = {
  search: 'Search',
  searchPlaceholder: 'Search this list',
  all: 'All',
  columns: 'Columns',
  export: 'Export CSV',
  clear: 'Clear filters',
  perPage: 'Rows per page',
  previous: 'Previous',
  next: 'Next',
  noMatch: 'Nothing matches these filters.',
  noMatchHint: 'Change or clear the filters to see more.',
  showing: (from: number, to: number, total: number) =>
    total === 0 ? 'No rows' : `Showing ${from}–${to} of ${total}`,
  filtered: (shown: number, total: number) => `${shown} of ${total} match`,
  sortedBy: (name: string, direction: string) => `Sorted by ${name}, ${direction}`,
  ascending: 'ascending',
  descending: 'descending',
  page: (page: number, pages: number) => `Page ${page} of ${pages}`,
};

function compare(a: string | number | null, b: string | number | null, direction: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // empty values always last
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * direction;
  return (
    String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }) *
    direction
  );
}

/**
 * The list every screen uses: search, filters, sortable columns, a column chooser, paging and a CSV
 * export of exactly what is on screen (the filtered rows, all pages). It works on the rows the API gave:
 * nothing is hidden from the person, only arranged.
 *
 * `onOpen` makes a click on a row open the thing (a link inside the row stays the keyboard way in).
 */
export function DataGrid<Row>({
  caption,
  columns,
  rows,
  rowKey,
  searchText,
  filters,
  toolbar,
  empty,
  onOpen,
  defaultSort = null,
  pageSize = 25,
  exportName,
  rowTone,
}: {
  caption: string;
  columns: GridColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** Everything a search should match in a row, as one string. Omit to hide the search box. */
  searchText?: (row: Row) => string;
  filters?: GridFilter<Row>[];
  /** Extra controls on the right of the toolbar. */
  toolbar?: ReactNode;
  /** Shown when the list itself is empty (not when filters hide everything). */
  empty?: ReactNode;
  onOpen?: (row: Row) => void;
  defaultSort?: Sort;
  pageSize?: number;
  /** File name (without .csv) for the export; omit to hide the export button. */
  exportName?: string;
  /** A class added to a row, for example to mark an overdue item. */
  rowTone?: (row: Row) => string | undefined;
}) {
  const uid = useId();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>(defaultSort);
  const [values, setValues] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(pageSize);
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.hiddenByDefault).map((c) => c.id)),
  );

  const visible = columns.filter((column) => !hidden.has(column.id));

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (needle && searchText && !searchText(row).toLowerCase().includes(needle)) return false;
      return (filters ?? []).every((filter) => {
        const value = values[filter.id];
        return !value || filter.test(row, value);
      });
    });
  }, [rows, query, searchText, filters, values]);

  const sorted = useMemo(() => {
    const column = sort ? columns.find((c) => c.id === sort.id) : undefined;
    if (!sort || !column?.sortValue) return filtered;
    const get = column.sortValue;
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => compare(get(a), get(b), direction));
  }, [filtered, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const current = Math.min(page, pages - 1);
  const from = current * size;
  const slice = sorted.slice(from, from + size);
  const filtering = query.trim() !== '' || Object.values(values).some(Boolean);
  const sortColumn = sort ? columns.find((c) => c.id === sort.id) : undefined;

  const toggleSort = (column: GridColumn<Row>) => {
    if (!column.sortValue) return;
    setSort((now) =>
      now?.id !== column.id
        ? { id: column.id, direction: 'asc' }
        : now.direction === 'asc'
          ? { id: column.id, direction: 'desc' }
          : null,
    );
    setPage(0);
  };

  const exportCsv = () => {
    if (!exportName) return;
    downloadCsv(
      `${exportName}.csv`,
      visible.map((c) => c.header),
      sorted.map((row) =>
        visible.map((c) => {
          if (c.exportValue) return c.exportValue(row);
          const v = c.sortValue?.(row);
          return v === null || v === undefined ? '' : String(v);
        }),
      ),
    );
  };

  const click = (event: MouseEvent<HTMLTableRowElement>, row: Row) => {
    if (!onOpen) return;
    if ((event.target as HTMLElement).closest('a, button, input, select, textarea, label, summary'))
      return;
    onOpen(row);
  };

  const showBar =
    Boolean(searchText) || Boolean(filters?.length) || Boolean(exportName) || Boolean(toolbar);
  const listEmpty = rows.length === 0 && Boolean(empty);

  if (listEmpty) return <div className="kit-grid">{empty}</div>;

  return (
    <div className="kit-grid">
      {showBar && (
        <div className="kit-toolbar">
          <div className="kit-toolbar-left">
            {searchText && (
              <div className="kit-search">
                <label className="visually-hidden" htmlFor={`${uid}-q`}>
                  {TEXT.search}
                </label>
                <input
                  id={`${uid}-q`}
                  type="search"
                  className="field"
                  placeholder={TEXT.searchPlaceholder}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(0);
                  }}
                />
              </div>
            )}
            {(filters ?? []).map((filter) => (
              <div key={filter.id} className="kit-filter">
                <label className="visually-hidden" htmlFor={`${uid}-${filter.id}`}>
                  {filter.label}
                </label>
                <select
                  id={`${uid}-${filter.id}`}
                  className="select-field"
                  value={values[filter.id] ?? ''}
                  onChange={(event) => {
                    setValues((now) => ({ ...now, [filter.id]: event.target.value }));
                    setPage(0);
                  }}
                >
                  <option value="">{`${filter.label}: ${TEXT.all}`}</option>
                  {filter.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {filtering && (
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setQuery('');
                  setValues({});
                  setPage(0);
                }}
              >
                {TEXT.clear}
              </button>
            )}
          </div>
          <div className="kit-toolbar-right">
            {filtering && (
              <span className="kit-count" role="status">
                {TEXT.filtered(sorted.length, rows.length)}
              </span>
            )}
            {columns.length > 3 && (
              <details className="kit-columns">
                <summary className="btn btn-outline">{TEXT.columns}</summary>
                <div className="kit-columns-menu">
                  {columns.map((column) => (
                    <label key={column.id}>
                      <input
                        type="checkbox"
                        checked={!hidden.has(column.id)}
                        onChange={(event) =>
                          setHidden((now) => {
                            const next = new Set(now);
                            if (event.target.checked) next.delete(column.id);
                            else if (visible.length > 1) next.add(column.id);
                            return next;
                          })
                        }
                      />{' '}
                      {column.header}
                    </label>
                  ))}
                </div>
              </details>
            )}
            {exportName && (
              <button type="button" className="btn btn-outline" onClick={exportCsv}>
                {TEXT.export}
              </button>
            )}
            {toolbar}
          </div>
        </div>
      )}

      <div className="table-wrap" role="region" aria-label={caption} tabIndex={0}>
        <table className="kit-table">
          <caption className="visually-hidden">
            {caption}
            {sort && sortColumn
              ? `. ${TEXT.sortedBy(sortColumn.header, sort.direction === 'asc' ? TEXT.ascending : TEXT.descending)}`
              : ''}
          </caption>
          <thead>
            <tr>
              {visible.map((column) => {
                const active = sort?.id === column.id ? sort : null;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    className={column.align === 'right' ? 'kit-right' : undefined}
                    aria-sort={
                      active ? (active.direction === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                  >
                    {column.sortValue ? (
                      <button type="button" className="kit-sort" onClick={() => toggleSort(column)}>
                        {column.header}
                        <span aria-hidden="true" className="kit-sort-mark">
                          {active ? (active.direction === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {slice.map((row) => (
              <tr
                key={rowKey(row)}
                className={
                  [onOpen ? 'kit-row-open' : '', rowTone?.(row) ?? ''].join(' ').trim() || undefined
                }
                onClick={(event) => click(event, row)}
              >
                {visible.map((column) => (
                  <td
                    key={column.id}
                    className={column.align === 'right' ? 'kit-right' : undefined}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length === 0 && (
        <div className="empty-state">
          <div>
            <strong>{TEXT.noMatch}</strong>
            <p>{TEXT.noMatchHint}</p>
          </div>
        </div>
      )}
      {sorted.length > Math.min(...PAGE_SIZES) && (
        <div className="kit-pager">
          <span className="kit-count">
            {TEXT.showing(
              sorted.length ? from + 1 : 0,
              Math.min(from + size, sorted.length),
              sorted.length,
            )}
          </span>
          <div className="kit-pager-controls">
            <label className="kit-pager-size">
              <span>{TEXT.perPage}</span>
              <select
                className="select-field"
                value={size}
                onChange={(event) => {
                  setSize(Number(event.target.value));
                  setPage(0);
                }}
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-outline"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              {TEXT.previous}
            </button>
            <span className="kit-count" aria-live="polite">
              {TEXT.page(current + 1, pages)}
            </span>
            <button
              type="button"
              className="btn btn-outline"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
            >
              {TEXT.next}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
