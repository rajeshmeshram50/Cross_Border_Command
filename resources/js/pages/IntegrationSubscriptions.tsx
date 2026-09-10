import { useEffect, useMemo, useState } from 'react';
import { Modal, ModalBody } from 'reactstrap';
import api from '../api';
import { useToast } from '../contexts/ToastContext';

/**
 * Third-party subscription / integration expiry tracker (super-admin).
 *
 * A company-wide register of the paid external services this software depends on
 * (Zoho Sign, Zoho Books, Razorpay, Azure, domains, SSL, API plans) with a
 * renewal date and a responsible owner. The backend's daily
 * subscriptions:send-expiry-reminders command emails that owner as each
 * service's per-row reminder thresholds are reached.
 */

type Sub = {
  id: number;
  name: string;
  provider: string | null;
  category: string | null;
  owner_name: string | null;
  owner_email: string;
  expires_at: string;            // ISO date
  reminder_days: number[];
  auto_renew: boolean;
  status: string;
  amount: string | null;
  currency: string;
  notes: string | null;
  days_left: number;
  computed_status: 'active' | 'expired' | 'cancelled';
};

const CATEGORIES = ['E-signature', 'Accounting', 'Payments', 'Storage', 'Domain', 'SSL Certificate', 'API Plan', 'Email', 'Other'];
const REMINDER_CHOICES = [60, 30, 15, 7, 3, 1];
const EMPTY = {
  name: '', provider: '', category: '', owner_name: '', owner_email: '',
  expires_at: '', reminder_days: [30, 15, 7, 1] as number[], auto_renew: false,
  status: 'active', amount: '', currency: 'INR', notes: '',
};

