import React, { Fragment, useEffect, useState } from "react";
import { CardBody, Col, Row, Table } from "reactstrap";
import { Link } from "react-router-dom";

import {
  Column,
  Table as ReactTable,
  ColumnFiltersState,
  FilterFn,
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender
} from '@tanstack/react-table';

import { rankItem } from '@tanstack/match-sorter-utils';

// Column Filter
const Filter = ({
  column
}: {
  column: Column<any, unknown>;
  table: ReactTable<any>;
}) => {
  const columnFilterValue = column.getFilterValue();

  return (
    <>
      <DebouncedInput
        type="text"
        value={(columnFilterValue ?? '') as string}
        onChange={value => column.setFilterValue(value)}
        placeholder="Search..."
        className="w-36 border shadow rounded"
        list={column.id + 'list'}
      />
      <div className="h-1" />
    </>
  );
};

// Global Filter
const DebouncedInput = ({
  value: initialValue,
  onChange,
  debounce = 500,
  ...props
}: {
  value: string | number;
  onChange: (value: string | number) => void;
  debounce?: number;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'>) => {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      onChange(value);
    }, debounce);

    return () => clearTimeout(timeout);
  }, [debounce, onChange, value]);

  return (
    <input {...props} value={value} id="search-bar-0" className="form-control border-0 search" onChange={e => setValue(e.target.value)} />
  );
};

interface TableContainerProps {
  columns?: any;
  data?: any;
  isGlobalFilter?: any;
  handleTaskClick?: any;
  customPageSize?: any;
  tableClass?: any;
  theadClass?: any;
  trClass?: any;
  thClass?: any;
  divClass?: any;
  SearchPlaceholder?: any;
  handleLeadClick?: any;
  handleCompanyClick?: any;
  handleContactClick?: any;
  handleTicketClick?: any;
  isBordered?: any;
}

