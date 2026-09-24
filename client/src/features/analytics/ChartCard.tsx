import { useId, useState, type ReactNode } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface TableColumn<Row> {
  header: string;
  cell: (row: Row) => ReactNode;
  /** Right-aligned, tabular figures. */
  numeric?: boolean;
}

interface Props<Row> {
  title: string;
  /**
   * One sentence saying what the chart shows: the total, the peak, the
   * trend. Visible to everyone, and what a screen reader hears first.
   */
  summary: string;
  /** The same numbers as the chart, row by row. */
  columns: TableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** The chart itself. Hidden from assistive technology: the table says it all. */
  children: ReactNode;
  /** Shown instead of the chart when there is nothing to draw. */
  emptyMessage?: string;
  className?: string;
}

/**
 * A chart with its text alternative built in.
 *
 * - The **summary** sentence sits under the title for everyone.
 * - The **table** holds every number the chart draws. Screen readers always
 *   have it (it is visually hidden, not removed, while the chart shows), and
 *   **Show table** swaps the chart for it on screen - for keyboard users,
 *   for anyone who wants exact figures, and for printing.
 * - The **chart** is `aria-hidden` and not focusable: a picture of numbers
 *   the table already gives, rather than an SVG full of unlabelled shapes.
 */
export function ChartCard<Row>({
  title,
  summary,
  columns,
  rows,
  rowKey,
  children,
  emptyMessage,
  className,
}: Props<Row>) {
  const [asTable, setAsTable] = useState(false);
  const titleId = useId();
  const summaryId = useId();
  const empty = rows.length === 0 && emptyMessage;

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={summaryId}
      className={cn('flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5', className)}
    >
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <h2 id={titleId} className="min-w-0 flex-1 text-base font-semibold">
          {title}
        </h2>
        {!empty && (
          <Button
            variant="ghost"
            size="sm"
            className="-my-1 h-8 text-muted-foreground"
            onClick={() => setAsTable((value) => !value)}
          >
            {asTable ? <BarChart3 aria-hidden="true" /> : <Table2 aria-hidden="true" />}
            {asTable ? 'Show chart' : 'Show table'}
            <span className="sr-only"> for {title}</span>
          </Button>
        )}
        <p id={summaryId} className="w-full text-sm text-muted-foreground">
          {summary}
        </p>
      </header>

      {empty ? (
        <p className="grid min-h-40 place-items-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <>
          <div aria-hidden="true" data-slot="chart" className={cn(asTable && 'hidden')}>
            {children}
          </div>
          <div
            className={cn(asTable ? 'overflow-x-auto rounded-lg border' : 'sr-only')}
            // A scrollable region must be reachable by keyboard - but only
            // while it is on screen.
            {...(asTable ? { tabIndex: 0, role: 'region', 'aria-label': `${title}, table` } : {})}
          >
            <table className="w-full text-sm">
              <caption className="sr-only">{title}</caption>
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  {columns.map((column, index) => (
                    <th
                      key={column.header}
                      scope="col"
                      className={cn(
                        'px-3 py-2 font-medium',
                        column.numeric && 'text-right',
                        index === 0 && 'whitespace-nowrap',
                      )}
                    >
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={rowKey(row)} className="border-t">
                    {columns.map((column, index) =>
                      index === 0 ? (
                        <th
                          key={column.header}
                          scope="row"
                          className="whitespace-nowrap px-3 py-2 text-left font-medium"
                        >
                          {column.cell(row)}
                        </th>
                      ) : (
                        <td
                          key={column.header}
                          className={cn('px-3 py-2', column.numeric && 'text-right tabular-nums')}
                        >
                          {column.cell(row)}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
