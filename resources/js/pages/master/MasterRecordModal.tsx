import { useState } from 'react';
import { Modal, ModalBody, ModalFooter, Form, Row, Button, Spinner } from 'reactstrap';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { getMasterConfig, masterEndpoint, type FieldDef } from './masterConfigs';
import { MasterFormStyles } from './masterFormKit';
import { renderField } from './MasterPage';

/**
 * Reusable "Add <master>" modal — renders the EXACT same form the dedicated
 * /master/{slug} page uses (same header, same `renderField` field rendering,
 * same master-modal CSS), so a quick-add from another screen (e.g. the Supplier
 * wizard's "+" buttons) is literally the master's own form, not a re-creation.
 *
 * Scoped to the simple lookup masters surfaced as quick-adds (text / select /
 * textarea / number fields). It does not handle file uploads, sublists, or
 * auto-gen codes — those masters aren't offered as inline quick-adds.
 */

// Identifier-style fields keep their exact casing (mirrors MasterPage.handleSave).
const SKIP_CAPITALIZE = new Set([
  'code', 'iso_code', 'state_code', 'short_code', 'hsn_code',
  'gstin', 'pan', 'tan', 'cin', 'iec', 'ifsc_code', 'swift_code', 'ad_code',
  'email', 'website', 'url', 'domain', 'phone', 'mobile', 'whatsapp',
  'pincode', 'postal_code', 'zip',
]);
const capitalizeFirst = (s: string): string => {
  if (!s) return s;
  const idx = s.search(/[a-zA-Z]/);
  return idx === -1 ? s : s.slice(0, idx) + s[idx].toUpperCase() + s.slice(idx + 1);
};

export function MasterRecordModal({
  slug,
  onClose,
  onSaved,
}: {
  slug: string;
  onClose: () => void;
  onSaved: (row: Record<string, unknown>) => void;
}) {
  const cfg = getMasterConfig(slug);
  const toast = useToast();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [radioValues, setRadioValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  if (!cfg) return null;
  const singular = cfg.titleSingular || cfg.title;
  const clearFieldError = (name: string) =>
    setFieldErrors(prev => { if (!prev[name]) return prev; const n = { ...prev }; delete n[name]; return n; });

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    // Client-side required check (server still validates).
    const errs: Record<string, string> = {};
    for (const f of cfg.fields) {
      if (f.sec || !f.n || f.t === 'sublist' || f.t === 'file' || f.auto) continue;
      if (f.r && String(fd.get(f.n) ?? '').trim() === '') errs[f.n] = `${f.l} is required`;
    }
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      toast.error('Validation Error', `${Object.keys(errs).length} field(s) need attention`);
      return;
    }
    setFieldErrors({});

    const payload: Record<string, unknown> = {};
    for (const f of cfg.fields as FieldDef[]) {
      if (f.sec || !f.n || f.t === 'sublist' || f.t === 'file' || f.auto) continue;
      const raw = fd.get(f.n);
      if (f.t === 'number') {
        payload[f.n] = raw == null || raw === '' ? null : Number(raw);
      } else {
        let s = String(raw ?? '').trim();
        if (s !== '' && (f.t === 'text' || f.t === 'textarea') && !SKIP_CAPITALIZE.has(f.n)) s = capitalizeFirst(s);
        payload[f.n] = s === '' ? null : s;
      }
    }

    setSaving(true);
    try {
      const res = await api.post<{ data?: Record<string, unknown> }>(masterEndpoint(cfg), payload);
      toast.success('Saved', `${singular} added`);
      onSaved(res.data?.data ?? (res.data as Record<string, unknown>));
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } };
      const apiErrs = e2?.response?.data?.errors;
      if (apiErrs) {
        const flat: Record<string, string> = {};
        Object.entries(apiErrs).forEach(([k, v]) => { if (v?.[0]) flat[k] = v[0]; });
        setFieldErrors(flat);
      }
      toast.error('Save failed', e2?.response?.data?.message || `Could not add ${singular}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <MasterFormStyles />
      <Modal
        isOpen
        toggle={() => { /* explicit Cancel only */ }}
        centered
        modalClassName="master-modal"
        backdrop="static"
        keyboard={false}
        zIndex={1200}
      >
        {/* Header — same layered gradient + frosted icon badge as the master page. */}
        <div
          className="position-relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #2b3a85 0%, #405189 28%, #5562c4 55%, #6e7eee 78%, #8b6fe8 100%)', padding: '22px 24px' }}
        >
          <span aria-hidden style={{ position: 'absolute', top: -50, right: -30, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.28) 0%, rgba(167,139,250,0.18) 35%, transparent 70%)', pointerEvents: 'none' }} />
          <span aria-hidden style={{ position: 'absolute', bottom: -50, left: -30, width: 160, height: 160, borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,111,232,0.32) 0%, transparent 70%)', pointerEvents: 'none' }} />
          <div className="d-flex align-items-center gap-3 position-relative">
            <span className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0" style={{ width: 44, height: 44, background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.25)', backdropFilter: 'blur(6px)' }}>
              <i className={cfg.icon} style={{ color: '#fff', fontSize: 20 }} />
            </span>
            <div className="flex-grow-1 min-w-0">
              <h4 className="mb-0 fw-bold" style={{ color: '#fff', fontWeight: 800, letterSpacing: '0.01em' }}>Add {singular}</h4>
              <small style={{ color: 'rgba(255,255,255,0.82)', fontSize: 12 }}>Fill in the details to register a new {singular.toLowerCase()}</small>
            </div>
          </div>
        </div>

        <Form onSubmit={handleSave} noValidate>
          <ModalBody className="px-4 py-3">
            <Row className="g-2">
              {cfg.fields.map((f, i) =>
                renderField(f, i, null, false, {}, () => 'name', fieldErrors, clearFieldError, 12, [], {}, () => {}, {}, radioValues, (name, value) => setRadioValues(prev => ({ ...prev, [name]: value }))),
              )}
            </Row>
          </ModalBody>
          <ModalFooter className="px-4 py-3 d-flex align-items-center justify-content-end gap-2" style={{ borderTop: '1px solid var(--vz-border-color)' }}>
            <button type="button" className="master-modal-cancel" onClick={onClose}>
              <i className="ri-close-line align-middle me-1" />Cancel
            </button>
            <Button type="submit" disabled={saving} className="master-modal-save waves-effect waves-light" style={{ fontSize: 14 }}>
              {saving ? (<><Spinner size="sm" /><span>Saving...</span></>) : (<><i className="ri-save-line" style={{ fontSize: 16 }} />Save {singular}</>)}
            </Button>
          </ModalFooter>
        </Form>
      </Modal>
    </>
  );
}
