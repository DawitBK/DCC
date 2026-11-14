import type { ReactNode } from 'react';

export type Column<Row> = {
  /** Column heading. */
  header: string;
  cell: (row: Row) => ReactNode;
};

/**
 * A plain data table in the house style. `caption` is read by screen readers (it is not drawn).
 * `empty` is shown under the headings when there are no rows.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
}: {
  caption: string;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  empty?: ReactNode;
}) {
  return (
    <>
      <div className="table-wrap">
        <table>
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.header} scope="col">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.header}>{column.cell(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && empty}
    </>
  );
}
