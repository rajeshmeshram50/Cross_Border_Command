import { useEffect, useState, useRef } from 'react';
import api from '../../api';

// ─────────────────────────────────────────────────────────────────────────────
// EmployeePicker — search-as-you-type picker for a single employee. Hits
// /api/employees with a debounced search, shows up to 8 suggestions with
// avatar/designation/emp-code, and emits the picked employee back to the
// parent. Reusable across the leave approval chain editor and any future
// "pick a person" UI (reporting manager, cover person, etc.).
//
// Single-select: clicking a suggestion replaces the current selection. To
// clear, click the × on the chip. For multi-select (like the Notify field
// in RequestLeaveModal), wrap multiple instances or copy the suggestion
// list rendering — the multi case has its own UX needs (chips array,
// dedupe etc.) so it's kept separate for now.
// ─────────────────────────────────────────────────────────────────────────────
export interface PickedEmployee {
  id: number;
  user_id?: number | null;
  name: string;
  emp_code: string;
  designation?: string | null;
  photo_url?: string | null;
}

interface Props {
  // The currently picked employee (parent owns the selection). Pass null
  // to render an empty state.
  value: PickedEmployee | null;
  onChange: (next: PickedEmployee | null) => void;
  placeholder?: string;
  // Helper: when the chain editor needs the user_id rather than the
  // employee.id, the parent can read picked.user_id and store that.
}

export default function EmployeePicker({ value, onChange, placeholder = 'Search employee…' }: Props) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [suggestions, setSuggestions] = useState<PickedEmployee[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Debounce 300ms so each keystroke doesn't hit the network.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch suggestions when the debounced query changes.
  useEffect(() => {
    if (!debouncedSearch) { setSuggestions([]); return; }
    let alive = true;
    setLoading(true);
    api.get('/employees', { params: { search: debouncedSearch, per_page: 8 } })
      .then(r => {
        if (!alive) return;
        const raw = r.data?.data ?? r.data ?? [];
        const list: PickedEmployee[] = (Array.isArray(raw) ? raw : []).slice(0, 8).map((e: any) => ({
          id: e.id,
          user_id: e.user_id ?? null,
          name: (e.display_name?.trim() || `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim()) || `Employee #${e.id}`,
          emp_code: e.emp_code || `EMP-${e.id}`,
          designation: e.designation?.name || e.designation_name || null,
          photo_url: e.profile_photo_url || e.photo_url || null,
        }));
        setSuggestions(list);
      })
      .catch(() => { /* silent — dropdown just stays empty */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [debouncedSearch]);

  // Close the dropdown when the user clicks anywhere outside the wrapper.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const pick = (e: PickedEmployee) => {
    onChange(e);
    setSearch('');
    setShowSuggestions(false);
  };

  const initialsOf = (name: string) =>
    name.split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <div ref={wrapRef} className="position-relative" style={{ minWidth: 240 }}>
      {value ? (
        <div className="d-flex align-items-center gap-2 lts-input" style={{ padding: '6px 10px' }}>
          {value.photo_url ? (
            <img src={value.photo_url} alt={value.name} style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            <span className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
              style={{ width: 26, height: 26, fontSize: 10, background: 'linear-gradient(135deg,#0ab39c,#30d5b5)' }}>
              {initialsOf(value.name)}
            </span>
          )}
          <div className="min-w-0 flex-grow-1">
            <div className="fw-semibold text-truncate" style={{ fontSize: 13, lineHeight: 1.2 }}>{value.name}</div>
            <div className="text-muted text-truncate" style={{ fontSize: 10.5 }}>
              {value.emp_code}{value.designation ? ` · ${value.designation}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Clear"
            className="btn p-0"
            style={{ color: '#dc2626', fontSize: 16, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      ) : (
        <input
          type="text"
          className="lts-input"
          placeholder={placeholder}
          value={search}
          onChange={e => { setSearch(e.target.value); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
          style={{ width: '100%' }}
        />
      )}

      {showSuggestions && !value && (suggestions.length > 0 || loading) && (
        <div className="position-absolute w-100 shadow-sm" style={{
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, marginTop: 4,
          zIndex: 1050, maxHeight: 280, overflowY: 'auto',
        }}>
          {loading && suggestions.length === 0 ? (
            <div className="text-muted text-center py-3" style={{ fontSize: 12 }}>
              <i className="ri-loader-4-line ri-spin me-1" /> Searching…
            </div>
          ) : suggestions.map(e => (
            <button
              key={e.id}
              type="button"
              className="d-flex align-items-center gap-2 w-100 text-start"
              onMouseDown={() => pick(e)}
              style={{
                padding: '10px 12px', border: 'none', background: 'transparent',
                borderBottom: '1px solid #f1f3f5', cursor: 'pointer',
              }}
              onMouseEnter={ev => (ev.currentTarget.style.background = '#f8f9fa')}
              onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
            >
              {e.photo_url ? (
                <img src={e.photo_url} alt={e.name} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                <span className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0" style={{
                  width: 32, height: 32, fontSize: 11, background: 'linear-gradient(135deg,#0ab39c,#30d5b5)',
                }}>{initialsOf(e.name)}</span>
              )}
              <div className="min-w-0">
                <div className="fw-semibold" style={{ fontSize: 13 }}>{e.name}</div>
                {e.designation && <div className="text-muted" style={{ fontSize: 11 }}>{e.designation}</div>}
                <div className="text-muted" style={{ fontSize: 11 }}>Employee Number: {e.emp_code}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
