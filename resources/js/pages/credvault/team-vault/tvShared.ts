import type { Loose } from '../cvApi';
import { initials } from '../shared';

/* Team Vault — levels, department icons and the hierarchy tree built from the API's flat member list. */

export type Level = 'admin' | 'hod' | 'tl' | 'exec' | 'emp' | 'intern';
export const LV_ORDER: Level[] = ['admin', 'hod', 'tl', 'exec', 'emp', 'intern'];
/** The prototype's short labels (TV_LV[l][0]). */
export const LV_SHORT: Record<Level, string> = { admin: 'Admin', hod: 'HOD', tl: 'TL', exec: 'Executive', emp: 'Employee', intern: 'Intern' };

export type LevelCounts = Partial<Record<Level, number>>;

export const TV_IC = {
  team: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  cred: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17c.6-1.8 2-2.8 3.5-2.8s2.9 1 3.5 2.8"/><line x1="15" y1="10" x2="18" y2="10"/><line x1="15" y1="14" x2="18" y2="14"/>',
  perm: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1.2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
  shieldPlain: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  audit: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  arrow: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  people: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
  chevLeft: '<polyline points="15 18 9 12 15 6"/>',
  chevRight: '<polyline points="9 18 15 12 9 6"/>',
  chevDown: '<polyline points="6 9 12 15 18 9"/>',
  tree: '<path d="M12 3v6M12 9H6v6M12 9h6v6M6 15v3M18 15v3"/>',
  expand: '<polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/>',
  collapse: '<polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  noAccess: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="11" x2="23" y2="11"/>',
};

const DEPT_ICO = {
  it: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  sales: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  hr: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
  pp: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  log: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  dm: '<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  acc: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="8" y2="10"/><line x1="12" y1="10" x2="12" y2="10"/><line x1="16" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="8" y2="14"/><line x1="12" y1="14" x2="12" y2="14"/><line x1="16" y1="14" x2="16" y2="18"/><line x1="8" y1="18" x2="12" y2="18"/>',
  ga: '<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/><line x1="9" y1="10" x2="9" y2="10"/><line x1="15" y1="10" x2="15" y2="10"/>',
};

/** The prototype keyed its icons by department; real departments are matched by name. */
export function deptIcon(name?: string | null): string {
  const n = String(name ?? '').toLowerCase();
  if (/\b(it|tech|software|develop|engineer)/.test(n)) return DEPT_ICO.it;
  if (/sales|business dev/.test(n)) return DEPT_ICO.sales;
  if (/\bhr\b|human|people|talent/.test(n)) return DEPT_ICO.hr;
  if (/purchase|procure|sourcing/.test(n)) return DEPT_ICO.pp;
  if (/logistic|warehouse|dispatch|supply|shipping/.test(n)) return DEPT_ICO.log;
  if (/market|digital|brand/.test(n)) return DEPT_ICO.dm;
  if (/account|finance|tax|gst/.test(n)) return DEPT_ICO.acc;
  return DEPT_ICO.ga;
}

/** levels[] ({level,count}) → { level: count }. */
export function toCounts(levels?: Loose[] | null): LevelCounts {
  const c: LevelCounts = {};
  (levels ?? []).forEach(l => { if (LV_ORDER.includes(l.level)) c[l.level as Level] = Number(l.count) || 0; });
  return c;
}

export interface TreeNode {
  id: string;
  employeeId: number | null;      // null for the admin root
  name: string;
  initials: string;
  desig: string;
  lv: Level;
  kids: TreeNode[];
}

export interface Hierarchy {
  root: TreeNode;
  all: TreeNode[];
  cnt: LevelCounts;
  total: number;
}

/**
 * Members come flat with manager_employee_id; a member whose manager is
 * outside the set is a root. As in the prototype, the Vault Administrator sits
 * on top. Anyone a reporting-line loop would hide is lifted to a root.
 */
export function buildHierarchy(members: Loose[], admin: { name: string; desig: string }): Hierarchy {
  const nodes = new Map<number, TreeNode>();
  members.forEach(m => nodes.set(m.employee_id, {
    id: `e${m.employee_id}`, employeeId: m.employee_id, name: m.name || '—', initials: m.initials || initials(m.name),
    desig: m.designation || m.level_label || '', lv: (LV_ORDER.includes(m.level) ? m.level : 'emp') as Level, kids: [],
  }));
  const roots: TreeNode[] = [];
  members.forEach(m => {
    const n = nodes.get(m.employee_id)!;
    const p = m.manager_employee_id != null && m.manager_employee_id !== m.employee_id ? nodes.get(m.manager_employee_id) : undefined;
    (p ? p.kids : roots).push(n);
  });
  const seen = new Set<string>();
  const mark = (n: TreeNode) => { if (seen.has(n.id)) return; seen.add(n.id); n.kids.forEach(mark); };
  roots.forEach(mark);
  nodes.forEach(n => {
    if (seen.has(n.id)) return;
    nodes.forEach(p => { p.kids = p.kids.filter(k => k !== n); });
    roots.push(n); mark(n);
  });
  const order = (a: TreeNode, b: TreeNode) => LV_ORDER.indexOf(a.lv) - LV_ORDER.indexOf(b.lv) || a.name.localeCompare(b.name);
  const sortDeep = (list: TreeNode[]) => { list.sort(order); list.forEach(k => sortDeep(k.kids)); };
  sortDeep(roots);

  const root: TreeNode = { id: 'adm', employeeId: null, name: admin.name, initials: initials(admin.name), desig: admin.desig, lv: 'admin', kids: roots };
  const all: TreeNode[] = [];
  const cnt: LevelCounts = {};
  const walk = (x: TreeNode) => { cnt[x.lv] = (cnt[x.lv] ?? 0) + 1; all.push(x); x.kids.forEach(walk); };
  walk(root);
  return { root, all, cnt, total: all.length };
}
