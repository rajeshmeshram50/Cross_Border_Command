import { useState } from 'react';
import { Col, Row, Input, Label, FormFeedback } from 'reactstrap';
import { MasterSelect } from '../../pages/master/masterFormKit';
import { normalizeOpts, type FieldDef } from '../../pages/master/masterConfigs';
import './InlineSublist.css';

/* Lifted out of pages/master/MasterPage.tsx so pages outside the master
   module can render the same repeatable child-record block — the Branch
   form's bank details reuse it verbatim. Behaviour is unchanged; only the
   export and the stylesheet import are new.

   The host must render <MasterFormStyles /> (pages/master/masterFormKit) for
   the prefix-icon input layout the editor panel uses. */

/* ────────────────────────────────────────────────────────────────────
 * Inline sublist — replaces the previous modal-over-modal approach.
 * Renders existing items as cards plus an inline editor panel that
 * expands below the cards when adding/editing. No nested popups, and
 * multiple items can still be added one after another.
 * ──────────────────────────────────────────────────────────────────── */
export default function InlineSublist({
  field,
  value,
  onChange,
  viewOnly,
}: {
  field: FieldDef;
  value: any[];
  onChange: (next: any[]) => void;
  viewOnly: boolean;
}) {
  // editingIdx: null = panel closed; -1 = adding new; 0+ = editing that index.
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  // Draft mirrors the in-progress item while the panel is open.
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!field.subFields) return null;

  const fmtVal = (v: any): string => {
    if (v == null || v === '') return '';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v);
  };
  const lines = (item: any): string => {
    const parts: string[] = [];
    for (const fname of (field.subCardLines || [])) {
      const v = fmtVal(item[fname]);
      if (v !== '') parts.push(v);
    }
    return parts.join(' · ');
  };

  const openAdd = () => {
    setEditingIdx(-1);
    setDraft({});
    setErrors({});
  };
  const openEdit = (idx: number) => {
    setEditingIdx(idx);
    // Clone item; normalise is_primary back to Yes/No string for the select.
    const item = value[idx] || {};
    const init: Record<string, any> = { ...item };
    if (field.subPrimaryFlagField) {
      const flag = item[field.subPrimaryFlagField];
      init[field.subPrimaryFlagField] = (flag === true || flag === 'Yes' || flag === 1) ? 'Yes' : 'No';
    }
    setDraft(init);
    setErrors({});
  };
  const closePanel = () => {
    setEditingIdx(null);
    setDraft({});
    setErrors({});
  };
  const deleteItem = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
    if (editingIdx === idx) closePanel();
  };

  const handleSubmit = () => {
    if (!field.subFields) return;
    const errs: Record<string, string> = {};
    const payload: Record<string, any> = {};

    for (const sf of field.subFields) {
      const raw = draft[sf.n];
      const str = raw == null ? '' : String(raw).trim();
      if (sf.r && !str) errs[sf.n] = `${sf.l} is required`;
      // Format check — only when a value is present (required handled above).
      else if (str && sf.pattern && !new RegExp(sf.pattern).test(str)) {
        errs[sf.n] = sf.patternMessage || `${sf.l} is invalid`;
      }
      if (sf.n === field.subPrimaryFlagField) {
        payload[sf.n] = str === 'Yes' || str === 'true' || str === '1' || raw === true;
      } else if (sf.t === 'number') {
        payload[sf.n] = str === '' ? null : Number(str);
      } else {
        payload[sf.n] = str === '' ? null : str;
      }
    }

    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    // Preserve existing id when editing so backend syncs in place.
    if (editingIdx != null && editingIdx >= 0) {
      const existing = value[editingIdx];
      if (existing?.id) payload.id = existing.id;
      const next = [...value];
      next[editingIdx] = { ...existing, ...payload };
      onChange(next);
    } else {
      onChange([...value, payload]);
    }
    closePanel();
  };

  const updateDraft = (name: string, val: any) => {
    setDraft(prev => ({ ...prev, [name]: val }));
    if (errors[name]) {
      setErrors(prev => {
        const n = { ...prev };
        delete n[name];
        return n;
      });
    }
  };

  return (
    <div className="sublist-wrap">
      {value.map((item, idx) => {
        if (editingIdx === idx) {
          // While being edited inline, the row collapses into a "currently editing" hint;
          // the actual fields render in the editor panel below.
          return (
            <div key={idx} className="sublist-card sublist-card-editing">
              <i className="ri-pencil-line" style={{ color: '#405189', fontSize: 14 }} />
              <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--vz-secondary-color)' }}>
                Editing {field.subSingular?.toLowerCase() || 'item'} #{idx + 1} below…
              </span>
            </div>
          );
        }
        const title = item[field.subCardTitleField || ''] || `Item ${idx + 1}`;
        const subtitle = item[field.subCardSubtitleField || ''] || '';
        const isPrimary = !!(field.subPrimaryFlagField &&
          (item[field.subPrimaryFlagField] === true ||
           item[field.subPrimaryFlagField] === 'Yes' ||
           item[field.subPrimaryFlagField] === 1));
        return (
          <div className="sublist-card" key={idx}>
            <div className="d-flex align-items-start gap-3 flex-grow-1 min-w-0">
              <span className="sublist-card-icon">
                <i className="ri-bank-line" />
              </span>
              <div className="flex-grow-1 min-w-0">
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <span className="sublist-card-title">{title}</span>
                  {isPrimary && (
                    <span className="sublist-card-primary">
                      <i className="ri-star-fill" />PRIMARY
                    </span>
                  )}
                </div>
                {subtitle && <div className="sublist-card-subtitle">{subtitle}</div>}
                {lines(item) && <div className="sublist-card-lines">{lines(item)}</div>}
              </div>
            </div>
            {!viewOnly && (
              <div className="d-flex align-items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  className="sublist-card-action"
                  title={`Edit ${field.subSingular || 'item'}`}
                  onClick={() => openEdit(idx)}
                >
                  <i className="ri-pencil-line" />
                </button>
                <button
                  type="button"
                  className="sublist-card-action danger"
                  title={`Delete ${field.subSingular || 'item'}`}
                  onClick={() => deleteItem(idx)}
                >
                  <i className="ri-delete-bin-line" />
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* Inline editor panel — shown when adding or editing. Lives in the same
          parent modal, no nested popup. */}
      {!viewOnly && editingIdx != null && (
        <div className="sublist-editor">
          <div className="sublist-editor-head">
            <span className="sublist-editor-title">
              <i className={editingIdx === -1 ? 'ri-add-line' : 'ri-pencil-line'} />
              {editingIdx === -1 ? 'Add' : 'Edit'} {field.subSingular || 'Item'}
            </span>
          </div>
          <Row className="g-2">
            {field.subFields.map((sf, sfIdx) => {
              const err = errors[sf.n];
              const val = draft[sf.n] ?? '';
              if (sf.t === 'select') {
                const options = normalizeOpts(sf.opts);
                return (
                  <Col md={6} key={sf.n || `sf-${sfIdx}`}>
                    <Label className="d-flex align-items-center gap-2">
                      <span>{sf.l}{sf.r && <span className="req-star">*</span>}</span>
                    </Label>
                    <div className="master-field sel">
                      <i className="ri-list-check-2 master-field-icon" />
                      <MasterSelect
                        value={String(val)}
                        options={options}
                        placeholder={sf.p || 'Select…'}
                        invalid={!!err}
                        onChange={(v) => updateDraft(sf.n, v)}
                      />
                    </div>
                    {err && <FormFeedback style={{ display: 'block', fontSize: 11.5, marginTop: 4 }}>{err}</FormFeedback>}
                  </Col>
                );
              }
              return (
                <Col md={6} key={sf.n || `sf-${sfIdx}`}>
                  <Label className="d-flex align-items-center gap-2">
                    <span>{sf.l}{sf.r && <span className="req-star">*</span>}</span>
                  </Label>
                  <div className="master-field">
                    <i className="ri-edit-box-line master-field-icon" />
                    <Input
                      type={sf.t === 'number' ? 'number' : 'text'}
                      placeholder={sf.p}
                      value={String(val)}
                      inputMode={sf.t === 'number' ? 'numeric' : undefined}
                      onKeyDown={(e) => {
                        /* Block scientific-notation keys on integer
                         * number sub-fields so "e/E/+/-/." can't slip
                         * into the value and submit as NaN. */
                        if (sf.t === 'number' && ['e', 'E', '+', '-', '.', ','].includes(e.key)) {
                          e.preventDefault();
                        }
                      }}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const v = sf.t === 'number' ? raw.replace(/[^\d]/g, '') : raw;
                        updateDraft(sf.n, v);
                      }}
                      invalid={!!err}
                    />
                  </div>
                  {err && <FormFeedback style={{ display: 'block', fontSize: 11.5, marginTop: 4 }}>{err}</FormFeedback>}
                </Col>
              );
            })}
          </Row>
          <div className="sublist-editor-actions">
            <button type="button" className="sublist-editor-cancel" onClick={closePanel}>
              <i className="ri-close-line" /> Cancel
            </button>
            <button type="button" className="sublist-editor-save" onClick={handleSubmit}>
              <i className="ri-check-line" />
              {editingIdx === -1 ? `Add ${field.subSingular || 'Item'}` : 'Update'}
            </button>
          </div>
        </div>
      )}

      {/* +Add button — hidden while the editor panel is open to avoid the
          accidental "two new items in flight" state. */}
      {!viewOnly && editingIdx == null && (
        <button
          type="button"
          className="sublist-add-btn"
          onClick={openAdd}
        >
          <i className="ri-add-line" />
          Add {field.subSingular || 'Item'}
        </button>
      )}
    </div>
  );
}
