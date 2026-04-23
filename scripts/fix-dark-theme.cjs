/* eslint-disable */
// Applies consistent CSS-variable substitutions across in-app pages so they
// respect the Velzon dark/light theme. Only runs on files we explicitly list.
//
// Run: node scripts/fix-dark-theme.cjs

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = [
  'resources/js/pages/dashboard/AdminDashboard.tsx',
  'resources/js/pages/dashboard/ClientDashboard.tsx',
  'resources/js/pages/dashboard/BranchDashboard.tsx',
  'resources/js/pages/Permissions.tsx',
  'resources/js/pages/ClientView.tsx',
  'resources/js/pages/Plans.tsx',
  'resources/js/pages/AddPlan.tsx',
  'resources/js/pages/Profile.tsx',
  'resources/js/pages/Settings.tsx',
  'resources/js/pages/master/CompanyDetails.tsx',
];

// Ordered substitutions. Each: [regex, replacement, description]
// We keep colors inside gradients untouched by requiring `background: '#fff'` (not gradient contexts).
const SUBS = [
  // Card/container backgrounds
  [/background:\s*'#fff'/g, "background: 'var(--vz-card-bg)'", "card bg -> --vz-card-bg"],
  [/background:\s*'#ffffff'/g, "background: 'var(--vz-card-bg)'", "card bg -> --vz-card-bg"],

  // Borders using off-white greys (both standalone quoted and inside compound border-shorthand strings)
  [/'#f0f3f8'/g, "'var(--vz-border-color)'", "border #f0f3f8"],
  [/'#eef0f3'/g, "'var(--vz-border-color)'", "border #eef0f3"],
  [/'#e9ebef'/g, "'var(--vz-border-color)'", "border #e9ebef"],
  [/'#e2e8f0'/g, "'var(--vz-border-color)'", "border #e2e8f0"],
  // Compound shorthand: `border: '1px solid #f0f3f8'` etc. Rewrite to split borderWidth/Style/Color so
  // the color can use a CSS variable (compound strings can't contain var() cleanly in all browsers/versions).
  [/border(Top|Bottom|Left|Right)?:\s*'(\d+px)\s+(solid|dashed|dotted)\s+#(?:fff|eef0f3|f0f3f8|e9ebef|e2e8f0)'/g,
   "border$1: '$2 $3 var(--vz-border-color)'",
   "border-shorthand -> use --vz-border-color"],

  // Heading text (dark-on-light)
  [/color:\s*'#1e2a3a'/g, "color: 'var(--vz-heading-color, var(--vz-body-color))'", "heading #1e2a3a"],
  [/color:\s*'#1f2937'/g, "color: 'var(--vz-heading-color, var(--vz-body-color))'", "heading #1f2937"],
  [/color:\s*'#2d3a56'/g, "color: 'var(--vz-heading-color, var(--vz-body-color))'", "heading #2d3a56"],
  [/color:\s*'#0f172a'/g, "color: 'var(--vz-heading-color, var(--vz-body-color))'", "heading #0f172a"],

  // Muted secondary text
  [/color:\s*'#a0aec0'/g, "color: 'var(--vz-secondary-color)'", "muted #a0aec0"],
  [/color:\s*'#878a99'/g, "color: 'var(--vz-secondary-color)'", "muted #878a99"],
  [/color:\s*'#64748b'/g, "color: 'var(--vz-secondary-color)'", "muted #64748b"],

  // Light secondary backgrounds (icon chips, soft panels)
  [/background:\s*'#f4f6fb'/g, "background: 'var(--vz-secondary-bg)'", "soft bg #f4f6fb"],
  [/background:\s*'#f5f6f7'/g, "background: 'var(--vz-secondary-bg)'", "soft bg #f5f6f7"],
  [/background:\s*'#f8f9fa'/g, "background: 'var(--vz-secondary-bg)'", "soft bg #f8f9fa"],
  [/background:\s*'#f9fafb'/g, "background: 'var(--vz-secondary-bg)'", "soft bg #f9fafb"],
  [/background:\s*'#f1f5f9'/g, "background: 'var(--vz-secondary-bg)'", "soft bg #f1f5f9"],

  // `bg-white` forces a white background, which stays white in dark mode. Replace with `bg-body-tertiary`
  // (Bootstrap 5 utility that maps to --bs-tertiary-bg and inverts under Bootstrap data-bs-theme="dark").
  // But: preserve `bg-white bg-opacity-*` usages — those are intentional transparent overlays on colored heros.
  [/\bbg-white(?!\s+bg-opacity)/g, "bg-body-tertiary", "bg-white -> bg-body-tertiary"],
];

let totalChanges = 0;
for (const rel of TARGETS) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    console.log(`skip (missing): ${rel}`);
    continue;
  }
  let src = fs.readFileSync(p, 'utf8');
  const orig = src;
  const counts = [];
  for (const [re, rep, desc] of SUBS) {
    const before = src;
    src = src.replace(re, rep);
    const c = (before.match(re) || []).length;
    if (c > 0) counts.push(`${c}x ${desc}`);
  }
  if (src !== orig) {
    fs.writeFileSync(p, src);
    totalChanges += counts.length;
    console.log(`updated: ${rel}`);
    counts.forEach(c => console.log(`         - ${c}`));
  } else {
    console.log(`clean:   ${rel}`);
  }
}

console.log(`\nDone. ${totalChanges} substitution groups applied across ${TARGETS.length} files.`);
