import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import '../../css/documentation.css';

/* ────────────────────────────────────────────────────────────────────────────
 * Documentation Guide.
 *
 * Reads every module's markdown sheets under docs/ (served by DocsGuideController),
 * grouped by module in the sidebar, with doc-type tabs and an in-place edit mode
 * that saves straight back to the source file. Open to every role — this is
 * reference material, not tenant data, so there's no scoping here.
 * ──────────────────────────────────────────────────────────────────────────── */

type DocType = 'functional' | 'technical' | 'api' | 'walkthrough';

interface DocItem {
  path: string;   // e.g. "hrms/leave" or "masters/company"
  title: string;
  types: DocType[];
}

interface DocGroup {
  key: string;
  label: string;
  items: DocItem[];
}

interface DocIndex {
  groups: DocGroup[];
  types: Record<DocType, string>;
}

interface DocContent {
  path: string;
  type: DocType;
  label: string;
  content: string;
}

const TYPE_ORDER: DocType[] = ['functional', 'technical', 'api', 'walkthrough'];
const orderedTypes = (types: DocType[]) => TYPE_ORDER.filter(t => types.includes(t));

/* ── Minimal, dependency-free markdown renderer ─────────────────────────────
 * The repo ships no markdown lib, so this handles just what the docs use:
 * headings, GFM tables, fenced code, blockquotes, hr, lists and inline marks.
 * It builds React nodes directly (no dangerouslySetInnerHTML) so content stays
 * inert regardless of what a doc file contains. */

