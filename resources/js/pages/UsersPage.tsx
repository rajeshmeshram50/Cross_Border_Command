import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody, Input } from 'reactstrap';
import api from '../api';
import { ShimmerTableRows } from '../components/ui/Shimmer';
import WorklistPager from '../components/ui/WorklistPager';

interface UserRow {
  id: number;
  name: string;
  email: string;
  user_type: string;
  client_id?: number | null;
  branch_id?: number | null;
  status: string;
}

interface Props {
  branchId?: number;
  branchName?: string;
  onBack?: () => void;
}


export default function UsersPage({ branchId, branchName, onBack }: Props) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [resolvedBranchName, setResolvedBranchName] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params: Record<string, any> = {};
    if (branchId) params.branch_id = branchId;
    api.get('/permissions/users', { params })
      .then(({ data }) => {
        if (cancelled) return;
        // When opened from the Branches → Users action, "users" really
        // means "people working at this branch" → employees only.
        // The /permissions/users endpoint returns every user the admin
        // can manage (branch_user logins, employees, etc.), so we
        // narrow the list client-side. When branchId isn't passed
        // (sidebar entry) we keep the full list.
        const list = Array.isArray(data) ? data : [];
        const narrowed = branchId
          ? list.filter((u: UserRow) => u.user_type === 'employee')
          : list;
        setUsers(narrowed);
      })
      .catch(() => { if (!cancelled) setUsers([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [branchId]);

  // Fall back to fetching the branch name if the navigation state didn't
  // carry it (deep links / refresh).
  useEffect(() => {
    if (!branchId || branchName) { setResolvedBranchName(branchName || ''); return; }
    let cancelled = false;
    api.get(`/branches/${branchId}`)
      .then(({ data }) => { if (!cancelled) setResolvedBranchName(data?.name || ''); })
      .catch(() => { if (!cancelled) setResolvedBranchName(''); });
    return () => { cancelled = true; };
  }, [branchId, branchName]);

  const displayBranchName = branchName || resolvedBranchName;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      [u.name, u.email, u.user_type].filter(Boolean).some(v => String(v).toLowerCase().includes(q))
    );
  }, [users, search]);

  /* ── Dynamic pagination ────────────────────────────────────────────────
     Rows-per-page is measured from the space the table actually has, the same
     way CLM Segment Master and the other list screens do it: the card is given
     a hard height down to just above the footer, and the row count is derived
     from that height. A short list then fills the card instead of floating in
     it, and a long one pages rather than running off the screen.

     autoFitRef stops the measurement the moment someone picks a rows-per-page
     themselves — an explicit choice should not be recomputed away on the next
     resize. */
  const [page, setPage] = useState(1);
  const [rpp, setRpp] = useState(10);
  const autoFitRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const recompute = () => {
      const el = scrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      /* The space between the top of the table and the footer decides two
         things: how tall the card is, and how many rows a page holds.

         Clamped to the viewport because top is viewport-relative: on a scrolled
         page it shrinks, which would ask for a taller box, which scrolls
         further, which shrinks top again. The clamp ends that regardless. */
      const avail = Math.min(
        window.innerHeight - 50,
        Math.max(240, window.innerHeight - top - 50),
      );
      // The box takes that height whether or not it has the rows to fill it, so
      // a two-row list still reaches the footer and the pager sits on the
      // bottom edge rather than halfway up an otherwise empty page.
      el.style.height = `${avail}px`;
      el.style.maxHeight = `${avail}px`;
      if (autoFitRef.current) {
        const THEAD = 44, PAGER = 52, ROW = 46;
        const fit = Math.max(4, Math.floor((avail - THEAD - PAGER) / ROW));
        setRpp(prev => (prev === fit ? prev : fit));
      }
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    // The first pass can run before the header strip has taken its final
    // height, which measures the table too low and under-counts the rows.
    const settle1 = setTimeout(recompute, 220);
    const settle2 = setTimeout(recompute, 520);
    let t: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => { if (t) clearTimeout(t); t = setTimeout(recompute, 140); };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle1); clearTimeout(settle2);
      if (t) clearTimeout(t);
      window.removeEventListener('resize', onResize);
    };
  }, [loading]);

  // Slice for the current page. Clamped, so deleting the last row of page 3
  // lands on page 2 rather than on an empty table.
  const pageCount = Math.max(1, Math.ceil(filtered.length / rpp));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const pageRows = filtered.slice((safePage - 1) * rpp, (safePage - 1) * rpp + rpp);

  // A new search is a new result set — start it at the top.
  useEffect(() => { setPage(1); }, [search]);

  const typeLabel = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <>
      {/* The house header strip (.frm-cstrip, app.css) — the same one the
          Branches, Employee and Customer screens open with. This page had a
          plain page-title-box with a breadcrumb hanging off the right, which
          matched nothing else in the app; the breadcrumb was also decorative,
          since its first two crumbs were href="#" and went nowhere. Back is the
          one that actually navigated, and it stays. */}
      <div className="frm-cstrip mb-3">
        <span className="frm-cstrip-accent" />
        <div className="frm-cstrip-left">
          <div className="frm-cstrip-icon"><i className="ri-team-line" /></div>
          <div className="min-w-0">
            <div className="frm-cstrip-title">{branchId ? 'Employees' : 'Users'}</div>
            <div className="frm-cstrip-sub">
              {displayBranchName
                ? `People with a login at ${displayBranchName}`
                : 'People with a login on this account'}
            </div>
          </div>
        </div>
        {onBack && (
          <div className="d-flex align-items-center gap-2 flex-shrink-0">
            <button type="button" className="frm-cstrip-back" onClick={onBack}>
              <i className="ri-arrow-left-line" />
              Back
            </button>
          </div>
        )}
      </div>

      {/* Table skin only — the markup below is untouched. Every other list in
          the app wears the violet header band that DataTable paints; this one
          was on Bootstrap's grey .table-light, which is why it read as a
          different product. The values mirror .dt-table thead th in
          components/ui/DataTable.css so the two stay in step. */}
      <style>{`
        /* Fill the screen the way every other list does. With two rows the card
           shrank to two rows tall and floated in the middle of an empty page,
           which is the one thing that made it read as unfinished. The card now
           reaches down to the footer and the rows sit at the top of it, so a
           short list looks like a short list rather than a broken card.

           The 290px is the chrome above and below: top bar, header strip, its
           margin, and the app footer. Approximate on purpose — it only decides
           how much empty space shows under the last row. */
        .up-table-card { border-radius: 16px; overflow: hidden; }
        .up-table-card > .card-body { display: flex; flex-direction: column; }
        /* Height is set in JS from the space left above the footer — see the
           recompute effect. overflow-y so a page that slightly overflows
           scrolls inside the card rather than pushing the pager off-screen. */
        /* The measured box holds the table AND the pager, and the pager is
           pushed to its bottom. Keeping the pager outside made the card taller
           than the height that was measured for it, so the page scrolled — and
           because the measurement reads getBoundingClientRect().top, scrolling
           then fed a smaller top back in, which grew the height, which added
           rows. That loop is why rows-per-page climbed to 25 on a screen that
           fits eight. */
        .up-table-wrap { display: flex; flex-direction: column; overflow: auto; }
        /* Position only. .wl-pager (app.css) already brings its own border,
           gradient and padding — adding more here drew a second rule above the
           first and padded the band twice. */
        /* margin-top:auto pins the band to the bottom of the measured box, so
           it sits on the footer edge whether the page holds two rows or twelve.
           sticky-left keeps it in view when a wide table scrolls sideways.
           Styling is left to .wl-pager in app.css — it already carries its own
           border, gradient and padding. */
        .up-table-wrap > .wl-pager {
          margin-top: auto;
          position: sticky; left: 0;
          width: 100%; box-sizing: border-box;
        }
        .up-table thead th {
          background: color-mix(in srgb, #8b5cf6 60%, #7c3aed);
          color: #fff;
          font-size: 9.5px;
          font-weight: 800;
          letter-spacing: .07em;
          text-transform: uppercase;
          padding: 9px;
          line-height: 1.3;
          border: 0;
          vertical-align: middle;
          text-shadow: 0 1px 2px rgba(0,0,0,.18);
          white-space: nowrap;
        }
        .up-table tbody td { padding: 10px 9px; border-color: var(--vz-border-color); }
        /* Sr No and the two badge columns centre; Name and Email stay left.
           A badge is a fixed shape, so left-aligning it leaves a ragged gap down
           the right of the column that reads as misalignment rather than as
           text — the same split the HR lists use. Header and cell are targeted
           together so a centred pill never sits under a left-hung heading. */
        .up-table th:nth-child(1), .up-table td:nth-child(1),
        .up-table th:nth-child(4), .up-table td:nth-child(4),
        .up-table th:nth-child(5), .up-table td:nth-child(5) { text-align: center; }
        .up-table th:nth-child(1) { padding-left: 9px; }
        .up-table tbody tr:nth-child(even) { background: rgba(124,58,237,.035); }
        .up-table tbody tr:hover { background: rgba(124,58,237,.075); }
      `}</style>

      <Card className="shadow-sm up-table-card">
        <CardBody className="p-2 p-md-3">
          {/* The count line that sat on the right of this row is gone: the pager
              below now reports "showing x-y of z", and the branch name it also
              carried is in the header subtitle. Two counts on one screen only
              invite the question of why they disagree. The search box takes the
              width back. */}
          <div className="search-box mb-3">
            <Input
              type="text"
              className="form-control"
              placeholder={branchId ? 'Search employees by name, email or role...' : 'Search by name, email or role...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <i className="ri-search-line search-icon"></i>
          </div>

          <div ref={scrollRef} className="table-responsive up-table-wrap">
            <table className="table align-middle table-nowrap mb-0 up-table">
              <thead>
                <tr>
                  <th className="ps-3" style={{ width: 60 }}>Sr No</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <ShimmerTableRows rows={5} cols={5} />
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-5 text-muted">
                      <i className="ri-user-search-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                      {users.length === 0
                        ? `No ${branchId ? 'employees' : 'users'} found${displayBranchName ? ` for ${displayBranchName}` : ''}`
                        : `No ${branchId ? 'employees' : 'users'} match your search`}
                    </td>
                  </tr>
                ) : pageRows.map((u, idx) => {
                  const isActive = u.status === 'active';
                  return (
                    <tr key={u.id}>
                      <td className="ps-3 text-muted fs-13">{(safePage - 1) * rpp + idx + 1}</td>
                      <td>
                        {/* Name only. The initials circle repeated the first two
                            letters of the word beside it and nothing more — the
                            same reason it was dropped from the HR Employees
                            table. Without it the column starts at a single left
                            edge and long names get the width back. */}
                        <span className="fw-semibold fs-13">{u.name}</span>
                      </td>
                      {/* No envelope icon: the column is already headed EMAIL, so it
                          only pushed every address right by its own width. */}
                      <td className="fs-13">{u.email}</td>
                      <td>
                        <span className="badge bg-primary-subtle text-primary fw-semibold px-3 py-2">
                          {typeLabel(u.user_type)}
                        </span>
                      </td>
                      <td>
                        <span className={`badge rounded-pill bg-${isActive ? 'success' : 'danger'}-subtle text-${isActive ? 'success' : 'danger'} fw-semibold px-3 py-2`}>
                          {isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {!loading && filtered.length > 0 && (
              <WorklistPager
                total={filtered.length}
                page={safePage}
                pageSize={rpp}
                onPage={setPage}
                /* A deliberate pick switches the measurement off — otherwise the
                   next resize would quietly overwrite it. */
                onPageSize={(n) => { autoFitRef.current = false; setRpp(n); setPage(1); }}
              />
            )}
          </div>
        </CardBody>
      </Card>
    </>
  );
}
