/* Prune public/build/assets after a build.
 *
 * vite.config.js sets emptyOutDir:false so old hashed chunks survive a deploy —
 * a tab opened before the deploy can still fetch the file it baked in, so it
 * never hits the stale-chunk reload. The cost is that assets/ grows every build.
 *
 * This keeps every file the CURRENT manifest references, plus any file touched
 * within the retention window (so recent prior deploys still serve open tabs),
 * and deletes the rest. Retention days: PRUNE_BUILD_DAYS env, default 7. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'public', 'build');
const assetsDir = path.join(buildDir, 'assets');
const manifestPath = path.join(buildDir, 'manifest.json');

const retentionDays = Number(process.env.PRUNE_BUILD_DAYS ?? 7) || 7;
const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

if (!fs.existsSync(assetsDir) || !fs.existsSync(manifestPath)) {
  console.log('[prune-build] nothing to prune (no assets or manifest)');
  process.exit(0);
}

// Collect every file the current build references (entries + their css/imports).
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const keep = new Set();
for (const entry of Object.values(manifest)) {
  if (entry.file) keep.add(path.basename(entry.file));
  for (const c of entry.css ?? []) keep.add(path.basename(c));
  for (const a of entry.assets ?? []) keep.add(path.basename(a));
}

let removed = 0, kept = 0;
for (const name of fs.readdirSync(assetsDir)) {
  const full = path.join(assetsDir, name);
  const referenced = keep.has(name);
  const recent = (() => { try { return fs.statSync(full).mtimeMs >= cutoff; } catch { return true; } })();
  if (referenced || recent) { kept++; continue; }
  try { fs.unlinkSync(full); removed++; } catch { /* ignore */ }
}

console.log(`[prune-build] kept ${kept}, removed ${removed} (retention ${retentionDays}d)`);
