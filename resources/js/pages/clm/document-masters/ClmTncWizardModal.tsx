import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import { useSelectionLock } from '../../../hooks/useSelectionLock';
import { MasterSelect } from '../../../components/ui/MasterSelect';
import { MasterMultiSelect } from '../../../components/ui/MasterMultiSelect';
import { SegmentModal, nextSegmentCode, type SegmentForm, type SaveResult } from '../compliance/ClmSegmentPage';
import Tooltip from '../../../components/ui/Tooltip';
import { SimpleNameModal } from '../shared/clmCommon';
import { deriveShortCode } from './ClmTncPage';
import ClmClauseInsertPanel from './ClmClauseInsertPanel';

/* ───────────────────────────────────────────────────────────────────────
 * Central CLM → T&C Master → Library → "Add New T&C" (2-step wizard modal)
 *
 *   Step 1 — T&C Basic Details (segment, T&C document name, applicable party)
 *   Step 2 — T&C Content (rich text editor + clause library hook-up)
 *
 * Same backend contract as the previous TncBlockModal — POST/PUT
 * /clm/tnc-library with { segment, category, party, content }. The
 * applicable-party checkbox grid serialises into the existing `party`
 * CSV. Quick-add for T&C Document Name calls POST /clm/tnc-categories,
 * mirroring the Trade-Doc Draft wizard's quick-add flow.
 * ─────────────────────────────────────────────────────────────────────── */

export type Cat = { id: number; code: string; name: string };
export type Lib = {
  id: number;
  code: string;
  segment: string;
  regulatory?: 'highly' | 'less' | null;
  category: string;
  party: string;
  content: string | null;
};
export type SegOpt = { name: string; regulatory_status: 'highly' | 'less'; code?: string };
type Reg = 'highly' | 'less';

const PARTY_BUYER_CONSIGNEE = [
  { value: 'Buyer',     label: 'Customer',  icon: '👤' },
  { value: 'Consignee', label: 'Consignee', icon: '🚚' },
];
const PARTY_SUPPLIER = [
  { value: 'Supplier-Material', label: 'Material', icon: '📦' },
];

const STEPS = [
  { key: 1, label: 'T&C Basic Details', sub: 'Segment, category & party' },
  { key: 2, label: 'T&C Content',       sub: 'Rich text editor & clauses' },
];

interface Props {
  open: boolean;
  existing: Lib | null;
  cats: Cat[];
  /** All segments with their regulatory tier — drives the tier-filtered picker. */
  segments: SegOpt[];
  nextCode: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function ClmTncWizardModal({ open, existing, cats: initialCats, segments, nextCode, onClose, onSaved }: Props) {
  const toast = useToast();
  useSelectionLock(open);   // block selecting/copying the background while open
  const editingId = existing?.id ?? null;

  const [step, setStep] = useState<1 | 2>(1);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [cats, setCats] = useState<Cat[]>(initialCats);

  // Regulatory tier drives the segment picker: 'highly' → ONE segment
  // (single-select), 'less' → MANY segments (multi-select).
  const [regulatory, setRegulatory] = useState<Reg>('highly');
  const [segment, setSegment]       = useState('');            // highly: single value
  const [segmentsMulti, setSegmentsMulti] = useState<Set<string>>(new Set()); // less: many
  // Segments quick-added in this modal (not yet in clm_segments), tagged
  // with the tier they were added under so they show in the right picker.
  const [localSegs, setLocalSegs] = useState<{ name: string; tier: Reg }[]>([]);
  const [category, setCategory] = useState('');
  const [parties, setParties]   = useState<Set<string>>(new Set());

  const [content, setContent] = useState('');
  const [clauseOpen, setClauseOpen] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [drawSigOpen, setDrawSigOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: '<p></p>',
    onUpdate({ editor }) {
      setContent(editor.getHTML());
      if (editor.getText().trim()) setErrors(p => (p.content ? { ...p, content: '' } : p));
    },
  });

