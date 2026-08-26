import { useEditor, EditorContent } from '@tiptap/react';
import { Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import CustomFieldModal, { CustomFieldFormPayload } from './CustomFieldModal';
import Tooltip from '../../../components/ui/Tooltip';

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
    /* CTC is the ANNUAL figure on the employee record; Basic and HRA are the
       MONTHLY components off the active salary structure. Labelled so an
       author doesn't put all three in one column and imply they share a
       period. */
    { label: 'CTC (annual)',   token: '{{CTC}}' },
    { label: 'Basic (monthly)',token: '{{Basic}}' },
    { label: 'HRA (monthly)',  token: '{{HRA}}' },
  ]},
  { id: 'org', label: 'Organization', fields: [
    { label: 'Company Name',   token: '{{CompanyName}}' },
    { label: 'Company Address',token: '{{CompanyAddress}}' },
    /* Logo — {{CompanyLogo}} — is deliberately NOT offered here.
       The letterhead is set through the header zone (Edit Header) on the
       preview above, which is where authors expect to manage it and which
       controls placement and sizing; a second route to the same image in the
       body only duplicated it.
       HIDDEN, NOT REMOVED: the token still resolves everywhere it is used —
       preview, PDF, DOCX and the frozen signature copy — so the templates that
       already contain it keep rendering their logo. Deleting the resolver
       would blank the letterhead on every one of them. Restore this line to
       offer it again. */
  ]},
];

export type SignerLite = {
  role_name?: string | null;
  designation_name?: string | null;
  // Carries the wizard's action ("Sign" | "Approve" | "Review & Acknowledge").
  // The placeholder builder uses this to decide whether to emit a
  // {{SignerNSign}} token — signatures only make sense for Sign signers.
  action?: string | null;
};

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
// Designation token is intentionally omitted — the wizard no longer captures
// a designation per signer (role + action + days are the only inputs).
export function buildSignerGroup(signers: SignerLite[]): PlaceholderGroup {
  const fields: PlaceholderField[] = [];
  signers.forEach((s, i) => {
    // Only Sign signers leave a footprint in the template body — Approve and
    // Review & Acknowledge signers just view the doc and click their action,
    // so surfacing Name / Date / Signature for them would be misleading
    // (those tokens would never get filled in).
    const action = (s.action || 'Sign').toString().toLowerCase();
    if (action !== 'sign') return;
    const n = i + 1;
    const roleLabel = s.role_name ? ` (${s.role_name})` : '';
    fields.push({ label: `Signer ${n} Name${roleLabel}`, token: `{{Signer${n}Name}}` });
    fields.push({ label: `Signer ${n} Date`,             token: `{{Signer${n}Date}}` });
    fields.push({ label: `Signer ${n} Signature`,        token: `{{Signer${n}Sign}}` });
  });
  return { id: 'signers', label: 'Workflow Signers', fields };
}

// ── Editor ───────────────────────────────────────────────────────────────────
/**
 * An explicit page break.
 *
 * Serialises to `<div class="page-break" data-page-break="true"></div>` — the
 * exact element the CLM editor emits, so both document engines recognise one
 * shape: `pdf/signed-document.blade.php` turns it into `page-break-after:
 * always`, and HrTemplateDocxRenderer rewrites it into a real Word page break
 * (PhpWord's HTML reader has no `div` node, so it has to become a styled `<p>`
 * before it reaches PhpWord).
 *
 * Being a plain div means older drafts round-trip untouched and the stored
 * contract (content_html = HTML string) is unchanged.
 */
const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,          // one indivisible thing — no cursor inside it
  selectable: true,
  parseHTML() {
    return [{ tag: 'div.page-break' }, { tag: 'div[data-page-break]' }];
  },
  renderHTML() {
    // Class AND data attribute: a sanitiser can drop one, the other still
    // carries the instruction to the PDF/DOCX side.
    return ['div', { class: 'page-break', 'data-page-break': 'true' }];
  },
  addCommands() {
    return {
      setPageBreak: () => ({ chain }: any) =>
        // Insert the break AND a paragraph after it — an atom at the end of the
        // document leaves nowhere to put the caret.
        chain().insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }]).run(),
    } as any;
  },
});

