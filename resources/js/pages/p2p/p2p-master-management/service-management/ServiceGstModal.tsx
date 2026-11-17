import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import Tooltip from '../../../../components/ui/Tooltip';
import '../product-management/product-management.css';
import './service-management.css';
import './service-form.css';

/* The same "Map GST (%)" popup the Product master opens from its header,
 * for every service type form. Rates come from the shared GST % master
 * (/master/gst_percentage), so a rate added here is available to products too. */

export interface GstRate { id: string; pct: number; label: string }

type Row = { id: number | string; percentage?: number | string | null; status?: string | null };

const toRate = (r: Row): GstRate | null => {
  const n = parseFloat(String(r.percentage ?? ''));
  if (!Number.isFinite(n)) return null;
  const pct = Number(n.toFixed(2));
  return { id: String(r.id), pct, label: `${pct}%` };
};

let rateCache: GstRate[] | null = null;

const errMsg = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

export default function ServiceGstModal({
  value, onMap, onRemoved, onClose,
}: {
  value?: string;
  onMap: (rate: GstRate) => void;
  onRemoved: (id: string) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [rates, setRates] = useState<GstRate[]>(rateCache ?? []);
  const [loading, setLoading] = useState(!rateCache);
  const [pick, setPick] = useState(value ?? '');
  const [masterOpen, setMasterOpen] = useState(false);
  const [newRate, setNewRate] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api.get<Row[]>('/master/gst_percentage', { params: { fields: 'id,percentage,status' } })
      .then(res => {
        const list = (Array.isArray(res.data) ? res.data : [])
          .filter(r => !r.status || String(r.status).toLowerCase() === 'active')
          .map(toRate)
          .filter((r): r is GstRate => r !== null);
        rateCache = list;
        if (live) setRates(list);
      })
      .catch(() => { if (live) toast.error('Could not load GST rates', 'Please try again.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      if (masterOpen) setMasterOpen(false); else onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [masterOpen, onClose]);

  const sorted = useMemo(() => [...rates].sort((a, b) => a.pct - b.pct), [rates]);
  const options = useMemo(() => sorted.map(r => ({ value: r.id, label: r.label })), [sorted]);

  const sync = (next: GstRate[]) => { rateCache = next; setRates(next); };

  const addRate = async () => {
    const raw = newRate.trim();
    const num = Number(raw);
    if (!raw || isNaN(num) || num < 0 || num > 100) {
      toast.error('Invalid rate', 'Enter a GST % between 0 and 100');
      return;
    }
    if (rates.some(r => r.pct === Number(num.toFixed(2)))) {
      toast.error('Duplicate rate', `${num}% already exists`);
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<Row>('/master/gst_percentage', { percentage: num, status: 'Active' });
      const added = toRate(res.data);
      if (added) {
        sync([...rates, added]);
        setPick(added.id);
      }
      setNewRate('');
      toast.success('Rate added', `${num}% added to the GST master`);
    } catch (e: unknown) {
      toast.error('Failed', errMsg(e, 'Could not add the GST rate.'));
    } finally {
      setBusy(false);
    }
  };

  const removeRate = async (id: string) => {
    setBusy(true);
    try {
      await api.delete(`/master/gst_percentage/${id}`);
      sync(rates.filter(r => r.id !== id));
      if (pick === id) setPick('');
      onRemoved(id);
      toast.success('Rate removed', 'GST rate removed from the master');
    } catch (e: unknown) {
      toast.error('Failed', errMsg(e, 'Could not remove the GST rate.'));
    } finally {
      setBusy(false);
    }
  };

  const mapRate = () => {
    const rate = rates.find(r => r.id === pick);
    if (!rate) return;
    onMap(rate);
    toast.success('GST mapped', `GST ${rate.label} is mapped to this service.`);
    onClose();
  };

  const ico = (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></svg>
  );
  const x = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
  );
  const plus = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
  );

  return (
    <>
      {createPortal((
        <div className="apm-gst-overlay svs-teal svf-gst" onClick={onClose}>
          <div className="apm-gst-modal" role="dialog" aria-modal="true" aria-label="Map GST (%)" onClick={(e) => e.stopPropagation()}>
            <div className="apm-gst-head">
              <div className="apm-gst-head-ico">{ico}</div>
              <div className="apm-gst-head-txt">
                <div className="apm-gst-title">Map GST (%)</div>
                <div className="apm-gst-sub">Select the GST percentage you want to map for this service</div>
              </div>
              <button type="button" className="apm-gst-close" onClick={onClose} aria-label="Close">{x}</button>
            </div>
            <div className="apm-gst-body">
              <div className="apm-gst-label-row">
                <span className="apm-gst-label">How much GST % do you want to map for this service?</span>
                <Tooltip label="Add / manage GST % master">
                  <button type="button" className="apm-gst-plus" onClick={() => setMasterOpen(true)} aria-label="Add / manage GST % master">{plus}</button>
                </Tooltip>
              </div>
              <MasterSelect value={pick} onChange={setPick} options={options} disabled={loading}
                placeholder={loading ? 'Loading GST rates…' : 'Select GST %'} />
              <div className="apm-gst-hint">Need a different rate? Use the <b>+</b> button above to add it to the GST % master.</div>
            </div>
            <div className="apm-gst-foot">
              <button type="button" className="apm-btn-ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="apm-btn-primary" disabled={!pick} onClick={mapRate}>Map GST</button>
            </div>
          </div>
        </div>
      ), document.body)}

      {masterOpen && createPortal((
        <div className="apm-gst-overlay apm-gst-overlay--master svs-teal svf-gst" onClick={() => setMasterOpen(false)}>
          <div className="apm-gst-modal" role="dialog" aria-modal="true" aria-label="GST (%) Master" onClick={(e) => e.stopPropagation()}>
            <div className="apm-gst-head">
              <div className="apm-gst-head-ico">{ico}</div>
              <div className="apm-gst-head-txt">
                <div className="apm-gst-title">GST (%) Master</div>
                <div className="apm-gst-sub">Manage the GST percentage values available across products and services</div>
              </div>
              <button type="button" className="apm-gst-close" onClick={() => setMasterOpen(false)} aria-label="Back to Map GST">{x}</button>
            </div>
            <div className="apm-gst-body">
              <div className="apm-gst-bar">
                <span className="apm-gst-count">{rates.length} rate{rates.length !== 1 ? 's' : ''} configured</span>
                <div className="apm-gst-add-wrap">
                  <input className="apm-input apm-gst-new" type="number" min="0" max="100" step="0.5" placeholder="e.g. 18"
                    value={newRate} onChange={(e) => setNewRate(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void addRate(); }} />
                  <button type="button" className="apm-gst-addbtn" disabled={busy} onClick={() => { void addRate(); }}>
                    {plus} Add Rate
                  </button>
                </div>
              </div>
              {loading ? (
                <div className="apm-gst-empty">Loading GST rates…</div>
              ) : rates.length === 0 ? (
                <div className="apm-gst-empty">No GST rates yet. Add one above.</div>
              ) : (
                <div className="apm-gst-tablewrap">
                  <table className="apm-gst-table">
                    <thead><tr><th>Sr No</th><th>GST Rate</th><th aria-label="Remove" /></tr></thead>
                    <tbody>
                      {sorted.map((r, i) => (
                        <tr key={r.id}>
                          <td><span className="apm-sup-sr">{String(i + 1).padStart(2, '0')}</span></td>
                          <td className="apm-gst-rate">{r.label}</td>
                          <td>
                            <Tooltip label="Remove rate">
                              <button type="button" className="apm-sup-del" disabled={busy} onClick={() => { void removeRate(r.id); }}>×</button>
                            </Tooltip>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="apm-gst-foot">
              <button type="button" className="apm-btn-primary" onClick={() => setMasterOpen(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                Back to Map GST
              </button>
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}
