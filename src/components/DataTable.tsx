import { columnLabel } from "../csv/contracts";
import type { CsvColumn, CsvPage } from "../csv/contracts";
export function DataTable({
  columns,
  page,
  selected,
  preview = false,
}: {
  columns: readonly CsvColumn[];
  page: CsvPage;
  selected: ReadonlySet<string>;
  preview?: boolean;
}) {
  return (
    <div
      className="table-scroll"
      tabIndex={0}
      role="region"
      aria-label={preview ? "File preview" : "Original file data"}
    >
      <table>
        <caption className="sr-only">
          {preview
            ? "First five data rows. Values are unchanged."
            : "Original data. Selected columns are marked for review."}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="row-number">
              Row
            </th>
            {columns.map((column) => (
              <th
                scope="col"
                key={column.id}
                className={selected.has(column.id) ? "chosen-column" : ""}
              >
                <span className="column-position">{column.index + 1}</span>
                <span>{columnLabel(column)}</span>
                {selected.has(column.id) && (
                  <span className="column-status">To review</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.rows.map((row, index) => (
            <tr key={row.id}>
              <th scope="row" className="row-number">
                {page.offset + index + 1}
              </th>
              {row.values.map((value, columnIndex) => (
                <td
                  key={columns[columnIndex]!.id}
                  className={
                    selected.has(columns[columnIndex]!.id)
                      ? "chosen-column"
                      : ""
                  }
                >
                  <span className="cell-value">
                    {value === "" ? (
                      <span className="empty-value" aria-label="Empty value">
                        —
                      </span>
                    ) : value.length > 240 ? (
                      <span title="Long value shortened in this preview">
                        {value.slice(0, 240)}…
                      </span>
                    ) : (
                      value
                    )}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