const TableContainer = ({
  columns,
  data,
  isGlobalFilter,
  customPageSize,
  tableClass,
  theadClass,
  trClass,
  thClass,
  divClass,
  SearchPlaceholder,
  isBordered

}: TableContainerProps) => {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  const fuzzyFilter: FilterFn<any> = (row, columnId, value, addMeta) => {
    const itemRank = rankItem(row.getValue(columnId), value);
    addMeta({
      itemRank
    });
    return itemRank.passed;
  };

  const table = useReactTable({
    columns,
    data,
    filterFns: {
      fuzzy: fuzzyFilter,
    },
    state: {
      columnFilters,
      globalFilter,
    },
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: fuzzyFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel()
  });

  const {
    getHeaderGroups,
    getRowModel,
    getCanPreviousPage,
    getCanNextPage,
    getPageOptions,
    setPageIndex,
    nextPage,
    previousPage,
    setPageSize,
    getState
  } = table;

  useEffect(() => {
    Number(customPageSize) && setPageSize(Number(customPageSize));
  }, [customPageSize, setPageSize]);

  return (
    <Fragment>
      {isGlobalFilter && <Row className="mb-3">
        <CardBody className="border border-dashed border-end-0 border-start-0">
          <form>
            <Row>
              <Col sm={5}>
                <div className="search-box me-2 mb-2 d-inline-block col-12">
                  <DebouncedInput
                    value={globalFilter ?? ''}
                    onChange={value => setGlobalFilter(String(value))}
                    placeholder={SearchPlaceholder}
                  />
                  <i className="bx bx-search-alt search-icon"></i>
                </div>
              </Col>
            </Row>
          </form>
        </CardBody>
      </Row>}


      <div className={divClass}>
        <Table hover className={tableClass}>
          <thead className={theadClass}>
            {getHeaderGroups().map((headerGroup: any) => (
              <tr className={trClass} key={headerGroup.id}>
                {headerGroup.headers.map((header: any) => {
                  /* Column sorting was disabled across the table component
                   * deliberately:
                   *   - Users reported the asc/desc arrows feeling random
                   *     on tables with a Date column (e.g. Client → Payment
                   *     History) because a double-click toggled the
                   *     direction twice and they were left with the
                   *     opposite of what they expected.
                   *   - Several columns render formatted strings (`DD MMM
                   *     YYYY`, currency, pill labels) where the lexical
                   *     react-table sort doesn't match the visual order.
                   *   - Lists across the app already have a server-side
                   *     "Recent / Price / Rating" sort dropdown that
                   *     drives ordering.
                   * Removing the header click handler AND the asc/desc
                   * arrow icons leaves a clean static header — the
                   * dataset still respects whatever sort the page already
                   * applies before passing rows in. */
                  const align: 'start' | 'center' | 'end' =
                    (header.column.columnDef as any)?.meta?.align || 'start';
                  const justify =
                    align === 'center' ? 'center' :
                    align === 'end'    ? 'flex-end' : 'flex-start';
                  const textAlign =
                    align === 'center' ? 'center' :
                    align === 'end'    ? 'right' : 'left';
                  return (
                  <th
                    key={header.id}
                    className={thClass}
                    style={{ cursor: 'default', userSelect: 'none', textAlign }}
                  >
                    {header.isPlaceholder ? null : (
                      <span className="d-flex align-items-center gap-1" style={{ justifyContent: justify }}>
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                      </span>
                    )}
                  </th>
                );
                })}
              </tr>
            ))}
          </thead>

          <tbody>
            {getRowModel().rows.map((row: any) => {
              return (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell: any) => {
                    // Mirror the header alignment on the data cell so the
                    // column reads as one tidy vertical strip regardless
                    // of whether the cell content itself is centered.
                    const cellAlign: 'start' | 'center' | 'end' =
                      (cell.column.columnDef as any)?.meta?.align || 'start';
                    const cellTextAlign =
                      cellAlign === 'center' ? 'center' :
                      cellAlign === 'end'    ? 'right' : 'left';
                    return (
                      <td key={cell.id} style={{ textAlign: cellTextAlign }}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      <Row className="align-items-center mt-2 g-3 text-center text-sm-start">
        <div className="col-sm">
          <div className="text-muted">Showing<span className="fw-semibold ms-1">{getRowModel().rows.length}</span> of <span className="fw-semibold">{data.length}</span> Results
          </div>
        </div>
        <div className="col-sm-auto">
          <ul className="pagination pagination-separated pagination-md justify-content-center justify-content-sm-start mb-0">
            <li className={!getCanPreviousPage() ? "page-item disabled" : "page-item"}>
              <Link to="#" className="page-link" onClick={previousPage}><i className="ri-arrow-left-s-line"></i></Link>
            </li>
            {(() => {
              // Windowed pagination: keeps the bar at ~9 items regardless of
              // total page count. Shows first, last, current ± 1, and inserts
              // an ellipsis ("…") wherever there's a gap. With ≤7 pages we
              // render every number (no ellipsis needed).
              const total = getPageOptions().length;
              const current = getState().pagination.pageIndex;
              const siblings = 1;
              const items: Array<number | 'ellipsis-l' | 'ellipsis-r'> = [];
              if (total <= 7) {
                for (let i = 0; i < total; i++) items.push(i);
              } else {
                const left = Math.max(current - siblings, 1);
                const right = Math.min(current + siblings, total - 2);
                items.push(0);
                if (left > 1) items.push('ellipsis-l');
                for (let i = left; i <= right; i++) items.push(i);
                if (right < total - 2) items.push('ellipsis-r');
                items.push(total - 1);
              }
              return items.map((item, key) => {
                if (item === 'ellipsis-l' || item === 'ellipsis-r') {
                  return (
                    <li key={`${item}-${key}`} className="page-item disabled">
                      <span className="page-link" style={{ cursor: 'default' }}>…</span>
                    </li>
                  );
                }
                const isActive = current === item;
                return (
                  <li key={item} className="page-item">
                    <Link
                      to="#"
                      className={isActive ? "page-link active" : "page-link"}
                      style={isActive ? { backgroundColor: 'var(--vz-secondary)', borderColor: 'var(--vz-secondary)', color: '#fff' } : undefined}
                      onClick={() => setPageIndex(item)}
                    >
                      {item + 1}
                    </Link>
                  </li>
                );
              });
            })()}
            <li className={!getCanNextPage() ? "page-item disabled" : "page-item"}>
              <Link to="#" className="page-link" onClick={nextPage}><i className="ri-arrow-right-s-line"></i></Link>
            </li>
          </ul>
        </div>
      </Row>
    </Fragment>
  );
};

export default TableContainer;