export default function IntegrationSubscriptions() {
  const toast = useToast();
  const [rows, setRows] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Sub | null>(null);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    api.get('/integration-subscriptions')
      .then(res => setRows(res.data?.data || []))
      .catch(() => toast.error('Could not load', 'Failed to fetch integrations'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openAdd = () => { setEditing(null); setForm(EMPTY); setErrors({}); setModal(true); };
  const openEdit = (s: Sub) => {
    setEditing(s);
    setForm({
      name: s.name, provider: s.provider || '', category: s.category || '',
      owner_name: s.owner_name || '', owner_email: s.owner_email,
      expires_at: s.expires_at?.slice(0, 10) || '', reminder_days: s.reminder_days || [],
      auto_renew: s.auto_renew, status: s.status,
      amount: s.amount != null ? String(s.amount) : '', currency: s.currency || 'INR',
      notes: s.notes || '',
    });
    setErrors({});
    setModal(true);
  };

  const set = (k: keyof typeof EMPTY, v: any) => setForm(f => ({ ...f, [k]: v }));
  const toggleDay = (d: number) => setForm(f => ({
    ...f,
    reminder_days: f.reminder_days.includes(d) ? f.reminder_days.filter(x => x !== d) : [...f.reminder_days, d].sort((a, b) => b - a),
  }));

  const save = async () => {
    setSaving(true); setErrors({});
    const payload = {
      ...form,
      amount: form.amount === '' ? null : Number(form.amount),
      reminder_days: [...form.reminder_days].sort((a, b) => b - a),
    };
    try {
      if (editing) await api.put(`/integration-subscriptions/${editing.id}`, payload);
      else await api.post('/integration-subscriptions', payload);
      toast.success(editing ? 'Updated' : 'Added', `${form.name} saved.`);
      setModal(false);
      load();
    } catch (err: any) {
      if (err?.response?.status === 422) {
        const e = err.response.data?.errors || {};
        setErrors(Object.fromEntries(Object.entries(e).map(([k, v]: any) => [k, v[0]])));
      } else {
        toast.error('Could not save', err?.response?.data?.message || 'Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: Sub) => {
    if (!window.confirm(`Delete "${s.name}"? This stops its renewal reminders.`)) return;
    setBusyId(s.id);
    try {
      await api.delete(`/integration-subscriptions/${s.id}`);
      toast.success('Deleted', `${s.name} removed.`);
      setRows(rs => rs.filter(r => r.id !== s.id));
    } catch (e: any) {
      toast.error('Could not delete', e?.response?.data?.message || 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const sendTest = async (s: Sub) => {
    setBusyId(s.id);
    try {
      const res = await api.post(`/integration-subscriptions/${s.id}/send-test`);
      toast.success('Test sent', res.data?.message || `Reminder sent to ${s.owner_email}`);
    } catch (e: any) {
      toast.error('Could not send', e?.response?.data?.message || 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const summary = useMemo(() => {
    const expired = rows.filter(r => r.computed_status === 'expired').length;
    const soon = rows.filter(r => r.computed_status === 'active' && r.days_left <= 30).length;
    return { total: rows.length, expired, soon };
  }, [rows]);

  const statusBadge = (s: Sub) => {
    const map: Record<string, [string, string]> = {
      expired: ['#fef2f2', '#dc2626'],
      cancelled: ['#f3f4f6', '#6b7280'],
      active: s.days_left <= 30 ? ['#fffbeb', '#b45309'] : ['#ecfdf5', '#059669'],
    };
    const [bg, fg] = map[s.computed_status] || map.active;
    const label = s.computed_status === 'expired' ? 'Expired'
      : s.computed_status === 'cancelled' ? 'Cancelled'
      : s.days_left === 0 ? 'Expires today' : `${s.days_left}d left`;
    return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, background: bg, color: fg, fontSize: 11.5, fontWeight: 700 }}>{label}</span>;
  };

  return (
    <div className="rec-page" style={{ padding: 20 }}>
      {/* Header — pure inline styles so no global .mb-3 / heading rule can hide it. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 20, fontWeight: 800, color: '#111827' }}>
            <i className="ri-calendar-check-line" style={{ color: '#4f46e5' }} />Integration Subscriptions
          </div>
          <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 2 }}>
            Track third-party services (Zoho, Razorpay, Azure, domains, SSL…) and email owners before they expire.
          </div>
        </div>
        <button type="button" onClick={openAdd}
          style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 18px', background: '#4f46e5', color: '#fff', border: 0, borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', boxShadow: '0 1px 2px rgba(79,70,229,0.3)' }}>
          <i className="ri-add-line" />Add Integration
        </button>
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Total tracked', value: summary.total, color: '#4f46e5', icon: 'ri-apps-2-line' },
          { label: 'Expiring ≤ 30 days', value: summary.soon, color: '#b45309', icon: 'ri-time-line' },
          { label: 'Expired', value: summary.expired, color: '#dc2626', icon: 'ri-error-warning-line' },
        ].map(t => (
          <div key={t.label} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 16px', background: '#fff' }}>
            <div style={{ fontSize: 11.5, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              <i className={t.icon} style={{ color: t.color, marginRight: 6 }} />{t.label}
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: t.color, marginTop: 4 }}>{t.value}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb', color: '#6b7280', textAlign: 'left' }}>
                {['Service', 'Owner', 'Renews on', 'Status', 'Reminders (days before)', 'Amount', ''].map(h => (
                  <th key={h} style={{ padding: '11px 14px', fontSize: 11.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: 28, textAlign: 'center', color: '#9ca3af' }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: '32px 20px', textAlign: 'center', color: '#9ca3af' }}>
                  <div style={{ marginBottom: 12 }}>No integrations tracked yet.</div>
                  <button type="button" onClick={openAdd}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 18px', background: '#4f46e5', color: '#fff', border: 0, borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
                    <i className="ri-add-line" />Add Integration
                  </button>
                </td></tr>
              ) : rows.map(s => (
                <tr key={s.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ fontWeight: 700, color: '#111827' }}>{s.name}</div>
                    <div style={{ fontSize: 11.5, color: '#6b7280' }}>{[s.provider, s.category].filter(Boolean).join(' · ') || '—'}</div>
                  </td>
                  <td style={{ padding: '11px 14px' }}>
                    <div>{s.owner_name || '—'}</div>
                    <div style={{ fontSize: 11.5, color: '#6b7280' }}>{s.owner_email}</div>
                  </td>
                  <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>{new Date(s.expires_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td style={{ padding: '11px 14px' }}>{statusBadge(s)}{s.auto_renew && <span title="Auto-renews" style={{ marginLeft: 6, fontSize: 11, color: '#059669' }}><i className="ri-refresh-line" /></span>}</td>
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {(s.reminder_days || []).map(d => (
                        <span key={d} style={{ padding: '2px 8px', background: '#eef2ff', color: '#4338ca', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{d}</span>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>{s.amount != null ? `${s.currency} ${Number(s.amount).toLocaleString()}` : '—'}</td>
                  <td style={{ padding: '11px 14px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button type="button" title="Send a test reminder now" disabled={busyId === s.id} onClick={() => sendTest(s)}
                      style={{ ...iconBtn, color: '#4f46e5' }}><i className="ri-mail-send-line" /></button>
                    <button type="button" title="Edit" onClick={() => openEdit(s)}
                      style={{ ...iconBtn, color: '#374151' }}><i className="ri-pencil-line" /></button>
                    <button type="button" title="Delete" disabled={busyId === s.id} onClick={() => remove(s)}
                      style={{ ...iconBtn, color: '#dc2626' }}><i className="ri-delete-bin-line" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit modal */}
      <Modal isOpen={modal} toggle={() => setModal(false)} centered size="lg" backdrop="static" contentClassName="border-0">
        <ModalBody className="p-0">
          <div style={{ padding: '16px 22px', background: 'linear-gradient(135deg,#4f46e5,#8b5cf6)', color: '#fff' }}>
            <h5 className="fw-bold mb-0" style={{ color: '#fff' }}>{editing ? 'Edit Integration' : 'Add Integration'}</h5>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>Renewal reminders are emailed to the owner automatically.</div>
          </div>
          <div style={{ padding: 22, maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' }}>
            <div className="row g-3">
              <Field col={6} label="Service name" required error={errors.name}>
                <input style={inp(!!errors.name)} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Zoho Sign" />
              </Field>
              <Field col={6} label="Provider" error={errors.provider}>
                <input style={inp(false)} value={form.provider} onChange={e => set('provider', e.target.value)} placeholder="e.g. Zoho" />
              </Field>
              <Field col={6} label="Category" error={errors.category}>
                <select style={inp(false)} value={form.category} onChange={e => set('category', e.target.value)}>
                  <option value="">— select —</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field col={6} label="Renewal / expiry date" required error={errors.expires_at}>
                <input type="date" style={inp(!!errors.expires_at)} value={form.expires_at} onChange={e => set('expires_at', e.target.value)} />
              </Field>
              <Field col={6} label="Owner name" error={errors.owner_name}>
                <input style={inp(false)} value={form.owner_name} onChange={e => set('owner_name', e.target.value)} placeholder="Responsible person" />
              </Field>
              <Field col={6} label="Owner email" required error={errors.owner_email}>
                <input type="email" style={inp(!!errors.owner_email)} value={form.owner_email} onChange={e => set('owner_email', e.target.value)} placeholder="who gets the reminder" />
              </Field>

              <Field col={12} label="Remind (days before renewal)" error={errors.reminder_days}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {REMINDER_CHOICES.map(d => {
                    const on = form.reminder_days.includes(d);
                    return (
                      <button key={d} type="button" onClick={() => toggleDay(d)}
                        style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                          border: '1px solid ' + (on ? '#4f46e5' : '#e5e7eb'), background: on ? '#4f46e5' : '#fff', color: on ? '#fff' : '#374151' }}>
                        {d} day{d === 1 ? '' : 's'}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 6 }}>An email fires as each selected milestone is reached. A row past its date always gets one "expired" notice.</div>
              </Field>

              <Field col={4} label="Amount (optional)" error={errors.amount}>
                <input type="number" min={0} style={inp(false)} value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="e.g. 12000" />
              </Field>
              <Field col={4} label="Currency">
                <input style={inp(false)} maxLength={3} value={form.currency} onChange={e => set('currency', e.target.value.toUpperCase())} />
              </Field>
              <Field col={4} label="Status">
                <select style={inp(false)} value={form.status} onChange={e => set('status', e.target.value)}>
                  <option value="active">Active</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </Field>

              <Field col={12} label="Notes" error={errors.notes}>
                <textarea rows={2} style={{ ...inp(false), resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Renewal instructions, account, invoice reference…" />
              </Field>

              <div className="col-12">
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#374151' }}>
                  <input type="checkbox" checked={form.auto_renew} onChange={e => set('auto_renew', e.target.checked)} />
                  This service auto-renews (reminders still send, as a heads-up)
                </label>
              </div>
            </div>
          </div>
          <div style={{ padding: '14px 22px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 8, background: '#f9fafb' }}>
            <button type="button" onClick={() => setModal(false)} disabled={saving}
              style={{ padding: '9px 18px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button type="button" onClick={save} disabled={saving}
              style={{ padding: '9px 18px', background: '#4f46e5', color: '#fff', border: 0, borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : (editing ? 'Update' : 'Add Integration')}
            </button>
          </div>
        </ModalBody>
      </Modal>
    </div>
  );
}

const iconBtn: React.CSSProperties = { background: 'none', border: 0, cursor: 'pointer', fontSize: 16, padding: '4px 6px' };
function inp(error: boolean): React.CSSProperties {
  return { width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid ' + (error ? '#ef4444' : '#e5e7eb'), fontSize: 13.5, background: '#fff' };
}
function Field({ col, label, required, error, children }: { col: number; label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className={`col-md-${col}`}>
      <label style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6, display: 'block' }}>
        {label}{required && <span style={{ color: '#ef4444' }}> *</span>}
      </label>
      {children}
      {error && <div style={{ fontSize: 11.5, color: '#ef4444', marginTop: 4 }}>{error}</div>}
    </div>
  );
}
