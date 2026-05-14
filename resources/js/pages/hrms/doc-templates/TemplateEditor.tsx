import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { useEffect, useMemo, useRef, useState } from 'react';

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

// Build per-signer placeholder rows from the workflow configured in step 2.
// Mirrors the right-hand "REQUIRED SIGNER VARIABLES" panel from the screenshot.
// Designation token is intentionally omitted — the wizard no longer captures
// a designation per signer (role + action + days are the only inputs).
export function buildSignerGroup(signers: SignerLite[]): PlaceholderGroup {
  const fields: PlaceholderField[] = [];
  signers.forEach((s, i) => {
    const n = i + 1;
    const roleLabel = s.role_name ? ` (${s.role_name})` : '';
    fields.push({ label: `Signer ${n} Name${roleLabel}`, token: `{{Signer${n}Name}}` });
    fields.push({ label: `Signer ${n} Date`,             token: `{{Signer${n}Date}}` });
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
  const [search, setSearch] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ basic: true, signers: true });

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
      // Tiptap v3: second arg is options; `emitUpdate: false` suppresses the
      // onUpdate callback so this hydration doesn't bounce back through onChange.
      editor.commands.setContent(value || '<p></p>', { emitUpdate: false });
      lastSyncedRef.current = value;
    }
  }, [value, editor]);

  const groups = useMemo<PlaceholderGroup[]>(() => {
    const signerGroup = buildSignerGroup(signers);
    return [...STATIC_PLACEHOLDER_GROUPS, signerGroup];
  }, [signers]);

  const filteredGroups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map(g => ({ ...g, fields: g.fields.filter(f => f.label.toLowerCase().includes(needle) || f.token.toLowerCase().includes(needle)) }))
      .filter(g => g.fields.length > 0);
  }, [groups, search]);

  const insertToken = (token: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent(token + ' ').run();
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
                      <span style={{ color: '#374151' }}>{f.label}</span>
                      <span style={{ fontSize: 10.5, fontFamily: 'monospace', color: '#6366f1', background: '#eef2ff', padding: '1px 5px', borderRadius: 4 }}>{f.token}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Right — editor + toolbar */}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
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
    </div>
  );
}
