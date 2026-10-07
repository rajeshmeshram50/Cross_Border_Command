import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Col, Row } from 'reactstrap';
import DataTable, { type DataTableColumn } from '../../components/ui/DataTable';
import api from '../../api';
import { Shimmer } from '../../components/ui/Shimmer';

interface Props {
  clientId: number;
  clientName: string;
  onBack: () => void;
}

const typeIconMap: Record<string, string> = {
  company: 'ri-building-line',
  division: 'ri-git-branch-line',
  factory: 'ri-home-gear-line',
  warehouse: 'ri-archive-2-line',
};

export default function ClientBranches({ clientId, clientName, onBack }: Props) {
  const navigate = useNavigate();
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    api.get('/branches', { params: { client_id: clientId, per_page: 100 } })
      .then(res => setBranches(res.data.data || []))
      .finally(() => setLoading(false));
  }, [clientId]);

  const filtered = branches.filter(b => {
    if (!searchInput) return true;
    const q = searchInput.toLowerCase();
    return b.name?.toLowerCase().includes(q) || b.code?.toLowerCase().includes(q) || b.city?.toLowerCase().includes(q);
  });

  // Same cells the hand-rolled table rendered, as DataTable columns. The code
  // chip uses .dt-id-chip so it matches the id chip on every other list.
  const columns: DataTableColumn<Branch>[] = [
    {
      header: 'Branch Name',
      accessorKey: 'name',
      meta: { width: 320, wrap: true },
      cell: (info: any) => {
        const b = info.row.original;
        return (
          // Name only. The avatar square in front of it repeated the Code
          // column's first two characters, so it carried nothing the row did
          // not already say, and it pushed the name off the column's edge.
          <div style={{ minWidth: 0 }}>
            <div className="fw-semibold text-truncate">{b.name}</div>
            {b.description && (
              <div className="text-muted fs-12 text-truncate" style={{ maxWidth: 260 }}>{b.description}</div>
            )}
          </div>
        );
      },
    },
    {
      header: 'Code',
      accessorKey: 'code',
      meta: { width: 120, align: 'center' },
      cell: (info: any) => info.row.original.code
        ? <span className="dt-id-chip">{info.row.original.code}</span>
        : <span className="text-muted">—</span>,
    },
    {
      header: 'Type',
      accessorKey: 'branch_type',
      meta: { width: 150 },
      cell: (info: any) => {
        const b = info.row.original;
        if (!b.branch_type) return <span className="text-muted">—</span>;
        const typeIcon = typeIconMap[b.branch_type] || 'ri-git-branch-line';
        return (
          <span className="d-inline-flex align-items-center gap-1">
            <i className={`${typeIcon} text-muted`}></i>
            <span className="text-capitalize">{b.branch_type}</span>
          </span>
        );
      },
    },
    {
      header: 'Location',
      accessorKey: 'city',
      meta: { width: 220 },
      cell: (info: any) => {
        const b = info.row.original;
        return b.city ? <span>{b.city}{b.state ? `, ${b.state}` : ''}</span> : <span className="text-muted">—</span>;
      },
    },
    {
      header: 'Users',
      accessorKey: 'users_count',
      meta: { width: 110, align: 'center' },
      cell: (info: any) => (
        <span className="d-inline-flex align-items-center gap-1">
          <i className="ri-user-3-line text-muted"></i>
          <span className="fw-semibold">{info.row.original.users_count ?? 0}</span>
        </span>
      ),
    },
    {
      header: 'Status',
      accessorKey: 'status',
      meta: { width: 130, align: 'center' },
      cell: (info: any) => {
        const isActive = info.row.original.status === 'active';
        const color = isActive ? 'success' : 'danger';
        return (
          <span className={`badge rounded-pill bg-${color}-subtle text-${color} fw-semibold px-3 py-2`}>
            {isActive ? 'Active' : 'Inactive'}
          </span>
        );
      },
    },
  ];

  const totalUsers = branches.reduce((s: number, b: any) => s + (b.users_count || 0), 0);
  const activeBranches = branches.filter(b => b.status === 'active').length;

  const KPI_CARDS = [
    { label: 'Total',       value: branches.length,    icon: 'ri-git-branch-line',      gradient: 'linear-gradient(135deg,#405189,#6691e7)' },
    { label: 'Active',      value: activeBranches,     icon: 'ri-checkbox-circle-fill', gradient: 'linear-gradient(135deg,#0ab39c,#02c8a7)' },
    { label: 'Total Users', value: totalUsers,         icon: 'ri-user-3-line',          gradient: 'linear-gradient(135deg,#299cdb,#5fc8ff)' },
  ];

  return (
    <>
      <style>{`
        .branches-surface { background: #ffffff; }
        /* Back is an ACTION, so it looks like one — the outlined counterpart to
           the solid buttons elsewhere, matching Client Profile's .cv-back-btn.
           NOTE: no backticks in these comments, the block is a template literal. */
        /* The close X replaces the old Back pill and its breadcrumb. This page
           has no hero banner to hang it on, so it sits top-right of the surface
           card — and the card needs a band for it. At 12px from the top it hung
           26px down over the first KPI card, because the surface's own 20px of
           padding is less than the button is tall. 52px is the button plus its
           insets: far less than the 70px title strip this replaced, and nothing
           overlaps.
           NOTE: no backticks in these comments; the block is a template literal. */
        .branches-surface { position: relative; padding-top: 52px !important; }
        .cb-close-btn {
          position: absolute; top: 12px; right: 12px; z-index: 3;
          display: inline-flex; align-items: center; justify-content: center;
          width: 34px; height: 34px;
          border-radius: 999px;
          border: 1px solid var(--vz-border-color);
          background: var(--vz-secondary-bg);
          color: var(--vz-secondary-color);
          cursor: pointer;
          transition: background .15s, border-color .15s, color .15s, transform .15s;
        }
        .cb-close-btn i { font-size: 18px; line-height: 1; }
        .cb-close-btn:hover {
          background: #f5f3ff; border-color: #c4b5fd; color: #6d28d9;
          transform: translateY(-1px);
        }
        [data-bs-theme="dark"] .cb-close-btn:hover,
        [data-layout-mode="dark"] .cb-close-btn:hover {
          background: rgba(139, 92, 246, 0.14); color: #c4b5fd; border-color: rgba(167, 139, 250, 0.40);
        }

        /* 8px between the blocks inside the surface, the page's own number. The
           KPI row carried g-3 (16px gutters) and mb-3, so the strip, the cards
           and the table all sat on different spacings. */
        .branches-surface > .row { --vz-gutter-x: 8px; --vz-gutter-y: 8px; --bs-gutter-x: 8px; --bs-gutter-y: 8px; }
        .branches-surface > .row.mb-3 { margin-bottom: 8px !important; }

        [data-bs-theme="dark"] .branches-surface { background: #1c2531; }

        /* KPI hover — mirrors the lift/shadow/icon-rotate used on the
           BranchDashboard and Branches list KPI cards so this view feels
           consistent with the rest of the app. */
        .cb-kpi {
          transition:
            transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1),
            box-shadow 220ms ease,
            border-color 220ms ease;
          will-change: transform;
        }
        .cb-kpi:hover {
          transform: translateY(-4px);
          box-shadow:
            0 18px 36px -8px rgba(64, 81, 137, 0.28),
            0 8px 16px -4px rgba(64, 81, 137, 0.18),
            0 2px 4px rgba(0, 0, 0, 0.06) !important;
          border-color: rgba(64, 81, 137, 0.35) !important;
        }
        .cb-kpi:hover .cb-kpi-icon {
          transform: scale(1.08) rotate(-3deg);
          box-shadow: 0 10px 22px rgba(0, 0, 0, 0.22);
        }
        .cb-kpi-icon {
          transition:
            transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1),
            box-shadow 220ms ease;
        }
        [data-bs-theme="dark"] .cb-kpi:hover {
          box-shadow:
            0 18px 36px -8px rgba(0, 0, 0, 0.65),
            0 8px 16px -4px rgba(0, 0, 0, 0.45),
            0 2px 4px rgba(0, 0, 0, 0.30) !important;
          border-color: rgba(124, 92, 252, 0.50) !important;
        }
      `}</style>

      {/* No page-title strip. The heading repeated the menu item that opened
          this page, and Back plus the breadcrumb said the same thing twice;
          the close X on the card below does the job in one glyph. */}

      <Row>
        <Col xs={12}>
          <div
            className="branches-surface"
            style={{
              borderRadius: 16,
              border: '1px solid var(--vz-border-color)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
              padding: '20px',
            }}
          >
            <button type="button" className="cb-close-btn" onClick={onBack} aria-label="Close">
              <i className="ri-close-line" />
            </button>

            {/* ── KPI cards (single row, equal height) ── */}
            <Row className="g-3 mb-3 align-items-stretch">
              {/* md=4, not md=3: there are three KPIs, and a four-up grid left
                  the last quarter of the row empty. */}
              {KPI_CARDS.map(k => (
                <Col key={k.label} md={4} sm={6} xs={12}>
                  <div
                    className="branches-surface cb-kpi"
                    style={{
                      borderRadius: 14,
                      border: '1px solid var(--vz-border-color)',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                      padding: '16px 18px',
                      position: 'relative',
                      overflow: 'hidden',
                      height: '100%',
                    }}
                  >
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.gradient }} />
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', height: '100%' }}>
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 8px' }}>
                          {k.label}
                        </p>
                        {loading ? (
                          <Shimmer width={72} height={26} radius={6} style={{ marginTop: 2 }} />
                        ) : (
                          <h3 style={{ fontSize: 26, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
                            {k.value.toLocaleString()}
                          </h3>
                        )}
                      </div>
                      <div className="cb-kpi-icon" style={{ width: 44, height: 44, borderRadius: 10, background: k.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.10)' }}>
                        <i className={k.icon} style={{ fontSize: 20, color: '#fff' }} />
                      </div>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>

            {/* The shared list table, as Clients, Branches and Payments use.
                It brings the toolbar search, the violet-on-pale header and
                fitToViewport, which stretches the table to the footer instead
                of ending at the last row. The hand-rolled <table> it replaces
                had a grey Velzon header and its own full-width search row. */}
            <DataTable<Branch>
              data={filtered}
              columns={columns}
              serial
              className="hr-dt"
              accent="violet"
              minWidth={1100}
              fitToViewport
              autoFitRows
              loading={loading}
              searchValue={searchInput}
              onSearchChange={setSearchInput}
              searchPlaceholder="Search by name, code, city..."
              emptyMessage={
                <>
                  <i className="ri-git-branch-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                  No branches found
                </>
              }
            />
          </div>
        </Col>
      </Row>
    </>
  );
}
