import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import CustomFieldModal, { CustomFieldFormPayload } from './CustomFieldModal';

// ── Placeholder catalogue ─────────────────────────────────────────────────────
// Grouped exactly the way the Keka reference UI does it. The labels are the
// human-readable copy that appears in the left sidebar; the `token` is what
// gets inserted at the caret (using the {{FieldName}} format). Signer tokens
// are augmented dynamically based on the configured signing workflow.
export type PlaceholderField = { label: string; token: string };
export type PlaceholderGroup = { id: string; label: string; fields: PlaceholderField[] };

export const STATIC_PLACEHOLDER_GROUPS: PlaceholderGroup[] = [
  { id: 'basic', label: 'Employee Basic Info', fields: [
    { label: 'First Name',     token: '{{FirstName}}' },
    { label: 'Middle Name',    token: '{{MiddleName}}' },
    { label: 'Last Name',      token: '{{LastName}}' },
    { label: 'Full Name',      token: '{{FullName}}' },
    { label: 'Display Name',   token: '{{DisplayName}}' },
    { label: 'Employee ID',    token: '{{EmployeeNumber}}' },
  ]},
  { id: 'contact', label: 'Employee Contact', fields: [
    { label: 'Email',          token: '{{Email}}' },
    { label: 'Mobile',         token: '{{Mobile}}' },
    { label: 'Address',        token: '{{Address}}' },
    { label: 'City',           token: '{{City}}' },
    { label: 'State',          token: '{{State}}' },
  ]},
  { id: 'job', label: 'Employee Job', fields: [
    { label: 'Job Title',      token: '{{JobTitle}}' },
    { label: 'Department',     token: '{{Department}}' },
    { label: 'Designation',    token: '{{Designation}}' },
    { label: 'Joining Date',   token: '{{JoiningDate}}' },
    { label: 'Reports To',     token: '{{ReportsTo}}' },
  ]},
  { id: 'salary', label: 'Salary', fields: [
    { label: 'CTC',            token: '{{CTC}}' },
    { label: 'Basic',          token: '{{Basic}}' },
    { label: 'HRA',            token: '{{HRA}}' },
  ]},
  { id: 'org', label: 'Organization', fields: [
    { label: 'Company Name',   token: '{{CompanyName}}' },
    { label: 'Company Address',token: '{{CompanyAddress}}' },
    { label: 'Logo',           token: '{{CompanyLogo}}' },
  ]},
];

export type SignerLite = { role_name?: string | null; designation_name?: string | null };

// Loaded from /hr-custom-fields/known-tokens — the user-defined variables
// that complement the static employee tokens above. Rendered in the sidebar
// in its own group with an inline "+ Add new" footer.
type LoadedCustomField = { id: number; name: string; token: string; type: string; description: string | null };

// Pull every {{Token}} occurrence out of an HTML/text blob. Used to surface
// unknown tokens (the ones the user typed by hand and that aren't registered
// anywhere yet) so the editor can offer a one-click "Add as Custom Field" CTA.
function extractTokens(html: string): string[] {
  const out = new Set<string>();
  const re = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.add(m[1]);
  return Array.from(out);
}

// Signer{N}{Name|Designation|Date} is a positional pattern resolved at gen
// time — treat it as known even though it's not in any static list.
const SIGNER_TOKEN_RE = /^Signer\d+(Name|Designation|Date)$/;

// Build per-signer placeholder rows from the workflow configured in step 2.
// Mirrors the right-hand "REQUIRED SIGNER VARIABLES" panel from the screenshot.
export function buildSignerGroup(signers: SignerLite[]): PlaceholderGroup {
  const fields: PlaceholderField[] = [];
  signers.forEach((_s, i) => {
    const n = i + 1;
    fields.push({ label: `Signer ${n} Name`,        token: `{{Signer${n}Name}}` });
    fields.push({ label: `Signer ${n} Designation`, token: `{{Signer${n}Designation}}` });
    fields.push({ label: `Signer ${n} Date`,        token: `{{Signer${n}Date}}` });
  });
  return { id: 'signers', label: 'Workflow Signers', fields };
}