let keySeq = 0;
const k = () => `md-${keySeq++}`;

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('`')) {
      nodes.push(<code key={k()} className="doc-inline-code">{token.slice(1, -1)}</code>);
    } else if (token.startsWith('[')) {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
      if (lm) {
        nodes.push(
          <a key={k()} href={lm[2]} target="_blank" rel="noopener noreferrer" className="doc-link">
            {lm[1]}
          </a>,
        );
      }
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={k()}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={k()}>{token.slice(1, -1)}</em>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  const isTableSep = (s: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(s) && s.includes('-');
  const splitRow = (s: string) =>
    s.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }

    // Fenced code block
    if (/^```/.test(line.trim())) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
      i++;
      blocks.push(<pre key={k()} className="doc-code"><code>{buf.join('\n')}</code></pre>);
      continue;
    }

    // Horizontal rule
    if (/^(\s*[-*_]){3,}\s*$/.test(line) && !line.includes('|')) {
      blocks.push(<hr key={k()} className="doc-hr" />);
      i++;
      continue;
    }

    // Heading
    const hm = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hm) {
      const level = Math.min(hm[1].length, 6);
      const inner = renderInline(hm[2]);
      const cls = `doc-h doc-h${level}`;
      const key = k();
      blocks.push(
        level === 1 ? <h1 key={key} className={cls}>{inner}</h1> :
        level === 2 ? <h2 key={key} className={cls}>{inner}</h2> :
        level === 3 ? <h3 key={key} className={cls}>{inner}</h3> :
        level === 4 ? <h4 key={key} className={cls}>{inner}</h4> :
        level === 5 ? <h5 key={key} className={cls}>{inner}</h5> :
                      <h6 key={key} className={cls}>{inner}</h6>,
      );
      i++;
      continue;
    }

    // Blockquote
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push(<blockquote key={k()} className="doc-quote">{renderInline(buf.join(' '))}</blockquote>);
      continue;
    }

    // Table
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={k()} className="doc-table-wrap">
          <table className="doc-table">
            <thead><tr>{header.map((c, ci) => <th key={ci}>{renderInline(c)}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => <td key={ci}>{renderInline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      blocks.push(<ul key={k()} className="doc-list">{buf.map((it, li) => <li key={li}>{renderInline(it)}</li>)}</ul>);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push(<ol key={k()} className="doc-list">{buf.map((it, li) => <li key={li}>{renderInline(it)}</li>)}</ol>);
      continue;
    }

    // Paragraph
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i].trim()) &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) blocks.push(<p key={k()} className="doc-p">{renderInline(para.join(' '))}</p>);
  }

  return <>{blocks}</>;
}

/* ── Icons ──────────────────────────────────────────────────────────────── */
const IcSearch = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const IcBook = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);
const IcDoc = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);
const IcChevron = ({ open }: { open: boolean }) => (
  <svg className={`doc-grp-chev ${open ? 'open' : ''}`} width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const IcEdit = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

export default function Documentation() {
  const toast = useToast();
  const [index, setIndex] = useState<DocIndex | null>(null);
  const [loadingIndex, setLoadingIndex] = useState(true);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [activePath, setActivePath] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<DocType | null>(null);
  const [doc, setDoc] = useState<DocContent | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Load index once.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get<DocIndex>('/docs-guide');
        if (!alive) return;
        setIndex(data);
        const first = data.groups?.[0]?.items?.[0];
        if (first) {
          setActivePath(first.path);
          setActiveType(orderedTypes(first.types)[0] ?? null);
        }
        // Collapse every group except the first by default.
        const c: Record<string, boolean> = {};
        data.groups.forEach((g, gi) => { c[g.key] = gi !== 0; });
        setCollapsed(c);
      } catch {
        if (alive) toast?.error?.('Could not load the documentation index.');
      } finally {
        if (alive) setLoadingIndex(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Load the selected doc.
  useEffect(() => {
    if (!activePath || !activeType) { setDoc(null); return; }
    let alive = true;
    setLoadingDoc(true);
    setEditing(false);
    (async () => {
      try {
        const { data } = await api.get<DocContent>('/docs-guide/content', {
          params: { path: activePath, type: activeType },
        });
        if (!alive) return;
        setDoc(data);
        contentRef.current?.scrollTo({ top: 0 });
      } catch {
        if (alive) { setDoc(null); toast?.error?.('Could not load this document.'); }
      } finally {
        if (alive) setLoadingDoc(false);
      }
    })();
    return () => { alive = false; };
  }, [activePath, activeType]);

  const allItems = useMemo(
    () => index?.groups?.flatMap(g => g.items) ?? [],
    [index],
  );
  const activeItem = useMemo(
    () => allItems.find(it => it.path === activePath) ?? null,
    [allItems, activePath],
  );

  // Filter groups/items by search; when searching, force groups open.
  const visibleGroups = useMemo(() => {
    if (!index?.groups) return [];
    const q = search.trim().toLowerCase();
    if (!q) return index.groups;
    return index.groups
      .map(g => ({
        ...g,
        items: g.items.filter(
          it => it.title.toLowerCase().includes(q) || it.path.toLowerCase().includes(q) ||
            g.label.toLowerCase().includes(q),
        ),
      }))
      .filter(g => g.items.length > 0);
  }, [index, search]);

  const searching = search.trim() !== '';

  function selectItem(item: DocItem) {
    setActivePath(item.path);
    setActiveType(prev => (prev && item.types.includes(prev) ? prev : orderedTypes(item.types)[0] ?? null));
    setNavOpen(false);
  }

  function beginEdit() {
    if (!doc) return;
    setDraft(doc.content);
    setEditing(true);
  }

  async function saveEdit() {
    if (!doc || !activePath || !activeType) return;
    setSaving(true);
    try {
      await api.put('/docs-guide/content', { path: activePath, type: activeType, content: draft });
      setDoc({ ...doc, content: draft });
      setEditing(false);
      toast?.success?.('Documentation saved.');
    } catch {
      toast?.error?.('Could not save the document.');
    } finally {
      setSaving(false);
    }
  }

  const tabs = activeItem ? orderedTypes(activeItem.types) : [];
  const pageRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = pageRef.current;
    if (!el) return;

    /* Find the real scroll container by walking up for the first ancestor that
     * actually scrolls. The app ships two shells and they don't agree on markup:
     * AppLayout scrolls a <main>, while the Velzon horizontal layout scrolls a
     * plain <div class="main-content">. Matching on the tag name only worked in
     * one of them — in the other this bailed out and the CSS fallback height
     * took over, which overflowed the container. */
    const findScrollHost = (start: HTMLElement): HTMLElement | null => {
      let node = start.parentElement;
      while (node && node !== document.body) {
        const oy = getComputedStyle(node).overflowY;
        if (oy === 'auto' || oy === 'scroll') return node;
        node = node.parentElement;
      }
      return null;
    };

    const host = findScrollHost(el);
    if (!host) return;   // nothing scrolls above us — keep the CSS fallback

    const apply = () => {
      const cs = getComputedStyle(host);
      // Distance from the host's padding-box top down to our own top, measured
      // as if unscrolled (hence + scrollTop). This absorbs whatever wrappers
      // and padding each shell puts in between, rather than hard-coding an
      // offset per layout.
      const offset = el.getBoundingClientRect().top
        - host.getBoundingClientRect().top
        - parseFloat(cs.borderTopWidth || '0')
        + host.scrollTop;
      // clientHeight spans the padding box, so drop the bottom padding to stay
      // inside it (AppLayout's <main> carries a pb-20).
      const avail = host.clientHeight - offset - parseFloat(cs.paddingBottom || '0');
      if (avail > 0) el.style.setProperty('--doc-avail-h', `${Math.round(avail)}px`);
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="doc-page" ref={pageRef}>
      <div className="doc-topbar">
        <button type="button" className="doc-nav-toggle" onClick={() => setNavOpen(o => !o)} aria-label="Toggle list">
          <IcBook />
        </button>
        <div className="doc-topbar-title">
          <span className="doc-topbar-ico"><IcBook /></span>
          <div>
            <div className="doc-topbar-h">Documentation Guide</div>
            <div className="doc-topbar-sub">Module reference sheets — functional, technical, API &amp; code</div>
          </div>
        </div>
      </div>

      <div className="doc-body">
        {/* ── Sidebar ── */}
        <aside className={`doc-sidebar ${navOpen ? 'open' : ''}`}>
          <div className="doc-search">
            <IcSearch />
            <input
              type="text"
              placeholder="Search all docs…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="doc-master-list">
            {loadingIndex && <div className="doc-side-msg">Loading…</div>}
            {!loadingIndex && visibleGroups.length === 0 && (
              <div className="doc-side-msg">No docs match “{search}”.</div>
            )}
            {visibleGroups.map(group => {
              const open = searching || !collapsed[group.key];
              return (
                <div key={group.key} className="doc-group">
                  <button
                    type="button"
                    className="doc-group-head"
                    onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}
                    aria-expanded={open}
                  >
                    <IcChevron open={open} />
                    <span className="doc-group-label">{group.label}</span>
                    <span className="doc-group-count">{group.items.length}</span>
                  </button>
                  {open && (
                    <div className="doc-group-items">
                      {group.items.map(item => (
                        <button
                          key={item.path}
                          type="button"
                          className={`doc-master-item ${item.path === activePath ? 'active' : ''}`}
                          onClick={() => selectItem(item)}
                        >
                          <span className="doc-master-ico"><IcDoc /></span>
                          <span className="doc-master-name">{item.title}</span>
                          <span className="doc-master-count">{item.types.length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {index && (
            <div className="doc-side-footer">
              {allItems.length} document{allItems.length === 1 ? '' : 's'} across {index.groups?.length ?? 0} modules
            </div>
          )}
        </aside>

        {navOpen && <div className="doc-scrim" onClick={() => setNavOpen(false)} />}

        {/* ── Main ── */}
        <main className="doc-main">
          {activeItem && (
            <div className="doc-doc-head">
              <div className="doc-doc-head-row">
                <h1 className="doc-doc-title">{activeItem.title}</h1>
                {doc && !editing && (
                  <button type="button" className="doc-edit-btn" onClick={beginEdit}>
                    <IcEdit /> Edit
                  </button>
                )}
                {editing && (
                  <div className="doc-edit-actions">
                    <button type="button" className="doc-btn-ghost" onClick={() => setEditing(false)} disabled={saving}>
                      Cancel
                    </button>
                    <button type="button" className="doc-btn-primary" onClick={saveEdit} disabled={saving}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                )}
              </div>
              <div className="doc-tabs">
                {tabs.map(t => (
                  <button
                    key={t}
                    type="button"
                    className={`doc-tab ${t === activeType ? 'active' : ''}`}
                    onClick={() => setActiveType(t)}
                    disabled={editing}
                  >
                    {index?.types[t] ?? t}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="doc-sheet-wrap" ref={contentRef}>
            {loadingDoc && <div className="doc-loading">Loading document…</div>}
            {!loadingDoc && !doc && !loadingIndex && (
              <div className="doc-empty">
                <IcBook />
                <p>Select a document from the list to read it.</p>
              </div>
            )}
            {!loadingDoc && doc && editing && (
              <div className="doc-editor">
                <div className="doc-editor-hint">Editing markdown — changes save to the source file.</div>
                <textarea
                  className="doc-editor-area"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  spellCheck={false}
                />
              </div>
            )}
            {!loadingDoc && doc && !editing && (
              <article className="doc-sheet">
                <Markdown source={doc.content} />
              </article>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