export default function TemplateEditor({
  value,
  onChange,
  signers,
  tokenPreviews,
}: {
  value: string;
  onChange: (html: string) => void;
  signers: SignerLite[];
  /* What a token will actually print, keyed by token ('{{CompanyName}}').
     Only the organisation tokens have one today — they resolve off the
     logged-in user's branch, and seeing the real name/address before
     inserting is the difference between trusting the placeholder and
     hard-typing the company name into the body. */
  tokenPreviews?: Record<string, string>;
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
      PageBreak,
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
      // Tiptap v3: second arg is options; `emitUpdate: false` suppresses the
      // onUpdate callback so this hydration doesn't bounce back through onChange.
      editor.commands.setContent(value || '<p></p>', { emitUpdate: false });
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

  // Copy the raw {{Token}} to the clipboard so the user can paste it into a
  // Word doc, an email, or anywhere outside this editor. Falls back to a
  // hidden textarea on browsers that don't expose navigator.clipboard
  // (older Safari / non-secure contexts).
  const copyToken = async (token: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(token);
      } else {
        const ta = document.createElement('textarea');
        ta.value = token;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast.success('Copied', `${token} copied to clipboard.`);
    } catch {
      toast.error('Could not copy', 'Clipboard access was blocked — copy manually.');
    }
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
    /* One definite height for the row, not a min/max per column.
       The two sides used to size themselves: the sidebar grew to its field list
       (up to 560) while the editor sat at its 360 minimum, so an empty template
       showed a tall sidebar beside a short draft — and as you typed, the draft
       grew past it. Neither ever matched the other.
       With a fixed row height both columns are exactly as tall as the row and
       each scrolls its own overflow, so the pair never moves again. */
    <div
      className="tpl-editor-root"
      style={{
        display: 'grid',
        gridTemplateColumns: '240px 1fr',
        /* minmax(0, 1fr), NOT the implicit `auto` row.
           An auto row stretches UP to fill a definite container but never
           shrinks BELOW its content, so the row grew to the sidebar's full field
           list, the 620px container overflowed, and the sidebar's height:100%
           resolved to that same tall value — nothing overflowed it, so it never
           produced a scrollbar. minmax(0, 1fr) lets the row be clamped, which is
           what makes the panels scroll instead of the page.
           (Same family as the min-width:0 flex trap noted in DataTable.css.) */
        gridTemplateRows: 'minmax(0, 1fr)',
        gap: 16,
        /* Viewport-aware so a short window does not push the panels below the
           fold — their scrollbars are unreachable down there. */
        height: 'min(620px, calc(100vh - 220px))',
        minHeight: 380,
      }}
    >
      {/* Left sidebar — placeholder fields */}
      <div className="tpl-sidebar" style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, background: '#fff', height: '100%', overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <i className="ri-search-line tpl-search-icon" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 13 }} />
          <input
            type="text"
            className="tpl-search"
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
                className="tpl-group-header"
                onClick={() => setOpenGroups(s => ({ ...s, [g.id]: !open }))}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 6px', background: '#f9fafb', border: 0, borderRadius: 6, fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: '#6b7280', textTransform: 'uppercase', cursor: 'pointer' }}
              >
                <span>{g.label}</span>
                <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
              </button>
              {open && (
                <div style={{ paddingLeft: 4, marginTop: 4 }}>
                  {g.fields.length === 0 && g.id === 'custom' && (
                    <div className="tpl-empty" style={{ fontSize: 11.5, color: '#9ca3af', padding: '4px 6px', fontStyle: 'italic' }}>
                      No custom fields yet — add one below.
                    </div>
                  )}
                  {g.fields.map(f => (
                    <div key={f.token} className="tpl-token-row">
                      {/* Shared Tooltip, not the native `title`: these rows are
                          exactly where a name gets clipped, and a themed pill
                          that appears straight away beats the OS box that waits
                          a second and ignores dark mode. Carries the FULL label
                          and token, since both may be truncated on screen. */}
                      <Tooltip label={`${f.label} — ${f.token}${tokenPreviews?.[f.token] ? ` → ${tokenPreviews[f.token]}` : ''}`}>
                        <button
                          type="button"
                          className="tpl-token-btn"
                          onClick={() => insertToken(f.token)}
                        >
                          <span className="tpl-token-label">{f.label}</span>
                          <span className="tpl-token-pill">{f.token}</span>
                        </button>
                      </Tooltip>
                      <Tooltip label={`Copy ${f.token}`}>
                        <button
                          type="button"
                          className="tpl-token-copy"
                          onClick={() => copyToken(f.token)}
                          aria-label={`Copy ${f.token}`}
                        >
                          <i className="ri-file-copy-line" />
                        </button>
                      </Tooltip>
                    </div>
                  ))}
                  {g.id === 'custom' && (
                    <button
                      type="button"
                      className="tpl-add-cf"
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
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%' }}>
        {unknownTokens.length > 0 && (
          <div className="tpl-unknown-banner" style={{ marginBottom: 8, padding: '8px 12px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a', display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
            <i className="ri-error-warning-line tpl-unknown-icon" style={{ fontSize: 16, color: '#b45309', marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="tpl-unknown-title" style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>
                {unknownTokens.length} unknown placeholder{unknownTokens.length === 1 ? '' : 's'} in this template
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {unknownTokens.map(tok => (
                  <Tooltip key={tok} label={`Register {{${tok}}} as a custom field`}>
                  <button
                    type="button"
                    className="tpl-unknown-chip"
                    onClick={() => { setInlinePrefill(tok); setInlineModalOpen(true); }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, border: '1px solid #fcd34d', background: '#fef3c7', cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: '#92400e', fontFamily: 'monospace' }}
                  >
                    <span>{`{{${tok}}}`}</span>
                    <i className="ri-add-circle-line" style={{ fontSize: 14 }} />
                  </button>
                  </Tooltip>
                ))}
              </div>
              <div className="tpl-unknown-hint" style={{ fontSize: 11, color: '#92400e', opacity: 0.85, marginTop: 4 }}>
                Click any token to register it as a Custom Field — it'll then prompt the user at generation time.
              </div>
            </div>
          </div>
        )}

        <div className="tpl-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: '10px 10px 0 0', background: '#fafafa' }}>
          <select
            className="tpl-toolbar-select"
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

          <span className="tpl-toolbar-divider" style={{ width: 1, background: '#e5e7eb', margin: '0 4px' }} />

          <button type="button" style={btn(editor.isActive({ textAlign: 'left' }))}   onClick={() => editor.chain().focus().setTextAlign('left').run()}><i className="ri-align-left" /></button>
          <button type="button" style={btn(editor.isActive({ textAlign: 'center' }))} onClick={() => editor.chain().focus().setTextAlign('center').run()}><i className="ri-align-center" /></button>
          <button type="button" style={btn(editor.isActive({ textAlign: 'right' }))}  onClick={() => editor.chain().focus().setTextAlign('right').run()}><i className="ri-align-right" /></button>

          <span className="tpl-toolbar-divider" style={{ width: 1, background: '#e5e7eb', margin: '0 4px' }} />

          <button type="button" style={btn(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()}><i className="ri-list-unordered" /></button>
          <button type="button" style={btn(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()}><i className="ri-list-ordered" /></button>

          <span className="tpl-toolbar-divider" style={{ width: 1, background: '#e5e7eb', margin: '0 4px' }} />

          <button
            type="button"
            style={{ ...btn(editor.isActive('pageBreak')), display: 'inline-flex', alignItems: 'center', gap: 5 }}
            title="Insert a page break — the PDF and the Word copy both start a new page from here"
            onClick={() => (editor.chain().focus() as any).setPageBreak().run()}
          >
            <i className="ri-page-separator" />
            <span style={{ fontSize: 12 }}>Page Break</span>
          </button>

          <span className="tpl-toolbar-divider" style={{ width: 1, background: '#e5e7eb', margin: '0 4px' }} />

          <button type="button" style={btn(false)} onClick={() => editor.chain().focus().undo().run()}><i className="ri-arrow-go-back-line" /></button>
          <button type="button" style={btn(false)} onClick={() => editor.chain().focus().redo().run()}><i className="ri-arrow-go-forward-line" /></button>
        </div>

        <div
          className="tpl-editor-surface"
          /* flex:1 + minHeight:0 — the surface takes whatever the toolbar (and
             the unknown-token banner, when it shows) leaves, so the column ends
             flush with the sidebar however tall those are. A minHeight would
             re-introduce the mismatch the moment the banner appeared. */
          style={{ border: '1px solid #e5e7eb', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '14px 18px', background: '#fff', flex: 1, minHeight: 0, overflowY: 'auto' }}
        >
          <EditorContent editor={editor} />
        </div>

        <style>{`
          /* ── Light-mode base ────────────────────────────────────────────── */
          /* No min-height: the surface is flex-sized now, and a 320px floor inside it
             just added a second scrollbar on short screens. 100% keeps the click
             target the full height so clicking empty space still focuses. */
          .tpl-editor-surface .ProseMirror { outline: none; min-height: 100%; font-size: 14px; line-height: 1.6; }
          .tpl-editor-surface .ProseMirror p { margin: 0 0 8px 0; }
          /* Page break — invisible in the output, a labelled dashed rule here so
             the author can see where the next page starts. */
          .tpl-editor-surface .ProseMirror div.page-break {
            position: relative; height: 0; margin: 18px 0 26px;
            border-top: 2px dashed #a5b4fc;
          }
          .tpl-editor-surface .ProseMirror div.page-break::after {
            content: 'Page break';
            position: absolute; top: -9px; left: 50%; transform: translateX(-50%);
            background: #eef2ff; color: #4338ca;
            font-size: 9.5px; font-weight: 800; letter-spacing: .04em;
            padding: 1px 8px; border-radius: 999px; border: 1px solid #c7d2fe;
          }
          .tpl-editor-surface .ProseMirror div.page-break.ProseMirror-selectednode { border-top-color: #6d28d9; }
          .tpl-editor-surface .ProseMirror p.is-editor-empty:first-child::before {
            content: 'Start typing your template here…';
            color: #9ca3af; pointer-events: none; height: 0; float: left;
          }

          /* Token row — split into an insert-button + a small copy action.
             The insert button takes the full remaining width so clicking the
             label area still drops the token at the cursor; the copy icon
             stays subtle until hovered. */
          .tpl-editor-root .tpl-token-row {
            display: flex; align-items: stretch; gap: 4px;
            border-radius: 6px;
          }
          .tpl-editor-root .tpl-token-row:hover .tpl-token-copy { opacity: 1; }
          .tpl-editor-root .tpl-token-btn {
            flex: 1 1 auto; min-width: 0;
            display: flex; align-items: center; justify-content: space-between;
            gap: 8px; padding: 5px 6px;
            background: transparent; border: 0; border-radius: 6px;
            cursor: pointer; font-size: 12px;
            transition: background 120ms ease;
          }
          .tpl-editor-root .tpl-token-btn:hover { background: #f3f4f6; }
          /* The label gives way first: it is prose and reads fine clipped, while
             the token is what you came to copy. */
          .tpl-editor-root .tpl-token-label {
            flex: 1 1 auto; min-width: 0;
            color: #374151; text-align: left;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          }
          /* flex-shrink was 0 here, so a long custom-field token (users name
             these anything) could not be clipped — it pushed straight through
             the sidebar's right edge and put a horizontal scrollbar under the
             whole panel. It may shrink now, but only after the label has, and
             never below 40% of the row so it stays readable. Full token is on
             the row's tooltip either way. */
          .tpl-editor-root .tpl-token-pill {
            font-size: 10.5px; font-family: monospace;
            color: #6366f1; background: #eef2ff;
            padding: 1px 5px; border-radius: 4px; white-space: nowrap;
            flex: 0 1 auto; min-width: 40%;
            overflow: hidden; text-overflow: ellipsis;
          }
          .tpl-editor-root .tpl-token-copy {
            width: 26px; flex-shrink: 0;
            display: inline-flex; align-items: center; justify-content: center;
            background: transparent; border: 0; border-radius: 6px;
            color: #6366f1; font-size: 13px;
            cursor: pointer;
            opacity: 0.45;
            transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
          }
          .tpl-editor-root .tpl-token-copy:hover {
            background: #eef2ff; color: #4338ca; opacity: 1;
          }

          /* Sidebar interaction polish (light) */
          .tpl-editor-root .tpl-add-cf:hover { background: #f5f3ff !important; border-color: #a5b4fc !important; }

          /* ── Dark-mode parity ───────────────────────────────────────────── */
          [data-bs-theme="dark"] .tpl-editor-root .tpl-sidebar,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-sidebar {
            background: #1f2937 !important;
            border-color: rgba(255, 255, 255, 0.08) !important;
          }
          [data-bs-theme="dark"] .tpl-editor-root .tpl-search,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-search {
            background: #0f172a !important;
            border-color: rgba(255, 255, 255, 0.10) !important;
            color: #f1f5f9 !important;
          }
          [data-bs-theme="dark"] .tpl-editor-root .tpl-search::placeholder,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-search::placeholder { color: rgba(255, 255, 255, 0.40) !important; }
          [data-bs-theme="dark"] .tpl-editor-root .tpl-search-icon,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-search-icon { color: rgba(255, 255, 255, 0.55) !important; }

          [data-bs-theme="dark"] .tpl-editor-root .tpl-group-header,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-group-header {
            background: rgba(99, 102, 241, 0.10) !important;
            color: rgba(255, 255, 255, 0.65) !important;
          }
          [data-bs-theme="dark"] .tpl-editor-root .tpl-token-btn:hover,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-token-btn:hover {
            background: rgba(99, 102, 241, 0.12) !important;
          }
          [data-bs-theme="dark"] .tpl-editor-root .tpl-token-label,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-token-label { color: #e5e7eb !important; }
          [data-bs-theme="dark"] .tpl-editor-root .tpl-token-pill,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-token-pill {
            background: rgba(99, 102, 241, 0.20) !important;
            color: #c7d2fe !important;
          }
          [data-bs-theme="dark"] .tpl-editor-root .tpl-token-copy,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-token-copy {
            color: #a5b4fc !important;
          }
          [data-bs-theme="dark"] .tpl-editor-root .tpl-token-copy:hover,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-token-copy:hover {
            background: rgba(99, 102, 241, 0.20) !important;
            color: #e0e7ff !important;
          }
          [data-bs-theme="dark"] .tpl-editor-root .tpl-empty,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-empty { color: rgba(255, 255, 255, 0.45) !important; }

          [data-bs-theme="dark"] .tpl-editor-root .tpl-add-cf,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-add-cf {
            background: rgba(99, 102, 241, 0.10) !important;
            border-color: rgba(99, 102, 241, 0.45) !important;
            color: #c7d2fe !important;
          }
          [data-bs-theme="dark"] .tpl-editor-root .tpl-add-cf:hover,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-add-cf:hover {
            background: rgba(99, 102, 241, 0.20) !important;
          }

          /* Unknown-tokens banner — violet-tinted dark variant */
          [data-bs-theme="dark"] .tpl-editor-root .tpl-unknown-banner,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-unknown-banner {
            background: rgba(251, 191, 36, 0.10) !important;
            border-color: rgba(251, 191, 36, 0.35) !important;
          }
          [data-bs-theme="dark"] .tpl-editor-root .tpl-unknown-icon,
          [data-bs-theme="dark"] .tpl-editor-root .tpl-unknown-title,
          [data-bs-theme="dark"] .tpl-editor-root .tpl-unknown-hint,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-unknown-icon,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-unknown-title,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-unknown-hint { color: #fcd34d !important; }
          [data-bs-theme="dark"] .tpl-editor-root .tpl-unknown-chip,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-unknown-chip {
            background: rgba(251, 191, 36, 0.18) !important;
            border-color: rgba(251, 191, 36, 0.45) !important;
            color: #fde68a !important;
          }

          /* Toolbar shell + select */
          [data-bs-theme="dark"] .tpl-editor-root .tpl-toolbar,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-toolbar {
            background: #111827 !important;
            border-color: rgba(255, 255, 255, 0.08) !important;
          }
          [data-bs-theme="dark"] .tpl-editor-root .tpl-toolbar-divider,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-toolbar-divider {
            background: rgba(255, 255, 255, 0.10) !important;
          }
          [data-bs-theme="dark"] .tpl-editor-root .tpl-toolbar-select,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-toolbar-select {
            background: #1f2937 !important;
            border-color: rgba(255, 255, 255, 0.10) !important;
            color: #e5e7eb !important;
          }
          /* All toolbar buttons — both active and inactive variants */
          [data-bs-theme="dark"] .tpl-editor-root .tpl-toolbar button,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-toolbar button {
            background: #1f2937 !important;
            border-color: rgba(255, 255, 255, 0.10) !important;
            color: #e5e7eb !important;
          }
          [data-bs-theme="dark"] .tpl-editor-root .tpl-toolbar button:hover,
          [data-layout-mode="dark"] .tpl-editor-root .tpl-toolbar button:hover {
            background: rgba(99, 102, 241, 0.18) !important;
            border-color: rgba(99, 102, 241, 0.45) !important;
          }
          /* Active variant — keep the indigo signal, just darker */
          [data-bs-theme="dark"] .tpl-editor-root .tpl-toolbar button[style*="rgb(238, 242, 255)"],
          [data-bs-theme="dark"] .tpl-editor-root .tpl-toolbar button[style*="#eef2ff"],
          [data-layout-mode="dark"] .tpl-editor-root .tpl-toolbar button[style*="rgb(238, 242, 255)"],
          [data-layout-mode="dark"] .tpl-editor-root .tpl-toolbar button[style*="#eef2ff"] {
            background: rgba(99, 102, 241, 0.25) !important;
            border-color: #818cf8 !important;
            color: #c7d2fe !important;
          }

          /* Editor surface itself */
          [data-bs-theme="dark"] .tpl-editor-surface,
          [data-layout-mode="dark"] .tpl-editor-surface {
            background: #0f172a !important;
            border-color: rgba(255, 255, 255, 0.08) !important;
          }
          [data-bs-theme="dark"] .tpl-editor-surface .ProseMirror,
          [data-layout-mode="dark"] .tpl-editor-surface .ProseMirror { color: #e5e7eb; }
          [data-bs-theme="dark"] .tpl-editor-surface .ProseMirror p.is-editor-empty:first-child::before,
          [data-layout-mode="dark"] .tpl-editor-surface .ProseMirror p.is-editor-empty:first-child::before {
            color: rgba(255, 255, 255, 0.35);
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