// ── Editor ───────────────────────────────────────────────────────────────────
export default function TemplateEditor({
  value,
  onChange,
  signers,
}: {
  value: string;
  onChange: (html: string) => void;
  signers: SignerLite[];
}) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ basic: true, signers: true, custom: true });

  // Custom Fields — loaded once on mount; reloaded after the inline modal
  // saves a new field so the new {{Token}} disappears from "unknown" and
  // shows up in the sidebar group.
  const [customFields, setCustomFields] = useState<LoadedCustomField[]>([]);
  const [inlineModalOpen, setInlineModalOpen] = useState(false);
  const [inlinePrefill, setInlinePrefill] = useState<string>('');

  const loadCustomFields = async () => {
    try {
      const { data } = await api.get('/hr-custom-fields/known-tokens');
      setCustomFields(Array.isArray(data?.custom_fields) ? data.custom_fields : []);
    } catch {
      // Non-fatal — the editor still works without the custom-fields sidebar.
      setCustomFields([]);
    }
  };
  useEffect(() => { loadCustomFields(); }, []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: value || '<p></p>',
    onUpdate({ editor }) { onChange(editor.getHTML()); },
  });

  // Keep the editor in sync when the wizard switches edit targets (the
  // parent passes a fresh `value` and we hydrate the editor once per change).
  const lastSyncedRef = useRef<string>(value);
  useEffect(() => {
    if (!editor) return;
    if (value !== lastSyncedRef.current && value !== editor.getHTML()) {
      editor.commands.setContent(value || '<p></p>', false);
      lastSyncedRef.current = value;
    }
  }, [value, editor]);

  const customGroup = useMemo<PlaceholderGroup>(() => ({
    id: 'custom',
    label: 'Custom Fields',
    fields: customFields.map(c => ({
      label: c.name + (c.type ? ` · ${c.type}` : ''),
      token: c.token,
    })),
  }), [customFields]);

  const groups = useMemo<PlaceholderGroup[]>(() => {
    const signerGroup = buildSignerGroup(signers);
    return [...STATIC_PLACEHOLDER_GROUPS, signerGroup, customGroup];
  }, [signers, customGroup]);

  const filteredGroups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map(g => ({ ...g, fields: g.fields.filter(f => f.label.toLowerCase().includes(needle) || f.token.toLowerCase().includes(needle)) }))
      .filter(g => g.fields.length > 0);
  }, [groups, search]);

  // The flat set of every token name the editor recognises. Used to compute
  // "unknown" tokens — anything {{X}} the user typed by hand that doesn't
  // map to an employee field, a signer slot, or a registered custom field.
  const knownNameSet = useMemo(() => {
    const set = new Set<string>();
    const addToken = (tok: string) => {
      const m = tok.match(/^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/);
      if (m) set.add(m[1]);
    };
    STATIC_PLACEHOLDER_GROUPS.forEach(g => g.fields.forEach(f => addToken(f.token)));
    buildSignerGroup(signers).fields.forEach(f => addToken(f.token));
    customFields.forEach(c => set.add(c.name));
    return set;
  }, [signers, customFields]);

  const unknownTokens = useMemo(() => {
    return extractTokens(value || '')
      .filter(t => !knownNameSet.has(t) && !SIGNER_TOKEN_RE.test(t));
  }, [value, knownNameSet]);

  const insertToken = (token: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent(token + ' ').run();
  };

  const handleAddCustomField = async (payload: CustomFieldFormPayload) => {
    try {
      await api.post('/hr-custom-fields', payload);
      toast.success('Custom field added', `{{${payload.name}}} is now available.`);
      setInlineModalOpen(false);
      setInlinePrefill('');
      loadCustomFields();
    } catch (err: any) {
      const msg = err?.response?.data?.message
        || err?.response?.data?.errors?.name?.[0]
        || 'Please try again.';
      toast.error('Could not add', msg);
    }
  };

  if (!editor) return <div style={{ padding: 16 }}>Loading editor…</div>;

  const btn = (active: boolean): React.CSSProperties => ({
    padding: '4px 9px', borderRadius: 6, border: '1px solid ' + (active ? '#6366f1' : '#e5e7eb'),
    background: active ? '#eef2ff' : '#fff', color: active ? '#4338ca' : '#374151',
    cursor: 'pointer', fontSize: 13, lineHeight: 1, fontWeight: 600,
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, minHeight: 480 }}>
      {/* Left sidebar — placeholder fields */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, background: '#fff', maxHeight: 560, overflowY: 'auto' }}>
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <i className="ri-search-line" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 13 }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search placeholders…"
            style={{ width: '100%', padding: '6px 8px 6px 26px', fontSize: 12.5, border: '1px solid #e5e7eb', borderRadius: 6 }}
          />
        </div>
        {filteredGroups.map(g => {
          const open = openGroups[g.id] !== false;
          return (
            <div key={g.id} style={{ marginBottom: 6 }}>
              <button
                type="button"
                onClick={() => setOpenGroups(s => ({ ...s, [g.id]: !open }))}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 6px', background: '#f9fafb', border: 0, borderRadius: 6, fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: '#6b7280', textTransform: 'uppercase', cursor: 'pointer' }}
              >
                <span>{g.label}</span>
                <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
              </button>
              {open && (
                <div style={{ paddingLeft: 4, marginTop: 4 }}>
                  {g.fields.length === 0 && g.id === 'custom' && (
                    <div style={{ fontSize: 11.5, color: '#9ca3af', padding: '4px 6px', fontStyle: 'italic' }}>
                      No custom fields yet — add one below.
                    </div>
                  )}
                  {g.fields.map(f => (
                    <button
                      key={f.token}
                      type="button"
                      onClick={() => insertToken(f.token)}
                      title={`Insert ${f.token}`}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '5px 6px', background: 'transparent', border: 0, borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#f3f4f6'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <span style={{ color: '#374151', textAlign: 'left' }}>{f.label}</span>
                      <span style={{ fontSize: 10.5, fontFamily: 'monospace', color: '#6366f1', background: '#eef2ff', padding: '1px 5px', borderRadius: 4, whiteSpace: 'nowrap' }}>{f.token}</span>
                    </button>
                  ))}
                  {g.id === 'custom' && (
                    <button
                      type="button"
                      onClick={() => { setInlinePrefill(''); setInlineModalOpen(true); }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 6, padding: '6px 6px', background: '#fafaff', border: '1px dashed #c7d2fe', borderRadius: 6, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: '#4338ca' }}
                    >
                      <i className="ri-add-line" /> Add Custom Field
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Right — editor + toolbar */}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {unknownTokens.length > 0 && (
          <div style={{ marginBottom: 8, padding: '8px 12px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a', display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
            <i className="ri-error-warning-line" style={{ fontSize: 16, color: '#b45309', marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>
                {unknownTokens.length} unknown placeholder{unknownTokens.length === 1 ? '' : 's'} in this template
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {unknownTokens.map(tok => (
                  <button
                    key={tok}
                    type="button"
                    title={`Register {{${tok}}} as a custom field`}
                    onClick={() => { setInlinePrefill(tok); setInlineModalOpen(true); }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, border: '1px solid #fcd34d', background: '#fef3c7', cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: '#92400e', fontFamily: 'monospace' }}
                  >
                    <span>{`{{${tok}}}`}</span>
                    <i className="ri-add-circle-line" style={{ fontSize: 14 }} />
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#92400e', opacity: 0.85, marginTop: 4 }}>
                Click any token to register it as a Custom Field — it'll then prompt the user at generation time.
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: '10px 10px 0 0', background: '#fafafa' }}>
          <select
            value={editor.isActive('heading', { level: 1 }) ? 'h1'
                  : editor.isActive('heading', { level: 2 }) ? 'h2'
                  : editor.isActive('heading', { level: 3 }) ? 'h3'
                  : 'p'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'p')  editor.chain().focus().setParagraph().run();
              if (v === 'h1') editor.chain().focus().toggleHeading({ level: 1 }).run();
              if (v === 'h2') editor.chain().focus().toggleHeading({ level: 2 }).run();
              if (v === 'h3') editor.chain().focus().toggleHeading({ level: 3 }).run();
            }}
            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 13, background: '#fff' }}
          >
            <option value="p">Paragraph</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
          </select>

          <button type="button" style={btn(editor.isActive('bold'))}      onClick={() => editor.chain().focus().toggleBold().run()}      title="Bold"><b>B</b></button>
          <button type="button" style={btn(editor.isActive('italic'))}    onClick={() => editor.chain().focus().toggleItalic().run()}    title="Italic"><i>I</i></button>
          <button type="button" style={btn(editor.isActive('underline'))} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline"><u>U</u></button>

          <span style={{ width: 1, background: '#e5e7eb', margin: '0 4px' }} />

          <button type="button" style={btn(editor.isActive({ textAlign: 'left' }))}   onClick={() => editor.chain().focus().setTextAlign('left').run()}><i className="ri-align-left" /></button>
          <button type="button" style={btn(editor.isActive({ textAlign: 'center' }))} onClick={() => editor.chain().focus().setTextAlign('center').run()}><i className="ri-align-center" /></button>
          <button type="button" style={btn(editor.isActive({ textAlign: 'right' }))}  onClick={() => editor.chain().focus().setTextAlign('right').run()}><i className="ri-align-right" /></button>

          <span style={{ width: 1, background: '#e5e7eb', margin: '0 4px' }} />

          <button type="button" style={btn(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()}><i className="ri-list-unordered" /></button>
          <button type="button" style={btn(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()}><i className="ri-list-ordered" /></button>

          <span style={{ width: 1, background: '#e5e7eb', margin: '0 4px' }} />

          <button type="button" style={btn(false)} onClick={() => editor.chain().focus().undo().run()}><i className="ri-arrow-go-back-line" /></button>
          <button type="button" style={btn(false)} onClick={() => editor.chain().focus().redo().run()}><i className="ri-arrow-go-forward-line" /></button>
        </div>

        <div
          className="tpl-editor-surface"
          style={{ border: '1px solid #e5e7eb', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '14px 18px', background: '#fff', minHeight: 360, maxHeight: 560, overflowY: 'auto' }}
        >
          <EditorContent editor={editor} />
        </div>

        <style>{`
          .tpl-editor-surface .ProseMirror { outline: none; min-height: 320px; font-size: 14px; line-height: 1.6; }
          .tpl-editor-surface .ProseMirror p { margin: 0 0 8px 0; }
          .tpl-editor-surface .ProseMirror p.is-editor-empty:first-child::before {
            content: 'Start typing your template here…';
            color: #9ca3af; pointer-events: none; height: 0; float: left;
          }
        `}</style>
      </div>

      {inlineModalOpen && (
        <CustomFieldModal
          initial={null}
          prefillName={inlinePrefill}
          onClose={() => { setInlineModalOpen(false); setInlinePrefill(''); }}
          onSave={handleAddCustomField}
        />
      )}
    </div>
  );
}