  const [quickAddCatOpen,     setQuickAddCatOpen]     = useState(false);
  const [quickAddSegmentOpen, setQuickAddSegmentOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setErrors({});
    setSaving(false);
    setLocalSegs([]);
    if (existing) {
      const reg: Reg = existing.regulatory === 'less' ? 'less' : 'highly';
      const segList = (existing.segment ?? '').split(',').map(s => s.trim()).filter(Boolean);
      setRegulatory(reg);
      setSegment(reg === 'highly' ? (segList[0] ?? '') : '');
      setSegmentsMulti(reg === 'less' ? new Set(segList) : new Set());
      setCategory(existing.category ?? '');
      setParties(new Set((existing.party ?? '').split(',').map(s => s.trim()).filter(Boolean)));
      setContent(existing.content ?? '');
    } else {
      setRegulatory('highly');
      setSegment('');
      setSegmentsMulti(new Set());
      setCategory('');
      setParties(new Set());
      setContent('');
    }
    // Hydrate Tiptap with the row's content (or empty paragraph). Suppress
    // emitUpdate so onUpdate doesn't echo this hydration back through setContent.
    if (editor) {
      editor.commands.setContent(existing?.content || '<p></p>', { emitUpdate: false });
    }
  }, [open, existing, editor]);

  useEffect(() => { setCats(initialCats); }, [initialCats]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, onClose]);

  const headerCode = useMemo(() => {
    if (editingId && existing?.code) return existing.code;
    return nextCode;
  }, [editingId, existing, nextCode]);

  // Segment names available for the CURRENT tier: the matching
  // clm_segments rows + any quick-added-in-this-modal names tagged to the
  // tier + the currently-selected value(s) so an edited row always shows.
  const tierSegmentNames = useMemo(() => {
    const set = new Set<string>();
    segments.forEach(s => { if (s.regulatory_status === regulatory) set.add(s.name); });
    localSegs.forEach(s => { if (s.tier === regulatory) set.add(s.name); });
    if (regulatory === 'highly') { if (segment) set.add(segment); }
    else segmentsMulti.forEach(s => set.add(s));
    return Array.from(set).filter(Boolean);
  }, [segments, localSegs, regulatory, segment, segmentsMulti]);

  // Options for the single-select (highly tier).
  const segmentOptions = useMemo(
    () => tierSegmentNames.map(s => ({ value: s, label: s })),
    [tierSegmentNames],
  );

  // Switch tier → clear the other tier's selection so we never persist a
  // segment that doesn't belong to the chosen regulatory tier.
  const changeRegulatory = (next: Reg) => {
    setRegulatory(next);
    setSegment('');
    setSegmentsMulti(new Set());
    setErrors(p => ({ ...p, segment: '' }));
  };


  const toggleParty = (v: string) => {
    setParties(prev => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
    setErrors(p => ({ ...p, party: '' }));
  };

  const toggleAllParties = () => {
    const all = [...PARTY_BUYER_CONSIGNEE, ...PARTY_SUPPLIER].map(p => p.value);
    const allSelected = all.every(v => parties.has(v));
    setParties(allSelected ? new Set() : new Set(all));
    setErrors(p => ({ ...p, party: '' }));
  };

  const allPartiesSelected = useMemo(() => {
    const all = [...PARTY_BUYER_CONSIGNEE, ...PARTY_SUPPLIER].map(p => p.value);
    return all.every(v => parties.has(v));
  }, [parties]);

  const validateStep1 = () => {
    const next: Record<string, string> = {};
    if (regulatory === 'highly') {
      if (!segment.trim()) next.segment = 'Select a segment';
    } else {
      if (segmentsMulti.size === 0) next.segment = 'Select at least one segment';
    }
    if (!category.trim()) next.category = 'T&C document name is required';
    if (parties.size === 0) next.party  = 'Select at least one applicable party';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const goNext = () => { if (validateStep1()) setStep(2); };
  const goBack = () => setStep(1);

  const handleSave = async () => {
    if (!validateStep1()) {
      setStep(1);
      return;
    }
    // T&C content is mandatory — an empty editor still serialises to
    // "<p></p>", so check the plain text (not the HTML) before saving.
    const plainContent = (editor?.getText() ?? content.replace(/<[^>]*>/g, ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!plainContent) {
      setErrors(p => ({ ...p, content: 'T&C content is required' }));
      toast.error('Content required', 'Enter the T&C content before saving.');
      return;
    }
    setSaving(true);
    // highly → one segment; less → CSV of the chosen segments.
    const segmentCsv = regulatory === 'highly'
      ? segment.trim()
      : Array.from(segmentsMulti).join(',');
    const payload: Omit<Lib, 'id' | 'code'> = {
      segment: segmentCsv,
      regulatory,
      category: category.trim(),
      party: Array.from(parties).join(','),
      content: content?.trim() ? content : null,
    };
    try {
      if (editingId) {
        await api.put(`/clm/tnc-library/${editingId}`, payload);
        toast.success('Updated', payload.category);
      } else {
        await api.post('/clm/tnc-library', payload);
        toast.success('Added', payload.category);
      }
      onSaved();
    } catch (e: any) {
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const onAddNewCategory = async (newName: string) => {
    try {
      const r = await api.post<{ status: boolean; data: Cat }>(
        '/clm/tnc-categories',
        { name: newName, short_code: deriveShortCode(newName) },
      );
      const created = r.data.data;
      setCats(prev => [...prev, created]);
      setCategory(created.name);
      setQuickAddCatOpen(false);
      toast.success('Added', created.name);
    } catch (e: any) {
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not save');
    }
  };

  // "+" beside the segment opens the REAL Add-Segment form (same modal as
  // the Segment master) and persists via POST /clm/segments. The created
  // segment carries its own regulatory tier; we file it into the matching
  // picker and auto-select it when that tier matches the T&C's tier.
  const onCreateSegment = async (form: SegmentForm): Promise<SaveResult> => {
    try {
      const r = await api.post<{ status: boolean; data: { name: string; regulatory_status: Reg } }>('/clm/segments', form);
      const created = r.data.data;
      const tier: Reg = created.regulatory_status === 'less' ? 'less' : 'highly';
      setLocalSegs(prev => prev.some(s => s.name === created.name && s.tier === tier) ? prev : [...prev, { name: created.name, tier }]);
      if (tier === regulatory) {
        if (regulatory === 'highly') setSegment(created.name);
        else setSegmentsMulti(prev => new Set(prev).add(created.name));
        setErrors(p => ({ ...p, segment: '' }));
        toast.success('Segment added', `"${created.name}" added & selected`);
      } else {
        toast.info('Segment added', `"${created.name}" is ${tier === 'highly' ? 'highly' : 'less'}-regulated — switch Regulatory Type to use it`);
      }
      setQuickAddSegmentOpen(false);
      return { ok: true };
    } catch (e: any) {
      const status = e?.response?.status as number | undefined;
      const err = e?.response?.data?.errors as Record<string, string[]> | undefined;
      const first = err ? Object.values(err)[0]?.[0] : undefined;
      const message = first ?? e?.response?.data?.message ?? 'Could not save';
      toast.error('Save failed', message);
      if (status === 409 && /already exists/i.test(message)) return { ok: false, fieldErrors: { name: message } };
      if (err?.name?.[0]) return { ok: false, fieldErrors: { name: err.name[0] } };
      return { ok: false };
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="tnw-overlay"
      role="dialog"
      aria-modal="true"
    >
      <style>{TNW_CSS}</style>
      <div className="tnw-shell">
        {/* ── Header ── */}
        <div className="tnw-head">
          <div className="tnw-head-left">
            <div className="tnw-head-ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </div>
            <div className="tnw-head-text">
              <div className="tnw-head-eyebrow">T&amp;C LIBRARY</div>
              <div className="tnw-head-title">{editingId ? 'Edit T&C' : 'Add New T&C'}</div>
              <div className="tnw-head-sub">Create reusable Terms &amp; Conditions content.</div>
            </div>
          </div>
          <div className="tnw-head-right">
            <div className="tnw-id-chip">
              <div className="tnw-id-chip-label">T&amp;C ID</div>
              <div className="tnw-id-chip-val">{headerCode}</div>
            </div>
            <button type="button" className="tnw-close" onClick={onClose} aria-label="Close" disabled={saving}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Stepper ── */}
        <div className="tnw-stepper">
          <div className="tnw-stepper-row">
            {STEPS.map((s, idx) => {
              const active   = s.key === step;
              const complete = s.key < step;
              return (
                <div key={s.key} className={`tnw-step ${active ? 'is-active' : ''} ${complete ? 'is-complete' : ''}`}>
                  <div className="tnw-step-num">
                    {complete
                      ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                      : <span>{s.key}</span>}
                  </div>
                  <div className="tnw-step-text">
                    <div className="tnw-step-label">{s.label}</div>
                    <div className="tnw-step-sub">{s.sub}</div>
                  </div>
                  {idx < STEPS.length - 1 && <div className={`tnw-step-line ${complete ? 'is-complete' : ''}`} />}
                </div>
              );
            })}
          </div>
          <div className="tnw-stepper-progress">
            <div className="tnw-stepper-bars">
              <span className={`tnw-stepper-bar ${step >= 1 ? 'on' : ''}`} />
              <span className={`tnw-stepper-bar ${step >= 2 ? 'on' : ''}`} />
            </div>
            <div className="tnw-stepper-label">Step {step} of {STEPS.length}</div>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="tnw-body">
          {step === 1 ? (
            <div className="tnw-step-body">
              {/* Regulatory tier — drives whether the segment picker is
                  single (highly) or multi (less). */}
              <div className="tnw-field">
                <label className="tnw-label">Regulatory Type <span className="tnw-req">*</span></label>
                <div className="tnw-reg-grid">
                  <button
                    type="button"
                    className={`tnw-reg-card tnw-reg-high ${regulatory === 'highly' ? 'is-on' : ''}`}
                    onClick={() => changeRegulatory('highly')}
                  >
                    <span className="tnw-reg-radio" />
                    <span className="tnw-reg-text">
                      <span className="tnw-reg-title">High Regulatory</span>
                      <span className="tnw-reg-sub">Requires specific segment &amp; compliance review</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`tnw-reg-card tnw-reg-less ${regulatory === 'less' ? 'is-on' : ''}`}
                    onClick={() => changeRegulatory('less')}
                  >
                    <span className="tnw-reg-radio" />
                    <span className="tnw-reg-text">
                      <span className="tnw-reg-title">Less Regulatory</span>
                      <span className="tnw-reg-sub">Applicable to all standard segments by default</span>
                    </span>
                  </button>
                </div>
              </div>

              <div className="tnw-grid-2">
                <div className="tnw-field">
                  <label className="tnw-label">
                    Segment <span className="tnw-req">*</span>
                    <span className="tnw-label-tag">{regulatory === 'highly' ? 'pick one' : 'pick one or more'}</span>
                  </label>
                  {regulatory === 'highly' ? (
                    <>
                      <div className="tnw-inline-add">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <MasterSelect
                            key={`tnw-seg-${segmentOptions.length}`}
                            value={segment}
                            invalid={!!errors.segment}
                            placeholder="— Select Segment —"
                            options={segmentOptions}
                            onChange={(v) => { setSegment(v); setErrors(p => ({ ...p, segment: '' })); }}
                          />
                        </div>
                        <button
                          type="button"
                          className="tnw-add-mini"
                          title="Add new segment"
                          onClick={() => setQuickAddSegmentOpen(true)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                        </button>
                      </div>
                      <div className="tnw-hint">One segment for highly-regulated T&amp;Cs</div>
                    </>
                  ) : (
                    <>
                      <div className="tnw-inline-add">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <MasterMultiSelect
                            values={Array.from(segmentsMulti)}
                            invalid={!!errors.segment}
                            placeholder="— Select Segments —"
                            options={segmentOptions}
                            onChange={(next) => { setSegmentsMulti(new Set(next)); setErrors(p => ({ ...p, segment: '' })); }}
                          />
                        </div>
                        <button
                          type="button"
                          className="tnw-add-mini"
                          title="Add new segment"
                          onClick={() => setQuickAddSegmentOpen(true)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                        </button>
                      </div>
                      <div className="tnw-hint">Pick one or more segments this T&amp;C applies to</div>
                    </>
                  )}
                  {errors.segment && <div className="tnw-err">{errors.segment}</div>}
                </div>

                <div className="tnw-field">
                  <label className="tnw-label">T&amp;C Document Name <span className="tnw-req">*</span></label>
                  {/* Document categories are read-only (managed for the
                      Quotation/PI documents) — no inline "+" quick-add here. */}
                  <MasterSelect
                    key={`tnw-cat-${cats.length}`}
                    value={category}
                    invalid={!!errors.category}
                    placeholder="— Select Category —"
                    options={[
                      ...cats.map(c => ({ value: c.name, label: c.name })),
                      ...(category && !cats.find(c => c.name === category) ? [{ value: category, label: category }] : []),
                    ]}
                    onChange={(v) => { setCategory(v); setErrors(p => ({ ...p, category: '' })); }}
                  />
                  <div className="tnw-hint">One T&amp;C per document · title auto-derived from name</div>
                  {errors.category && <div className="tnw-err">{errors.category}</div>}
                </div>
              </div>

              <div className="tnw-party">
                <div className="tnw-party-top">
                  <div className="tnw-party-head">
                    <span className="tnw-party-ico">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                    </span>
                    Applies To <span className="tnw-req">*</span>
                  </div>
                  <label className={`tnw-checkbox tnw-checkbox-all ${allPartiesSelected ? 'is-on' : ''}`}>
                    <input type="checkbox" checked={allPartiesSelected} onChange={toggleAllParties} />
                    <span className="tnw-checkbox-label">ALL</span>
                  </label>
                </div>
                <div className="tnw-party-row">
                  <div className="tnw-party-label">CUSTOMER &amp; CONSIGNEE</div>
                  <div className="tnw-party-options">
                    {PARTY_BUYER_CONSIGNEE.map(p => (
                      <label key={p.value} className={`tnw-checkbox ${parties.has(p.value) ? 'is-on' : ''}`}>
                        <input type="checkbox" checked={parties.has(p.value)} onChange={() => toggleParty(p.value)} />
                        <span className="tnw-checkbox-emoji">{p.icon}</span>
                        <span className="tnw-checkbox-label">{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="tnw-party-row">
                  <div className="tnw-party-label">SUPPLIER</div>
                  <div className="tnw-party-options">
                    {PARTY_SUPPLIER.map(p => (
                      <label key={p.value} className={`tnw-checkbox ${parties.has(p.value) ? 'is-on' : ''}`}>
                        <input type="checkbox" checked={parties.has(p.value)} onChange={() => toggleParty(p.value)} />
                        <span className="tnw-checkbox-emoji">{p.icon}</span>
                        <span className="tnw-checkbox-label">{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="tnw-party-hint">Tick "ALL" to apply to every party · or pick specific ones</div>
                {errors.party && <div className="tnw-err">{errors.party}</div>}
              </div>
            </div>
          ) : (
            <div className="tnw-step-body">
              <TncEditor
                editor={editor}
                onUploadWord={() => fileInputRef.current?.click()}
                onOpenClauseLibrary={() => { setClauseOpen(o => !o); setSignatureOpen(false); }}
                clauseOpen={clauseOpen}
                onInsertPlaceholder={() => editor?.chain().focus().insertContent('{{PLACEHOLDER}}').run()}
                onCloseClauseLibrary={() => setClauseOpen(false)}
                onOpenSignature={() => { setSignatureOpen(o => !o); setClauseOpen(false); }}
                signatureOpen={signatureOpen}
                onCloseSignature={() => setSignatureOpen(false)}
                onOpenDrawSignature={() => { setDrawSigOpen(true); setSignatureOpen(false); setClauseOpen(false); }}
              />
              {errors.content && <div className="tnw-err" style={{ marginTop: 8 }}>{errors.content}</div>}
              {drawSigOpen && (
                <SignaturePad
                  onClose={() => setDrawSigOpen(false)}
                  onInsert={(dataUrl, signerName) => {
                    const safeName = (signerName ?? '').trim();
                    const html =
                      '<p>&nbsp;</p>' +
                      `<p><img src="${dataUrl}" alt="Signature" style="max-height:90px;display:block"/></p>` +
                      (safeName
                        ? `<p style="margin:0;font-size:12.5px"><strong>${safeName.replace(/[<>&]/g, '')}</strong></p>`
                        : '') +
                      `<p style="margin:0;font-size:12px;color:#475569">Signed on ${new Date().toLocaleDateString()}</p>`;
                    editor?.chain().focus().insertContent(html).run();
                    setDrawSigOpen(false);
                  }}
                />
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".doc,.docx,.txt,.html"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file || !editor) return;
                  e.target.value = '';
                  const lower = file.name.toLowerCase();
                  // Word documents are ZIP-packed XML — reading them as text
                  // yields binary garbage. Convert server-side (PhpWord) via
                  // the shared /clm/docx-to-html endpoint, then insert the
                  // returned HTML. Plain .txt / .html stay client-side.
                  if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
                    const fd = new FormData();
                    fd.append('docx', file);
                    api.post<{ status: boolean; html: string }>('/clm/docx-to-html', fd, {
                      headers: { 'Content-Type': 'multipart/form-data' },
                    })
                      .then(({ data }) => {
                        const html = (data?.html ?? '').trim();
                        if (!html) { toast.warning('Nothing to import', 'The document appears to be empty.'); return; }
                        editor.chain().focus().insertContent(html).run();
                        toast.success('Imported', `${file.name} loaded into the editor.`);
                      })
                      .catch((err: any) => toast.error('Import failed', err?.response?.data?.message ?? 'Could not read this Word document.'));
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    const txt = String(reader.result ?? '');
                    if (lower.endsWith('.html')) {
                      editor.chain().focus().insertContent(txt).run();
                    } else {
                      const html = txt.split(/\r?\n/).map(line => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`).join('');
                      editor.chain().focus().insertContent(html).run();
                    }
                    toast.success('Imported', `${file.name} loaded into the editor.`);
                  };
                  reader.onerror = () => toast.error('Read failed', 'Could not read the selected file.');
                  reader.readAsText(file);
                }}
              />
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="tnw-foot">
          <div className="tnw-foot-left">
            {step === 2 && (
              <button type="button" className="tnw-btn tnw-btn-back" onClick={goBack} disabled={saving}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                Back to Basic Details
              </button>
            )}
          </div>
          <div className="tnw-foot-right">
            <button type="button" className="tnw-btn tnw-btn-cancel" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            {step === 1 ? (
              <button type="button" className="tnw-btn tnw-btn-primary" onClick={goNext} disabled={saving}>
                Save &amp; Next
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            ) : (
              <button type="button" className="tnw-btn tnw-btn-primary" onClick={() => void handleSave()} disabled={saving}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                {saving ? 'Saving…' : 'Save T&C'}
              </button>
            )}
          </div>
        </div>

        {quickAddCatOpen && (
          <SimpleNameModal
            title="Add New Document Category"
            placeholder="e.g. International – Proforma Invoice"
            code={`DC-${String(cats.length + 1).padStart(3, '0')}`}
            isEdit={false}
            initial=""
            onClose={() => setQuickAddCatOpen(false)}
            onSave={(newName) => onAddNewCategory(newName)}
          />
        )}
        {quickAddSegmentOpen && (
          <SegmentModal
            existing={null}
            nextCode={nextSegmentCode(segments.map(s => ({ code: s.code ?? '' })))}
            existingNames={[...segments.map(s => s.name), ...localSegs.map(s => s.name)]}
            onClose={() => setQuickAddSegmentOpen(false)}
            onSave={onCreateSegment}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ── Rich-text editor sub-component ───────────────────────────────────────
 * Tiptap-backed (same library the HR Document Templates editor uses).
 * Every toolbar button drives editor.chain().focus().<command>().run() so
 * formatting is actually applied to the document rather than the buttons
 * being decorative. The Clause Library popover is a placeholder/stub —
 * wires can be added later to load real clauses from /clm/tnc-library.
 * ─────────────────────────────────────────────────────────────────────── */

function TncEditor({
  editor,
  onUploadWord,
  onOpenClauseLibrary,
  onCloseClauseLibrary,
  clauseOpen,
  onInsertPlaceholder,
  onOpenSignature,
  onCloseSignature,
  signatureOpen,
  onOpenDrawSignature,
}: {
  editor: Editor | null;
  onUploadWord: () => void;
  onOpenClauseLibrary: () => void;
  onCloseClauseLibrary: () => void;
  clauseOpen: boolean;
  onInsertPlaceholder: () => void;
  onOpenSignature: () => void;
  onCloseSignature: () => void;
  signatureOpen: boolean;
  onOpenDrawSignature: () => void;
}) {
  if (!editor) return <div className="tnw-editor-shell" style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>Loading editor…</div>;

  const isActive = (name: string, attrs?: Record<string, any>) => {
    try { return editor.isActive(name, attrs); } catch { return false; }
  };

  const onLink = () => {
    const url = window.prompt('Enter URL', 'https://');
    if (!url) return;
    // StarterKit doesn't ship the link extension, so just insert it as text
    editor.chain().focus().insertContent(` ${url} `).run();
  };

  return (
    <div className="tnw-editor-shell">
      <div className="tnw-editor-head">
        <div className="tnw-editor-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
          T&amp;C CONTENT
        </div>
        <div className="tnw-editor-actions">
          <Tooltip label="Upload a Word document and import its content">
            <button type="button" className="tnw-editor-btn" onClick={onUploadWord}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              Upload Word
            </button>
          </Tooltip>
          <Tooltip label="Browse reusable clauses">
            <button type="button" className="tnw-editor-btn" onClick={onOpenClauseLibrary}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
              Clause Library
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="tnw-toolbar">
        {/* Paragraph / heading dropdown */}
        <select
          className="tnw-toolbar-sel"
          title="Block type"
          value={
            isActive('heading', { level: 1 }) ? 'h1' :
            isActive('heading', { level: 2 }) ? 'h2' :
            isActive('heading', { level: 3 }) ? 'h3' : 'p'
          }
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'p') editor.chain().focus().setParagraph().run();
            else editor.chain().focus().toggleHeading({ level: Number(v.slice(1)) as 1|2|3 }).run();
          }}
        >
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>

        <Tooltip label="Bold (Ctrl+B)">
          <button type="button" className={`tnw-toolbar-btn ${isActive('bold') ? 'is-on' : ''}`} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
        </Tooltip>
        <Tooltip label="Italic (Ctrl+I)">
          <button type="button" className={`tnw-toolbar-btn ${isActive('italic') ? 'is-on' : ''}`} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
        </Tooltip>
        <Tooltip label="Underline (Ctrl+U)">
          <button type="button" className={`tnw-toolbar-btn ${isActive('underline') ? 'is-on' : ''}`} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></button>
        </Tooltip>
        <Tooltip label="Strikethrough">
          <button type="button" className={`tnw-toolbar-btn ${isActive('strike') ? 'is-on' : ''}`} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></button>
        </Tooltip>
        <Tooltip label="Inline code">
          <button type="button" className={`tnw-toolbar-btn ${isActive('code') ? 'is-on' : ''}`} onClick={() => editor.chain().focus().toggleCode().run()}>{'<>'}</button>
        </Tooltip>
        <Tooltip label="Blockquote">
          <button type="button" className={`tnw-toolbar-btn ${isActive('blockquote') ? 'is-on' : ''}`} onClick={() => editor.chain().focus().toggleBlockquote().run()}>“”</button>
        </Tooltip>

        <span className="tnw-toolbar-sep" />

        <Tooltip label="Align left">
          <button type="button" className={`tnw-toolbar-btn ${isActive({ textAlign: 'left' } as any) ? 'is-on' : ''}`} onClick={() => editor.chain().focus().setTextAlign('left').run()} aria-label="Align left">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
          </button>
        </Tooltip>
        <Tooltip label="Align center">
          <button type="button" className="tnw-toolbar-btn" onClick={() => editor.chain().focus().setTextAlign('center').run()} aria-label="Align center">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
          </button>
        </Tooltip>
        <Tooltip label="Align right">
          <button type="button" className="tnw-toolbar-btn" onClick={() => editor.chain().focus().setTextAlign('right').run()} aria-label="Align right">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>
          </button>
        </Tooltip>
        <Tooltip label="Justify">
          <button type="button" className="tnw-toolbar-btn" onClick={() => editor.chain().focus().setTextAlign('justify').run()} aria-label="Justify">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
        </Tooltip>

        <span className="tnw-toolbar-sep" />

        <Tooltip label="Bullet list">
          <button type="button" className={`tnw-toolbar-btn ${isActive('bulletList') ? 'is-on' : ''}`} onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label="Bullet list">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>
          </button>
        </Tooltip>
        <Tooltip label="Numbered list">
          <button type="button" className={`tnw-toolbar-btn ${isActive('orderedList') ? 'is-on' : ''}`} onClick={() => editor.chain().focus().toggleOrderedList().run()} aria-label="Numbered list">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>
          </button>
        </Tooltip>
        <Tooltip label="Decrease indent / lift">
          <button type="button" className="tnw-toolbar-btn" onClick={() => editor.chain().focus().liftListItem('listItem').run()} aria-label="Outdent">⇤</button>
        </Tooltip>
        <Tooltip label="Increase indent / sink">
          <button type="button" className="tnw-toolbar-btn" onClick={() => editor.chain().focus().sinkListItem('listItem').run()} aria-label="Indent">⇥</button>
        </Tooltip>

        <span className="tnw-toolbar-sep" />

        <Tooltip label="Insert link">
          <button type="button" className="tnw-toolbar-btn" onClick={onLink} aria-label="Insert link">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </button>
        </Tooltip>
        <Tooltip label="Horizontal rule">
          <button type="button" className="tnw-toolbar-btn" onClick={() => editor.chain().focus().setHorizontalRule().run()} aria-label="Horizontal rule">—</button>
        </Tooltip>
        <Tooltip label="Undo (Ctrl+Z)">
          <button type="button" className="tnw-toolbar-btn" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} aria-label="Undo">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6"/><path d="M3.51 13a9 9 0 1 0 2.13-9.36L3 6"/></svg>
          </button>
        </Tooltip>
        <Tooltip label="Redo (Ctrl+Y)">
          <button type="button" className="tnw-toolbar-btn" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} aria-label="Redo">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 7v6h-6"/><path d="M20.49 13a9 9 0 1 1-2.13-9.36L21 6"/></svg>
          </button>
        </Tooltip>
        <Tooltip label="Clear formatting">
          <button type="button" className="tnw-toolbar-btn" onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()} aria-label="Clear formatting">⌫</button>
        </Tooltip>
      </div>

      <div className="tnw-editor-area">
        <EditorContent editor={editor} className="tnw-editor" />
        {clauseOpen && (
          <ClmClauseInsertPanel
            onClose={onCloseClauseLibrary}
            onInsert={(html) => { editor.chain().focus().insertContent(html).run(); onCloseClauseLibrary(); }}
          />
        )}
        {signatureOpen && (
          <div className="tnw-clause-panel">
            <div className="tnw-clause-panel-head">
              <span>Insert a signature block</span>
              <button type="button" className="tnw-clause-close" onClick={onCloseSignature} aria-label="Close signature panel">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="tnw-clause-panel-body">
              <button type="button" className="tnw-sig-draw-cta" onClick={onOpenDrawSignature}>
                <span className="tnw-sig-draw-ico" aria-hidden>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 800 }}>Draw Signature</span>
                  <span style={{ fontSize: 11, opacity: .85 }}>Sign with your mouse or touch — inserts as image</span>
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', flexShrink: 0 }}><polyline points="9 18 15 12 9 6"/></svg>
              </button>
              <div className="tnw-sig-divider"><span>or pick a template</span></div>
              {SIGNATURE_PRESETS.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  className="tnw-clause-item tnw-sig-item"
                  onClick={() => { editor.chain().focus().insertContent(s.html).run(); onCloseSignature(); }}
                >
                  <span className="tnw-clause-item-title">
                    <span className="tnw-sig-ico" aria-hidden>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17c2-2 4-3 6-3s3 1 5 2 4 1 7-2"/><path d="M14 6l4 4"/><path d="M3 21h18"/></svg>
                    </span>
                    {s.title}
                  </span>
                  <span className="tnw-clause-item-sub">{s.sub}</span>
                  <span className="tnw-sig-preview" aria-hidden dangerouslySetInnerHTML={{ __html: s.preview }} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="tnw-editor-foot">
        <span className="tnw-editor-foot-hint">ℹ T&amp;C Content — write the actual rules / terms text using the rich editor above</span>
      </div>
    </div>
  );
}

/* ── Signature Pad ────────────────────────────────────────────────────────
 * Canvas-based draw-your-signature dialog (like Zoho / DocuSign). Captures
 * pointer events (mouse + touch + pen), smooths strokes with quadratic
 * beziers, supports Clear / Undo, then emits a base64 PNG that the parent
 * inserts as an <img> at the cursor.
 * ─────────────────────────────────────────────────────────────────────── */

function SignaturePad({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (dataUrl: string, signerName: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef    = useRef<CanvasRenderingContext2D | null>(null);
  const strokesRef = useRef<Array<Array<{ x: number; y: number }>>>([]);
  const currentRef = useRef<Array<{ x: number; y: number }> | null>(null);
  const [color, setColor]   = useState('#0c4a6e');
  const [width, setWidth]   = useState(2.5);
  const [hasInk, setHasInk] = useState(false);
  const [signerName, setSignerName] = useState('');

  // Render at device-pixel-ratio so the line stays crisp on retina screens.
  const sizeCanvas = () => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const rect = cvs.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    cvs.width  = Math.max(1, Math.round(rect.width  * dpr));
    cvs.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx  = cvs.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';
    ctxRef.current = ctx;
    redraw();
  };

  useEffect(() => {
    sizeCanvas();
    const onResize = () => sizeCanvas();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc closes; consumes the keystroke so the wizard's Escape handler doesn't
  // also fire and close the whole modal underneath.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const redraw = () => {
    const ctx = ctxRef.current;
    const cvs = canvasRef.current;
    if (!ctx || !cvs) return;
    const rect = cvs.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = color;
    ctx.lineWidth   = width;
    for (const stroke of strokesRef.current) {
      if (stroke.length < 2) {
        if (stroke.length === 1) {
          ctx.beginPath();
          ctx.arc(stroke[0].x, stroke[0].y, width / 2, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length - 1; i++) {
        const midX = (stroke[i].x + stroke[i + 1].x) / 2;
        const midY = (stroke[i].y + stroke[i + 1].y) / 2;
        ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, midX, midY);
      }
      const last = stroke[stroke.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
  };

  // Refresh strokes whenever the brush settings change so the preview reflects
  // the current colour / weight even on already-drawn lines (matches the
  // expectation users have from Zoho where the whole signature recolours).
  useEffect(() => { redraw(); }, [color, width]); // eslint-disable-line react-hooks/exhaustive-deps

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cvs = canvasRef.current!;
    const rect = cvs.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown: React.PointerEventHandler<HTMLCanvasElement> = (e) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const pt = getPoint(e);
    currentRef.current = [pt];
    strokesRef.current.push(currentRef.current);
    setHasInk(true);
    redraw();
  };

  const onPointerMove: React.PointerEventHandler<HTMLCanvasElement> = (e) => {
    if (!currentRef.current) return;
    const pt = getPoint(e);
    const last = currentRef.current[currentRef.current.length - 1];
    // Skip duplicate / sub-pixel samples — tightens the curve and avoids
    // jagged spurs from high-frequency pointer events on trackpads.
    if (!last || Math.abs(pt.x - last.x) > 0.6 || Math.abs(pt.y - last.y) > 0.6) {
      currentRef.current.push(pt);
      redraw();
    }
  };

  const onPointerUp: React.PointerEventHandler<HTMLCanvasElement> = (e) => {
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    currentRef.current = null;
  };

  const clear = () => {
    strokesRef.current = [];
    setHasInk(false);
    redraw();
  };

  const undo = () => {
    strokesRef.current.pop();
    setHasInk(strokesRef.current.length > 0);
    redraw();
  };

  const insert = () => {
    const cvs = canvasRef.current;
    if (!cvs || !hasInk) return;
    // Crop to the inked bounding box so we don't insert a half-blank canvas.
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const dpr  = window.devicePixelRatio || 1;
    const w    = cvs.width;
    const h    = cvs.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return; // empty
    const pad = Math.round(8 * dpr);
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;
    const tmp = document.createElement('canvas');
    tmp.width = cw; tmp.height = ch;
    const tctx = tmp.getContext('2d');
    if (!tctx) return;
    tctx.drawImage(cvs, minX, minY, cw, ch, 0, 0, cw, ch);
    onInsert(tmp.toDataURL('image/png'), signerName);
  };

  return createPortal(
    <div className="tnw-sigpad-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true">
      <div className="tnw-sigpad-shell" onMouseDown={e => e.stopPropagation()}>
        <div className="tnw-sigpad-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="tnw-sigpad-head-ico">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17c2-2 4-3 6-3s3 1 5 2 4 1 7-2"/><path d="M14 6l4 4"/><path d="M3 21h18"/></svg>
            </span>
            <div>
              <div className="tnw-sigpad-title">Draw your signature</div>
              <div className="tnw-sigpad-sub">Use your mouse, finger, or stylus to sign below</div>
            </div>
          </div>
          <button type="button" className="tnw-sigpad-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="tnw-sigpad-body">
          <div className="tnw-sigpad-canvas-wrap">
            <canvas
              ref={canvasRef}
              className="tnw-sigpad-canvas"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={(e) => { if (currentRef.current) onPointerUp(e); }}
            />
            {!hasInk && <div className="tnw-sigpad-hint">✎ Sign here</div>}
          </div>

          <div className="tnw-sigpad-controls">
            <div className="tnw-sigpad-ctrl-row">
              <span className="tnw-sigpad-ctrl-label">Ink</span>
              <div className="tnw-sigpad-swatches">
                {['#0c4a6e', '#000000', '#1d4ed8', '#b91c1c'].map(c => (
                  <button
                    key={c}
                    type="button"
                    className={`tnw-sigpad-swatch ${color === c ? 'is-on' : ''}`}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                    aria-label={`Ink color ${c}`}
                  />
                ))}
              </div>
            </div>
            <div className="tnw-sigpad-ctrl-row">
              <span className="tnw-sigpad-ctrl-label">Stroke</span>
              <input
                type="range"
                min={1}
                max={6}
                step={0.5}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                className="tnw-sigpad-range"
              />
              <span className="tnw-sigpad-stroke-val">{width.toFixed(1)}</span>
            </div>
            <div className="tnw-sigpad-ctrl-row">
              <span className="tnw-sigpad-ctrl-label">Name</span>
              <input
                type="text"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Optional — displayed under signature"
                className="tnw-sigpad-name"
              />
            </div>
          </div>
        </div>

        <div className="tnw-sigpad-foot">
          <div className="tnw-sigpad-foot-left">
            <button type="button" className="tnw-btn tnw-btn-cancel" onClick={undo} disabled={!hasInk}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6"/><path d="M3.51 13a9 9 0 1 0 2.13-9.36L3 6"/></svg>
              Undo
            </button>
            <button type="button" className="tnw-btn tnw-btn-cancel" onClick={clear} disabled={!hasInk}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              Clear
            </button>
          </div>
          <div className="tnw-sigpad-foot-right">
            <button type="button" className="tnw-btn tnw-btn-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="tnw-btn tnw-btn-primary" onClick={insert} disabled={!hasInk}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><polyline points="20 6 9 17 4 12"/></svg>
              Insert Signature
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* Signature block presets — Tiptap-friendly HTML rendered with a thin
 * horizontal rule as the signature line and tokenised placeholders so the
 * doc-generation pipeline can swap real names / dates / images later
 * ({{SignatureBuyer}}, {{SignatureSupplier}}, …). `preview` is a tiny
 * mini-render used inside the popover button so the user can see what
 * they're about to insert. */
const SIG_LINE = '<hr style="border:0;border-top:1px solid #94a3b8;margin:36px 0 6px;width:240px"/>';
const SIGNATURE_PRESETS = [
  {
    title: 'Single Signatory',
    sub: 'One signature line · authorised signatory',
    html:
      '<p>&nbsp;</p>' +
      '<p><strong>Authorised Signatory</strong></p>' +
      SIG_LINE +
      '<p style="margin:0;font-size:12.5px">Name: {{SignatoryName}}</p>' +
      '<p style="margin:0;font-size:12.5px">Designation: {{SignatoryDesignation}}</p>' +
      '<p style="margin:0;font-size:12.5px">Date: {{SignatoryDate}}</p>',
    preview:
      '<div style="font-size:10.5px;color:#475569;line-height:1.45;margin-top:6px"><div style="font-weight:700;color:#0c4a6e">Authorised Signatory</div><div style="border-top:1px solid #94a3b8;margin:14px 0 4px"></div><div>Name · Designation · Date</div></div>',
  },
  {
    title: 'Customer & Supplier',
    sub: 'Side-by-side dual signature block',
    html:
      '<p>&nbsp;</p>' +
      '<table style="width:100%;border-collapse:collapse;margin-top:8px"><tbody><tr>' +
      '<td style="width:50%;vertical-align:top;padding-right:24px">' +
        '<p style="margin:0"><strong>For Customer</strong></p>' + SIG_LINE +
        '<p style="margin:0;font-size:12.5px">Name: {{BuyerSignatoryName}}</p>' +
        '<p style="margin:0;font-size:12.5px">Designation: {{BuyerSignatoryDesignation}}</p>' +
        '<p style="margin:0;font-size:12.5px">Date: {{BuyerSignatoryDate}}</p>' +
      '</td>' +
      '<td style="width:50%;vertical-align:top;padding-left:24px">' +
        '<p style="margin:0"><strong>For Supplier</strong></p>' + SIG_LINE +
        '<p style="margin:0;font-size:12.5px">Name: {{SupplierSignatoryName}}</p>' +
        '<p style="margin:0;font-size:12.5px">Designation: {{SupplierSignatoryDesignation}}</p>' +
        '<p style="margin:0;font-size:12.5px">Date: {{SupplierSignatoryDate}}</p>' +
      '</td>' +
      '</tr></tbody></table>',
    preview:
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:10.5px;color:#475569;line-height:1.4;margin-top:6px">' +
        '<div><div style="font-weight:700;color:#0c4a6e">For Customer</div><div style="border-top:1px solid #94a3b8;margin:12px 0 3px"></div><div>Name · Date</div></div>' +
        '<div><div style="font-weight:700;color:#0c4a6e">For Supplier</div><div style="border-top:1px solid #94a3b8;margin:12px 0 3px"></div><div>Name · Date</div></div>' +
      '</div>',
  },
  {
    title: 'With Witness',
    sub: 'Signatory + witness lines',
    html:
      '<p>&nbsp;</p>' +
      '<p><strong>Signed by</strong></p>' + SIG_LINE +
      '<p style="margin:0;font-size:12.5px">Name: {{SignatoryName}}</p>' +
      '<p style="margin:0;font-size:12.5px">Date: {{SignatoryDate}}</p>' +
      '<p style="margin-top:18px"><strong>In the presence of (Witness)</strong></p>' + SIG_LINE +
      '<p style="margin:0;font-size:12.5px">Name: {{WitnessName}}</p>' +
      '<p style="margin:0;font-size:12.5px">Date: {{WitnessDate}}</p>',
    preview:
      '<div style="font-size:10.5px;color:#475569;line-height:1.45;margin-top:6px">' +
        '<div style="font-weight:700;color:#0c4a6e">Signed by</div><div style="border-top:1px solid #94a3b8;margin:12px 0 4px"></div>' +
        '<div style="font-weight:700;color:#0c4a6e;margin-top:10px">Witness</div><div style="border-top:1px solid #94a3b8;margin:12px 0 4px"></div>' +
      '</div>',
  },
  {
    title: 'Date Only',
    sub: 'Inline date placeholder',
    html: '<p>Dated this <strong>{{Day}}</strong> day of <strong>{{Month}}</strong>, <strong>{{Year}}</strong>.</p>',
    preview:
      '<div style="font-size:11px;color:#475569;margin-top:6px;font-style:italic">Dated this <b>DD</b> day of <b>Month</b>, <b>YYYY</b>.</div>',
  },
];

/* Scoped CSS — same pattern as Trade-Doc draft wizard. Sits at z-index
 * above CLM modals; MasterSelect's portalled dropdown is bumped to 250000
 * so option lists stay visible. */
const TNW_CSS = `
.tnw-overlay {
  position: fixed; inset: 0; z-index: 200000;
  background: rgba(7,30,50,.65);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  overflow-y: auto;
  animation: tnwFade .18s ease both;
  font-family: var(--font-sans);
}
@keyframes tnwFade { from { opacity: 0; } to { opacity: 1; } }
.tnw-shell {
  width: 100%; max-width: 1100px; max-height: calc(100vh - 48px);
  display: flex; flex-direction: column;
  border-radius: 18px; overflow: hidden;
  background: #fff;
  margin: auto;
  box-shadow:
    0 28px 70px rgba(15,23,42,.45),
    0 12px 32px rgba(6,182,212,.22),
    0 0 0 1px rgba(255,255,255,.06);
  border: 1px solid rgba(6,182,212,.20);
  animation: tnwSlideUp .24s cubic-bezier(.22,1,.36,1) both;
}
@keyframes tnwSlideUp { from { opacity: 0; transform: translateY(20px) scale(.97) } to { opacity: 1; transform: none } }

/* ── Header ── */
.tnw-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px;
  padding: 18px 22px;
  background: linear-gradient(110deg, #0c6680 0%, #0e7490 35%, #0891b2 75%, #06b6d4 100%);
  color: #fff;
  position: relative; overflow: hidden;
  flex-shrink: 0;
}
.tnw-head::after {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%;
  background: linear-gradient(180deg, rgba(255,255,255,.10), transparent);
  pointer-events: none;
}
.tnw-head > * { position: relative; z-index: 1; }
.tnw-head-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.tnw-head-ico {
  width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0;
  background: rgba(255,255,255,.18);
  border: 1.5px solid rgba(255,255,255,.28);
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff;
  box-shadow: 0 4px 12px rgba(0,0,0,.15);
}
.tnw-head-text { min-width: 0; }
.tnw-head-eyebrow { font-size: 10px; font-weight: 800; letter-spacing: .14em; color: rgba(255,255,255,.78); text-transform: uppercase; }
.tnw-head-title { font-size: 19px; font-weight: 800; line-height: 1.2; letter-spacing: -.01em; margin-top: 2px; }
.tnw-head-sub { font-size: 12.5px; color: rgba(255,255,255,.86); margin-top: 4px; }
.tnw-head-right { display: inline-flex; align-items: center; gap: 10px; flex-shrink: 0; }
.tnw-id-chip {
  background: rgba(255,255,255,.12);
  border: 1px solid rgba(255,255,255,.24);
  border-radius: 10px;
  padding: 8px 16px;
  text-align: right;
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
}
.tnw-id-chip-label { font-size: 9.5px; font-weight: 700; letter-spacing: .12em; color: rgba(255,255,255,.74); text-transform: uppercase; }
.tnw-id-chip-val { font-size: 18px; font-weight: 800; color: #fff; margin-top: 2px;
  font-family: 'Geist Mono', ui-monospace, monospace; }
.tnw-close {
  width: 36px; height: 36px; border-radius: 10px;
  background: rgba(255,255,255,.14);
  border: 1px solid rgba(255,255,255,.22);
  color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s ease, transform .15s ease;
}
.tnw-close:hover { background: rgba(255,255,255,.26); transform: rotate(90deg); }
.tnw-close:disabled { opacity: .5; cursor: not-allowed; }

/* ── Stepper ── */
.tnw-stepper {
  display: flex; align-items: center; justify-content: space-between;
  background: #f8feff;
  border-bottom: 1px solid rgba(6,182,212,.18);
  padding: 16px 22px;
  gap: 22px; flex-wrap: wrap;
  flex-shrink: 0;
}
.tnw-stepper-row { display: inline-flex; align-items: center; gap: 0; flex: 1; min-width: 0; flex-wrap: wrap; }
.tnw-step {
  display: inline-flex; align-items: center; gap: 12px;
  padding: 10px 14px; border-radius: 12px;
  position: relative;
  transition: background .18s ease, box-shadow .22s ease;
}
.tnw-step.is-active {
  background: linear-gradient(135deg, #0891b2, #0e7490);
  box-shadow: 0 4px 14px rgba(8,145,178,.40);
}
.tnw-step.is-active .tnw-step-label,
.tnw-step.is-active .tnw-step-sub { color: #fff; }
.tnw-step.is-active .tnw-step-num { background: rgba(255,255,255,.20); border-color: rgba(255,255,255,.45); color: #fff; }
.tnw-step.is-complete .tnw-step-num { background: #22c55e; border-color: #16a34a; color: #fff; }
.tnw-step-num {
  width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
  border: 1.5px solid rgba(6,182,212,.32);
  background: #f0fdff;
  color: #0e7490;
  font-size: 14px; font-weight: 800;
  display: inline-flex; align-items: center; justify-content: center;
}
.tnw-step-text { min-width: 0; }
.tnw-step-label { font-size: 13px; font-weight: 800; color: #0c4a6e; letter-spacing: -.01em; line-height: 1.2; }
.tnw-step-sub { font-size: 11px; color: #0e7490; opacity: .8; margin-top: 2px; }
.tnw-step-line {
  width: 70px; height: 2px; flex-shrink: 0;
  background: #e2e8f0; margin: 0 6px;
  border-radius: 1px;
  transition: background .22s ease;
}
.tnw-step-line.is-complete { background: linear-gradient(90deg, #22c55e, #16a34a); }
.tnw-stepper-progress { display: inline-flex; flex-direction: column; gap: 6px; flex-shrink: 0; align-items: flex-end; }
.tnw-stepper-bars { display: inline-flex; gap: 4px; }
.tnw-stepper-bar { width: 50px; height: 4px; border-radius: 999px; background: #e2e8f0; transition: background .22s ease; }
.tnw-stepper-bar.on { background: linear-gradient(90deg, #22c55e, #06b6d4); }
.tnw-stepper-label {
  font-size: 10.5px; font-weight: 700; color: #0e7490;
  background: #f0fdff; border: 1px solid rgba(6,182,212,.22);
  padding: 4px 10px; border-radius: 999px;
}

/* ── Body ── */
.tnw-body {
  flex: 1; min-height: 0;
  overflow-y: auto;
  background: linear-gradient(160deg, #f0fdff 0%, #e8f9fd 50%, #f0f9ff 100%);
  padding: 22px;
}
.tnw-step-body { display: flex; flex-direction: column; gap: 18px; }
.tnw-grid-2 { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 18px; }
.tnw-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.tnw-label {
  font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
  color: #0e7490;
}
.tnw-req { color: #ef4444; font-size: 12px; line-height: 1; }
.tnw-input {
  width: 100%; box-sizing: border-box;
  border: 1.5px solid rgba(6,182,212,.25); border-radius: 9px;
  padding: 10px 13px;
  font-family: inherit; font-size: 13px; color: #0c4a6e;
  background: #fff; outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.tnw-input:hover { border-color: rgba(6,182,212,.40); }
.tnw-input:focus { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.14); }
.tnw-input.is-err { border-color: #ef4444; }
.tnw-input::placeholder { color: #94a3b8; }
/* Dropdowns (MasterSelect / MasterMultiSelect) match the white input border. */
.tnw-step-body .master-select-toggle {
  background: #fff; border: 1.5px solid rgba(6,182,212,.25); border-radius: 9px;
}
.tnw-step-body .master-select-toggle:hover:not(:disabled) { border-color: rgba(6,182,212,.40); box-shadow: none; }
.tnw-step-body .master-select-wrap.show .master-select-toggle {
  border-color: #0891b2 !important; box-shadow: 0 0 0 3px rgba(8,145,178,.14) !important;
}
.tnw-hint { font-size: 11px; color: #0891b2; opacity: .8; }
.tnw-err { font-size: 11px; color: #ef4444; font-weight: 600; }
.tnw-label-tag {
  margin-left: 8px; text-transform: none; letter-spacing: 0;
  font-size: 9.5px; font-weight: 700; color: #64748b;
  background: #f1f5f9; border: 1px solid #e2e8f0;
  padding: 1px 7px; border-radius: 999px;
}

/* ── Regulatory tier selector (figma: two radio cards) ── */
.tnw-reg-grid { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 12px; }
.tnw-reg-card {
  display: flex; align-items: center; gap: 11px;
  text-align: left; cursor: pointer; font-family: inherit;
  padding: 12px 14px; border-radius: 11px;
  border: 1.5px solid #e2e8f0; background: #fff;
  transition: border-color .15s ease, background .15s ease, box-shadow .15s ease;
}
.tnw-reg-radio {
  width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0;
  border: 2px solid #cbd5e1; position: relative;
  transition: border-color .15s ease;
}
.tnw-reg-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tnw-reg-title { font-size: 13px; font-weight: 800; color: #334155; }
.tnw-reg-sub   { font-size: 11px; color: #64748b; line-height: 1.35; }
/* High Regulatory → red accent when selected */
.tnw-reg-high.is-on  { border-color: #f87171; background: #fef2f2; }
.tnw-reg-high.is-on .tnw-reg-radio { border-color: #ef4444; }
.tnw-reg-high.is-on .tnw-reg-radio::after {
  content: ''; position: absolute; inset: 2px; border-radius: 50%; background: #ef4444;
}
.tnw-reg-high.is-on .tnw-reg-title { color: #b91c1c; }
/* Less Regulatory → green accent when selected */
.tnw-reg-less.is-on  { border-color: #6ee7b7; background: #ecfdf5; }
.tnw-reg-less.is-on .tnw-reg-radio { border-color: #10b981; }
.tnw-reg-less.is-on .tnw-reg-radio::after {
  content: ''; position: absolute; inset: 2px; border-radius: 50%; background: #10b981;
}
.tnw-reg-less.is-on .tnw-reg-title { color: #047857; }

/* ── Multi-segment chip picker (Less Regulatory) ── */
.tnw-seg-multi {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  min-height: 40px; padding: 7px;
  border: 1.5px solid rgba(6,182,212,.25); border-radius: 9px; background: #fff;
}
.tnw-seg-multi.is-invalid { border-color: #ef4444; }
.tnw-seg-multi-empty { font-size: 11.5px; color: #94a3b8; padding: 2px 4px; }
.tnw-seg-add-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 11px; border-radius: 999px; cursor: pointer; font-family: inherit;
  font-size: 12px; font-weight: 700; color: #0891b2;
  background: #ecfeff; border: 1.5px dashed rgba(6,182,212,.45);
  transition: background .15s ease, border-color .15s ease;
}
.tnw-seg-add-chip:hover { background: #cffafe; border-color: #0891b2; }

.tnw-inline-add { display: flex; gap: 8px; align-items: stretch; }
.tnw-add-mini {
  width: 38px; height: 38px; border-radius: 9px; flex-shrink: 0;
  border: none; cursor: pointer;
  background: linear-gradient(135deg, #0891b2, #0e7490);
  color: #fff; display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 3px 10px rgba(8,145,178,.35);
  transition: transform .15s ease, box-shadow .22s ease;
}
.tnw-add-mini:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(8,145,178,.50); }

/* ── Applies-To card ── */
.tnw-party {
  border: 1.5px solid rgba(6,182,212,.20);
  border-radius: 14px;
  padding: 18px 20px;
  background: linear-gradient(180deg, #ffffff 0%, #f7feff 100%);
  display: flex; flex-direction: column; gap: 14px;
}
.tnw-party-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.tnw-party-head {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 11.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
  color: #0891b2;
}
.tnw-party-ico {
  width: 22px; height: 22px; border-radius: 7px;
  background: rgba(8,145,178,.10);
  display: inline-flex; align-items: center; justify-content: center;
  color: #0891b2;
}
.tnw-party-row {
  display: grid;
  grid-template-columns: 170px 1fr;
  align-items: center;
  gap: 14px;
}
.tnw-party-label {
  font-size: 11px; font-weight: 700; letter-spacing: .04em; color: #475569;
  text-transform: uppercase;
}
.tnw-party-options { display: inline-flex; flex-wrap: wrap; gap: 10px; }
.tnw-checkbox {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 14px; border-radius: 10px;
  border: 1.5px solid #e2e8f0;
  background: #fff;
  font-size: 13px; font-weight: 600; color: #334155;
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease, color .15s ease, box-shadow .22s ease;
}
.tnw-checkbox input { width: 14px; height: 14px; accent-color: #0891b2; }
.tnw-checkbox-emoji { font-size: 15px; line-height: 1; }
.tnw-checkbox:hover { border-color: rgba(6,182,212,.45); background: #f0fdff; }
.tnw-checkbox.is-on {
  background: #f0fdff;
  border-color: #0891b2;
  color: #0e7490;
  box-shadow: 0 2px 8px rgba(8,145,178,.18);
}
.tnw-checkbox-all { padding: 6px 12px; font-size: 12px; letter-spacing: .04em; font-weight: 800; }
.tnw-party-hint { font-size: 11.5px; color: #94a3b8; }

/* ── Editor (step 2) ── */
.tnw-editor-shell {
  border: 1px solid rgba(6,182,212,.20);
  border-radius: 14px;
  overflow: hidden;
  background: #fff;
}
.tnw-editor-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
  background: linear-gradient(110deg, #0891b2, #0e7490);
  padding: 12px 18px;
  color: #fff;
}
.tnw-editor-title {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
}
.tnw-editor-actions { display: inline-flex; gap: 8px; flex-wrap: wrap; }
.tnw-editor-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; border-radius: 8px;
  background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.24);
  color: #fff;
  font-size: 12px; font-weight: 700;
  cursor: pointer;
  transition: background .15s ease;
}
.tnw-editor-btn:hover { background: rgba(255,255,255,.26); }
.tnw-toolbar {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 8px 14px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.tnw-toolbar-sel, .tnw-toolbar-btn {
  height: 30px; min-width: 30px; padding: 0 8px;
  border: 1px solid #e2e8f0; border-radius: 6px;
  background: #fff; color: #475569;
  font-size: 12px; font-weight: 600; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s ease, border-color .15s ease, color .15s ease;
}
.tnw-toolbar-btn:hover { background: #f0fdff; border-color: #67e8f9; color: #0891b2; }
.tnw-toolbar-btn.is-on { background: #cffafe; border-color: #0891b2; color: #0c4a6e; box-shadow: inset 0 1px 2px rgba(8,145,178,.18); }
.tnw-toolbar-btn:disabled { opacity: .4; cursor: not-allowed; }
.tnw-toolbar-sep { width: 1px; height: 20px; background: #cbd5e1; }

.tnw-editor-area { position: relative; }
.tnw-editor, .tnw-editor .ProseMirror {
  min-height: 240px;
  padding: 18px 22px;
  background: #fff;
  outline: none;
  font-size: 13.5px; line-height: 1.6; color: #0c4a6e;
}
.tnw-editor .ProseMirror { padding: 0; min-height: 240px; }
.tnw-editor .ProseMirror:focus { outline: none; }
.tnw-editor .ProseMirror p { margin: 0 0 .6em 0; }
.tnw-editor .ProseMirror p:last-child { margin-bottom: 0; }
.tnw-editor .ProseMirror h1, .tnw-editor .ProseMirror h2, .tnw-editor .ProseMirror h3 { color: #0c4a6e; font-weight: 800; margin: .4em 0 .4em; line-height: 1.25; }
.tnw-editor .ProseMirror h1 { font-size: 22px; }
.tnw-editor .ProseMirror h2 { font-size: 18px; }
.tnw-editor .ProseMirror h3 { font-size: 15.5px; }
.tnw-editor .ProseMirror ul, .tnw-editor .ProseMirror ol { padding-left: 22px; margin: 0 0 .6em 0; }
.tnw-editor .ProseMirror blockquote { border-left: 3px solid #67e8f9; padding-left: 12px; margin: .4em 0; color: #475569; font-style: italic; }
.tnw-editor .ProseMirror code { background: #f0fdff; padding: 1px 5px; border-radius: 4px; font-family: 'Geist Mono', ui-monospace, monospace; font-size: 12.5px; color: #0e7490; }
.tnw-editor .ProseMirror hr { border: 0; border-top: 1px dashed #94a3b8; margin: 14px 0; }
.tnw-editor .ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: #94a3b8; pointer-events: none; float: left; height: 0;
}

/* Clause Library popover — slides in from the right inside the editor area */
.tnw-clause-panel {
  position: absolute; top: 0; right: 0; bottom: 0;
  width: min(320px, 70%);
  background: #ffffff;
  border-left: 1px solid rgba(6,182,212,.22);
  box-shadow: -8px 0 24px rgba(15,23,42,.10);
  display: flex; flex-direction: column;
  animation: tnwClauseSlide .22s ease both;
  z-index: 5;
}
@keyframes tnwClauseSlide { from { transform: translateX(12px); opacity: 0 } to { transform: none; opacity: 1 } }
.tnw-clause-panel-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  background: linear-gradient(110deg, #0891b2, #0e7490);
  color: #fff;
  font-size: 12px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
}
.tnw-clause-close {
  width: 24px; height: 24px; border-radius: 6px; cursor: pointer;
  background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.24); color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s ease;
}
.tnw-clause-close:hover { background: rgba(255,255,255,.30); }
.tnw-clause-panel-body { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.tnw-clause-item {
  display: flex; flex-direction: column; gap: 2px; text-align: left;
  padding: 10px 12px; border-radius: 10px;
  border: 1px solid rgba(6,182,212,.18); background: #f8feff;
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease, transform .15s ease;
}
.tnw-clause-item:hover { border-color: #0891b2; background: #ecfeff; transform: translateY(-1px); }
.tnw-clause-item-title { font-size: 13px; font-weight: 800; color: #0c4a6e; display: inline-flex; align-items: center; gap: 6px; }
.tnw-clause-item-sub { font-size: 11px; color: #0e7490; opacity: .85; }
.tnw-sig-ico {
  width: 22px; height: 22px; border-radius: 6px;
  background: rgba(8,145,178,.10); color: #0891b2;
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.tnw-sig-preview {
  margin-top: 8px; padding: 8px 10px;
  background: #ffffff; border: 1px dashed #cbd5e1; border-radius: 8px;
  display: block;
}

/* "Draw Signature" CTA at the top of the signature popover */
.tnw-sig-draw-cta {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; border-radius: 12px;
  background: linear-gradient(110deg, #0891b2 0%, #0e7490 100%);
  color: #fff; border: 0; cursor: pointer; text-align: left;
  box-shadow: 0 6px 18px rgba(8,145,178,.30), inset 0 1px 0 rgba(255,255,255,.15);
  transition: transform .18s ease, box-shadow .22s ease;
}
.tnw-sig-draw-cta:hover { transform: translateY(-1px); box-shadow: 0 10px 24px rgba(8,145,178,.42), inset 0 1px 0 rgba(255,255,255,.22); }
.tnw-sig-draw-ico {
  width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0;
  background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.28);
  display: inline-flex; align-items: center; justify-content: center; color: #fff;
}
.tnw-sig-divider {
  display: flex; align-items: center; gap: 8px;
  margin: 8px 2px 4px;
  font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: #94a3b8;
}
.tnw-sig-divider::before, .tnw-sig-divider::after { content: ''; flex: 1; height: 1px; background: #e2e8f0; }

/* ── Signature Pad overlay ── */
.tnw-sigpad-overlay {
  position: fixed; inset: 0; z-index: 300000;
  background: rgba(7,30,50,.72);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center; padding: 20px;
  animation: tnwFade .18s ease both;
}
.tnw-sigpad-shell {
  width: 100%; max-width: 640px;
  background: #fff; border-radius: 16px; overflow: hidden;
  border: 1px solid rgba(6,182,212,.22);
  box-shadow: 0 28px 70px rgba(15,23,42,.55), 0 12px 32px rgba(6,182,212,.20);
  display: flex; flex-direction: column;
  animation: tnwSlideUp .22s cubic-bezier(.22,1,.36,1) both;
}
.tnw-sigpad-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px;
  background: linear-gradient(110deg, #0c6680 0%, #0891b2 100%);
  color: #fff;
}
.tnw-sigpad-head-ico {
  width: 36px; height: 36px; border-radius: 10px;
  background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.28);
  display: inline-flex; align-items: center; justify-content: center; color: #fff;
}
.tnw-sigpad-title { font-size: 15.5px; font-weight: 800; line-height: 1.2; }
.tnw-sigpad-sub   { font-size: 11.5px; color: rgba(255,255,255,.85); margin-top: 2px; }
.tnw-sigpad-close {
  width: 32px; height: 32px; border-radius: 8px;
  background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.24);
  color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s ease, transform .15s ease;
}
.tnw-sigpad-close:hover { background: rgba(255,255,255,.28); transform: rotate(90deg); }

.tnw-sigpad-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; background: linear-gradient(180deg, #f0fdff 0%, #ecfeff 100%); }
.tnw-sigpad-canvas-wrap {
  position: relative;
  width: 100%; height: 220px;
  border: 2px dashed rgba(6,182,212,.40);
  border-radius: 12px;
  background:
    linear-gradient(#ffffff, #ffffff) padding-box,
    repeating-linear-gradient(0deg, transparent 0 30px, rgba(15,23,42,.04) 30px 31px);
  overflow: hidden;
}
.tnw-sigpad-canvas {
  width: 100%; height: 100%; display: block;
  touch-action: none; cursor: crosshair;
}
.tnw-sigpad-hint {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none;
  color: #94a3b8; font-size: 14px; font-weight: 700; letter-spacing: .04em;
}

.tnw-sigpad-controls {
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px 14px;
  background: #ffffff; border: 1px solid rgba(6,182,212,.20); border-radius: 10px;
}
.tnw-sigpad-ctrl-row { display: flex; align-items: center; gap: 12px; }
.tnw-sigpad-ctrl-label { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #0e7490; width: 58px; flex-shrink: 0; }
.tnw-sigpad-swatches { display: inline-flex; gap: 6px; }
.tnw-sigpad-swatch {
  width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid #e2e8f0; cursor: pointer; padding: 0;
  transition: border-color .15s ease, transform .15s ease;
}
.tnw-sigpad-swatch:hover { transform: scale(1.08); }
.tnw-sigpad-swatch.is-on { border-color: #0891b2; box-shadow: 0 0 0 2px rgba(8,145,178,.20); }
.tnw-sigpad-range { flex: 1; accent-color: #0891b2; }
.tnw-sigpad-stroke-val { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 12px; color: #0e7490; width: 28px; text-align: right; }
.tnw-sigpad-name {
  flex: 1; padding: 8px 12px;
  border: 1.5px solid rgba(6,182,212,.25); border-radius: 8px;
  font-family: inherit; font-size: 13px; color: #0c4a6e; background: #fff; outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.tnw-sigpad-name:focus { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.14); }

.tnw-sigpad-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 14px 20px;
  background: #fff; border-top: 1px solid rgba(6,182,212,.18);
  flex-wrap: wrap;
}
.tnw-sigpad-foot-left, .tnw-sigpad-foot-right { display: inline-flex; gap: 8px; }

[data-bs-theme="dark"] .tnw-sigpad-shell { background: #0f172a; border-color: rgba(6,182,212,.30); }
[data-bs-theme="dark"] .tnw-sigpad-body  { background: linear-gradient(180deg, rgba(8,145,178,.10) 0%, rgba(8,145,178,.04) 100%); }
[data-bs-theme="dark"] .tnw-sigpad-canvas-wrap {
  background:
    linear-gradient(#0b1726, #0b1726) padding-box,
    repeating-linear-gradient(0deg, transparent 0 30px, rgba(255,255,255,.04) 30px 31px);
  border-color: rgba(103,232,249,.45);
}
[data-bs-theme="dark"] .tnw-sigpad-hint { color: #64748b; }
[data-bs-theme="dark"] .tnw-sigpad-controls { background: #0b1726; border-color: rgba(6,182,212,.30); }
[data-bs-theme="dark"] .tnw-sigpad-ctrl-label { color: #67e8f9; }
[data-bs-theme="dark"] .tnw-sigpad-name { background: #1e293b; border-color: rgba(6,182,212,.30); color: #e2e8f0; }
[data-bs-theme="dark"] .tnw-sigpad-name::placeholder { color: #64748b; }
[data-bs-theme="dark"] .tnw-sigpad-stroke-val { color: #67e8f9; }
[data-bs-theme="dark"] .tnw-sigpad-foot { background: #0f172a; border-top-color: rgba(6,182,212,.30); }
[data-bs-theme="dark"] .tnw-sig-divider { color: #64748b; }
[data-bs-theme="dark"] .tnw-sig-divider::before, [data-bs-theme="dark"] .tnw-sig-divider::after { background: rgba(255,255,255,.08); }

.tnw-editor-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 18px;
  background: #f0fdff; border-top: 1px solid #e2e8f0;
  font-size: 11.5px;
  gap: 12px; flex-wrap: wrap;
}
.tnw-editor-foot-hint { color: #0e7490; opacity: .85; }
.tnw-editor-foot-tag {
  background: #fff; border: 1px solid #67e8f9;
  padding: 3px 9px; border-radius: 6px;
  color: #0891b2; font-weight: 700;
  font-family: 'Geist Mono', ui-monospace, monospace; font-size: 11px;
  cursor: pointer;
  transition: background .15s ease, color .15s ease, transform .15s ease;
}
.tnw-editor-foot-tag:hover { background: #cffafe; color: #0c4a6e; transform: translateY(-1px); }

/* ── Footer ── */
.tnw-foot {
  display: flex; align-items: center; justify-content: space-between;
  background: #fff;
  border-top: 1px solid rgba(6,182,212,.18);
  padding: 14px 22px;
  flex-shrink: 0;
}
.tnw-foot-left, .tnw-foot-right { display: inline-flex; align-items: center; gap: 10px; }
.tnw-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 10px 22px; border-radius: 10px;
  font-family: inherit; font-size: 13px; font-weight: 700;
  cursor: pointer;
  transition: transform .18s ease, box-shadow .22s ease, background .18s ease, color .18s ease, border-color .18s ease;
}
.tnw-btn-back, .tnw-btn-cancel {
  background: #fff; color: #475569;
  border: 1px solid #e2e8f0;
}
.tnw-btn-back:hover, .tnw-btn-cancel:hover { border-color: #0891b2; color: #0891b2; background: #f0fdff; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(8,145,178,.16); }
.tnw-btn-primary {
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 55%, #0e7490 100%);
  color: #fff; border: none;
  box-shadow: 0 4px 14px rgba(8,145,178,.40), inset 0 1px 0 rgba(255,255,255,.18);
}
.tnw-btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 10px 26px rgba(8,145,178,.55), inset 0 1px 0 rgba(255,255,255,.22);
}
.tnw-btn:disabled { opacity: .55; cursor: not-allowed; transform: none; box-shadow: none; }

/* ── Dark mode ── */
[data-bs-theme="dark"] .tnw-shell { background: #0f172a; border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .tnw-stepper { background: rgba(8,145,178,.06); border-bottom-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .tnw-step-num { background: rgba(8,145,178,.16); border-color: rgba(6,182,212,.35); color: #67e8f9; }
[data-bs-theme="dark"] .tnw-step-label { color: #cffafe; }
[data-bs-theme="dark"] .tnw-step-sub { color: #67e8f9; }
[data-bs-theme="dark"] .tnw-step.is-active .tnw-step-label,
[data-bs-theme="dark"] .tnw-step.is-active .tnw-step-sub { color: #fff; }
[data-bs-theme="dark"] .tnw-step-line { background: rgba(255,255,255,.10); }
[data-bs-theme="dark"] .tnw-stepper-bar { background: rgba(255,255,255,.08); }
[data-bs-theme="dark"] .tnw-stepper-label { background: rgba(8,145,178,.16); color: #67e8f9; border-color: rgba(6,182,212,.35); }
[data-bs-theme="dark"] .tnw-body { background: linear-gradient(160deg, rgba(8,145,178,.06) 0%, rgba(8,145,178,.03) 50%, #0f172a 100%); }
[data-bs-theme="dark"] .tnw-label { color: #67e8f9; }
[data-bs-theme="dark"] .tnw-input { background-color: #1e293b; border-color: rgba(6,182,212,.30); color: #e2e8f0; }
[data-bs-theme="dark"] .tnw-step-body .master-select-toggle { background: #1e293b; border-color: rgba(6,182,212,.30); }
[data-bs-theme="dark"] .tnw-input::placeholder { color: #94a3b8; }
[data-bs-theme="dark"] .tnw-hint { color: #67e8f9; }
[data-bs-theme="dark"] .tnw-party { background: linear-gradient(180deg, #0f172a 0%, #102234 100%); border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .tnw-party-head { color: #67e8f9; }
[data-bs-theme="dark"] .tnw-party-ico { background: rgba(8,145,178,.20); color: #67e8f9; }
[data-bs-theme="dark"] .tnw-party-label { color: #cbd5e1; }
[data-bs-theme="dark"] .tnw-checkbox { background: #1e293b; border-color: rgba(6,182,212,.22); color: #cbd5e1; }
[data-bs-theme="dark"] .tnw-checkbox:hover { background: rgba(8,145,178,.10); border-color: rgba(103,232,249,.45); }
[data-bs-theme="dark"] .tnw-checkbox.is-on { background: rgba(8,145,178,.22); border-color: #67e8f9; color: #cffafe; }
[data-bs-theme="dark"] .tnw-party-hint { color: #94a3b8; }
[data-bs-theme="dark"] .tnw-label-tag { background: #1e293b; border-color: rgba(148,163,184,.25); color: #94a3b8; }
[data-bs-theme="dark"] .tnw-reg-card { background: #1e293b; border-color: rgba(148,163,184,.22); }
[data-bs-theme="dark"] .tnw-reg-title { color: #e2e8f0; }
[data-bs-theme="dark"] .tnw-reg-sub { color: #94a3b8; }
[data-bs-theme="dark"] .tnw-reg-high.is-on { background: rgba(239,68,68,.14); border-color: rgba(248,113,113,.55); }
[data-bs-theme="dark"] .tnw-reg-high.is-on .tnw-reg-title { color: #fca5a5; }
[data-bs-theme="dark"] .tnw-reg-less.is-on { background: rgba(16,185,129,.14); border-color: rgba(110,231,183,.55); }
[data-bs-theme="dark"] .tnw-reg-less.is-on .tnw-reg-title { color: #6ee7b7; }
[data-bs-theme="dark"] .tnw-seg-multi { background: #1e293b; border-color: rgba(6,182,212,.30); }
[data-bs-theme="dark"] .tnw-seg-multi-empty { color: #94a3b8; }
[data-bs-theme="dark"] .tnw-seg-add-chip { background: rgba(8,145,178,.18); border-color: rgba(103,232,249,.45); color: #67e8f9; }
[data-bs-theme="dark"] .tnw-editor-shell { background: #0f172a; border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .tnw-toolbar { background: rgba(8,145,178,.06); border-bottom-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .tnw-toolbar-sel, [data-bs-theme="dark"] .tnw-toolbar-btn { background: #1e293b; border-color: rgba(6,182,212,.22); color: #cbd5e1; }
[data-bs-theme="dark"] .tnw-toolbar-btn:hover { background: rgba(8,145,178,.14); color: #67e8f9; border-color: rgba(103,232,249,.45); }
[data-bs-theme="dark"] .tnw-toolbar-sep { background: rgba(255,255,255,.10); }
[data-bs-theme="dark"] .tnw-editor, [data-bs-theme="dark"] .tnw-editor .ProseMirror { background: #0f172a; color: #e2e8f0; }
[data-bs-theme="dark"] .tnw-editor .ProseMirror h1, [data-bs-theme="dark"] .tnw-editor .ProseMirror h2, [data-bs-theme="dark"] .tnw-editor .ProseMirror h3 { color: #cffafe; }
[data-bs-theme="dark"] .tnw-editor .ProseMirror blockquote { border-left-color: rgba(103,232,249,.55); color: #cbd5e1; }
[data-bs-theme="dark"] .tnw-editor .ProseMirror code { background: rgba(8,145,178,.20); color: #cffafe; }
[data-bs-theme="dark"] .tnw-editor .ProseMirror p.is-editor-empty:first-child::before { color: #64748b; }
[data-bs-theme="dark"] .tnw-toolbar-btn.is-on { background: rgba(8,145,178,.30); border-color: rgba(103,232,249,.55); color: #cffafe; box-shadow: inset 0 1px 2px rgba(0,0,0,.25); }
[data-bs-theme="dark"] .tnw-clause-panel { background: #0f172a; border-left-color: rgba(6,182,212,.30); box-shadow: -8px 0 24px rgba(0,0,0,.45); }
[data-bs-theme="dark"] .tnw-clause-item { background: rgba(8,145,178,.08); border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .tnw-clause-item:hover { background: rgba(8,145,178,.18); border-color: #67e8f9; }
[data-bs-theme="dark"] .tnw-clause-item-title { color: #cffafe; }
[data-bs-theme="dark"] .tnw-clause-item-sub { color: #67e8f9; }
[data-bs-theme="dark"] .tnw-sig-ico { background: rgba(8,145,178,.22); color: #67e8f9; }
[data-bs-theme="dark"] .tnw-sig-preview { background: rgba(15,23,42,.55); border-color: rgba(148,163,184,.30); }
[data-bs-theme="dark"] .tnw-editor-foot { background: rgba(8,145,178,.10); border-top-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .tnw-editor-foot-hint { color: #67e8f9; }
[data-bs-theme="dark"] .tnw-editor-foot-tag { background: rgba(8,145,178,.18); color: #cffafe; border-color: rgba(6,182,212,.35); }
[data-bs-theme="dark"] .tnw-editor-foot-tag:hover { background: rgba(8,145,178,.32); color: #f0fdff; }
[data-bs-theme="dark"] .tnw-foot { background: #0f172a; border-top-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .tnw-btn-back, [data-bs-theme="dark"] .tnw-btn-cancel { background: rgba(255,255,255,.04); color: #cbd5e1; border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .tnw-btn-back:hover, [data-bs-theme="dark"] .tnw-btn-cancel:hover { background: rgba(8,145,178,.14); color: #67e8f9; border-color: rgba(103,232,249,.45); }

/* MasterSelect's portalled dropdown menu sits at z-index 11000 by
   default — bump it above this modal so option lists are visible. */
.master-select-menu.dropdown-menu { z-index: 250000 !important; }

/* ── Responsive ── */
@media (max-width: 900px) {
  .tnw-overlay { padding: 16px; }
  .tnw-shell { max-height: calc(100vh - 32px); }
  .tnw-head { flex-direction: column; align-items: stretch; }
  .tnw-head-right { align-self: flex-start; }
  .tnw-stepper-row { width: 100%; }
  .tnw-step-line { display: none; }
  .tnw-grid-2 { grid-template-columns: minmax(0,1fr); }
  .tnw-party-row { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .tnw-overlay { padding: 8px; }
  .tnw-step { padding: 8px 10px; gap: 8px; }
  .tnw-step-num { width: 30px; height: 30px; font-size: 12px; }
  .tnw-step-label { font-size: 12px; }
  .tnw-step-sub { font-size: 10.5px; }
  .tnw-body, .tnw-foot, .tnw-stepper, .tnw-head { padding: 14px 16px; }
  .tnw-foot { flex-direction: column-reverse; align-items: stretch; gap: 8px; }
  .tnw-foot-left, .tnw-foot-right { width: 100%; justify-content: stretch; }
  .tnw-btn { flex: 1; justify-content: center; }
}
`;
