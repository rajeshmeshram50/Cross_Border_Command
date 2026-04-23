/* eslint-disable */
// Generator: parse resources/js/pages/master/masterConfigs.ts and emit
//  - database/migrations/2026_04_22_1000NN_create_master_{slug}_table.php
//  - app/Models/Masters/{Pascal}.php
//  - app/Http/Controllers/Api/MasterController.php  (class map + schema map)
//
// Run:  node scripts/gen-masters.cjs

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'resources/js/pages/master/masterConfigs.ts');
const MIG_DIR = path.join(ROOT, 'database/migrations');
const MODEL_DIR = path.join(ROOT, 'app/Models/Masters');
const CTRL_PATH = path.join(ROOT, 'app/Http/Controllers/Api/MasterController.php');

const src = fs.readFileSync(CONFIG_PATH, 'utf8');

/* -------------------- parse masters -------------------- */
const lines = src.split('\n');
const masters = [];
let i = 0;
while (i < lines.length) {
  const m = lines[i].match(/^  ([a-z_][a-z0-9_]*): \{$/);
  if (!m) { i++; continue; }
  const key = m[1];
  let depth = 1;
  const body = [];
  i++;
  while (i < lines.length && depth > 0) {
    const l = lines[i];
    for (const ch of l) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth === 0) break;
    }
    if (depth > 0) body.push(l);
    i++;
  }
  masters.push({ key, body: body.join('\n') });
}

/* -------------------- extract field info -------------------- */
function extractFields(body) {
  // find "fields: [" ... first matching "]"
  const start = body.indexOf('fields:');
  if (start < 0) return [];
  const br = body.indexOf('[', start);
  if (br < 0) return [];
  let depth = 1;
  let j = br + 1;
  while (j < body.length && depth > 0) {
    if (body[j] === '[') depth++;
    else if (body[j] === ']') depth--;
    if (depth === 0) break;
    j++;
  }
  const inner = body.slice(br + 1, j);
  // Each field is an object literal {...}. Split on top-level commas.
  const fields = [];
  let cur = '';
  let d = 0;
  for (const ch of inner) {
    if (ch === '{') {
      if (d === 0) cur = ''; // discard inter-object commas/whitespace
      d++;
    }
    cur += ch;
    if (ch === '}') {
      d--;
      if (d === 0) {
        fields.push(cur.trim());
        cur = '';
      }
    }
  }
  return fields.map(parseFieldObj).filter(f => f && f.n);
}

function parseFieldObj(s) {
  // e.g. { n: 'name', l: 'Name', t: 'text', r: true, p: 'x', full: true, opts: ['a','b'], ref: 'x', refL: 'y', sec: 'Z' }
  const get = (key) => {
    const re = new RegExp(`\\b${key}\\s*:\\s*('([^']*)'|"([^"]*)"|true|false|\\d+)`);
    const m = s.match(re);
    if (!m) return undefined;
    if (m[2] != null) return m[2];
    if (m[3] != null) return m[3];
    if (m[1] === 'true') return true;
    if (m[1] === 'false') return false;
    return Number(m[1]);
  };
  const getOpts = () => {
    const m = s.match(/\bopts\s*:\s*\[([^\]]*)\]/);
    if (!m) return undefined;
    return [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]);
  };
  const sec = get('sec');
  const n = get('n');
  if (sec && !n) return null;
  return {
    n,
    l: get('l'),
    t: get('t'),
    r: get('r') === true,
    ref: get('ref'),
    refL: get('refL'),
    opts: getOpts(),
  };
}

function extractUFields(body) {
  const m = body.match(/uFields\s*:\s*\[([^\]]*)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

/* -------------------- helpers -------------------- */
function pascal(s) {
  return s.split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function columnForField(f) {
  // Returns Laravel migration snippet for one field
  const n = f.n;
  if (!n) return null;
  const t = f.t;
  if (t === 'textarea') return `$table->text('${n}')->nullable();`;
  if (t === 'date')     return `$table->date('${n}')->nullable();`;
  if (t === 'number') {
    // decimal covers ints and floats
    return `$table->decimal('${n}', 18, 4)->nullable();`;
  }
  // Select with inline opts and no ref → enum-constrained column
  if (t === 'select' && !f.ref && Array.isArray(f.opts) && f.opts.length) {
    const opts = f.opts.map(o => `'${String(o).replace(/'/g, "\\'")}'`).join(', ');
    return `$table->enum('${n}', [${opts}])->nullable();`;
  }
  // text, email, select-with-ref (stores the referenced id as string)
  return `$table->string('${n}', 255)->nullable();`;
}

/* -------------------- build metadata -------------------- */
const metadata = masters.map(({ key, body }) => {
  const fields = extractFields(body);
  const uFields = extractUFields(body);
  return { slug: key, model: pascal(key), table: `master_${key}`, fields, uFields };
});

/* -------------------- emit migrations -------------------- */
const migPrefix = '2026_04_22_1000';
let idx = 0;
for (const m of metadata) {
  idx++;
  const num = String(idx).padStart(2, '0');
  const fname = `${migPrefix}${num}_create_${m.table}_table.php`;
  // Avoid duplicate column 'status' from field defs if present; always include timestamps + created_by.
  const cols = [];
  const seen = new Set();
  for (const f of m.fields) {
    if (!f.n || seen.has(f.n)) continue;
    seen.add(f.n);
    const c = columnForField(f);
    if (c) cols.push('            ' + c);
  }
  const php = `<?php

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('${m.table}', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
${cols.join('\n')}
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('${m.table}');
    }
};
`;
  fs.writeFileSync(path.join(MIG_DIR, fname), php);
}

/* -------------------- emit models -------------------- */
for (const m of metadata) {
  const fillable = ['client_id', 'branch_id', ...m.fields.map(f => f.n).filter(Boolean), 'created_by'];
  const fillableList = fillable.map(x => `        '${x}',`).join('\n');
  const php = `<?php

namespace App\\Models\\Masters;

use App\\Models\\Branch;
use App\\Models\\Client;
use App\\Models\\User;
use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;

class ${m.model} extends Model
{
    protected $table = '${m.table}';

    protected $fillable = [
${fillableList}
    ];

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
`;
  fs.writeFileSync(path.join(MODEL_DIR, `${m.model}.php`), php);
}

/* -------------------- emit controller -------------------- */
const classMapLines = metadata
  .map(m => `        '${m.slug}' => \\App\\Models\\Masters\\${m.model}::class,`)
  .join('\n');

const schemaMapLines = metadata.map(m => {
  const fieldsJson = m.fields.map(f => {
    const o = { n: f.n, t: f.t };
    if (f.r) o.r = true;
    if (f.ref) o.ref = f.ref;
    if (Array.isArray(f.opts) && f.opts.length) o.opts = f.opts;
    return o;
  });
  return `        '${m.slug}' => ['fields' => ${phpArray(fieldsJson)}, 'uFields' => ${phpArray(m.uFields || [])}],`;
}).join('\n');

function phpArray(v) {
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (typeof v[0] === 'string' || typeof v[0] === 'number') {
      return '[' + v.map(x => typeof x === 'string' ? `'${x}'` : x).join(', ') + ']';
    }
    // array of objects
    return '[' + v.map(o => phpObject(o)).join(', ') + ']';
  }
  return phpObject(v);
}
function phpObject(o) {
  const parts = Object.entries(o).map(([k, val]) => {
    if (typeof val === 'string') return `'${k}' => '${val.replace(/'/g, "\\'")}'`;
    if (typeof val === 'boolean') return `'${k}' => ${val ? 'true' : 'false'}`;
    if (Array.isArray(val)) return `'${k}' => ${phpArray(val)}`;
    return `'${k}' => ${val}`;
  });
  return '[' + parts.join(', ') + ']';
}

const controller = `<?php

namespace App\\Http\\Controllers\\Api;

use App\\Http\\Controllers\\Controller;
use Illuminate\\Http\\Request;
use Illuminate\\Validation\\Rule;

class MasterController extends Controller
{
    /**
     * slug -> Eloquent model class map
     */
    private const MODELS = [
${classMapLines}
    ];

    /**
     * slug -> ['fields' => [{n,t,r,ref?}, ...], 'uFields' => [...]]
     */
    private const SCHEMAS = [
${schemaMapLines}
    ];

    /**
     * Relationships to eager-load on every list/show so the frontend can render
     * client name / branch name / creator name without extra round-trips.
     */
    private const OWNERSHIP_WITH = [
        'client:id,org_name',
        'branch:id,name',
        'creator:id,name',
    ];

    public function list(Request $request, string $slug)
    {
        $modelClass = $this->resolveModel($slug);
        $q = $modelClass::query()->with(self::OWNERSHIP_WITH)->orderByDesc('id');
        $this->applyScope($q, $request->user());

        if ($search = $request->query('search')) {
            $schema = self::SCHEMAS[$slug] ?? ['fields' => []];
            $fields = $schema['fields'] ?? [];
            $q->where(function ($w) use ($fields, $search) {
                foreach ($fields as $f) {
                    if (in_array($f['t'], ['text', 'email', 'textarea', 'select'])) {
                        $w->orWhere($f['n'], 'ilike', "%{$search}%");
                    }
                }
            });
        }

        return response()->json($q->get()->map(fn ($r) => $this->withOwnership($r)));
    }

    public function show(Request $request, string $slug, $id)
    {
        $modelClass = $this->resolveModel($slug);
        $q = $modelClass::query()->with(self::OWNERSHIP_WITH);
        $this->applyScope($q, $request->user());
        $row = $q->findOrFail($id);
        return response()->json($this->withOwnership($row));
    }

    public function store(Request $request, string $slug)
    {
        $modelClass = $this->resolveModel($slug);
        $data = $this->validatePayload($request, $slug, null);
        $user = $request->user();
        $data['created_by'] = optional($user)->id;

        // Stamp client/branch scope from the authenticated user.
        // super_admin may optionally pass client_id/branch_id in request; others are locked to their own.
        [$clientId, $branchId] = $this->resolveOwnership($request, $user);
        $data['client_id'] = $clientId;
        $data['branch_id'] = $branchId;

        $row = $modelClass::create($data);
        $row->load(self::OWNERSHIP_WITH);
        return response()->json($this->withOwnership($row), 201);
    }

    public function update(Request $request, string $slug, $id)
    {
        $modelClass = $this->resolveModel($slug);
        $q = $modelClass::query()->with(self::OWNERSHIP_WITH);
        $this->applyScope($q, $request->user());
        $row = $q->findOrFail($id);
        $data = $this->validatePayload($request, $slug, $id);
        $row->update($data);
        $row->load(self::OWNERSHIP_WITH);
        return response()->json($this->withOwnership($row));
    }

    public function destroy(Request $request, string $slug, $id)
    {
        $modelClass = $this->resolveModel($slug);
        $q = $modelClass::query();
        $this->applyScope($q, $request->user());
        $row = $q->findOrFail($id);
        $row->delete();
        return response()->json(['message' => 'Deleted']);
    }

    /* ---------------- helpers ---------------- */

    private function resolveModel(string $slug): string
    {
        if (!isset(self::MODELS[$slug])) {
            abort(404, "Unknown master: {$slug}");
        }
        return self::MODELS[$slug];
    }

    /**
     * Flatten eager-loaded client/branch/creator into scalar name fields on the
     * serialized row so the frontend doesn't need to drill into nested objects.
     */
    private function withOwnership($row): array
    {
        $arr = $row->toArray();
        $arr['client_name']  = $row->client?->org_name;
        $arr['branch_name']  = $row->branch?->name;
        $arr['creator_name'] = $row->creator?->name;
        return $arr;
    }

    /**
     * Scope a query to what the current user is allowed to see. Rules:
     *
     *   super_admin         -> everything
     *
     *   client_admin/user   -> rows where client_id IS NULL (super-admin "global" rows)
     *                          OR client_id = own client
     *
     *   branch_user (main)  -> rows where client_id IS NULL
     *                          OR client_id = own client (any branch, any null branch)
     *                          A main-branch user sees every row under their client.
     *
     *   branch_user (sub)   -> rows where client_id IS NULL
     *                          OR (client_id = own client AND (
     *                                branch_id IS NULL                    -- client-level rows
     *                                OR branch_id = own branch            -- own rows
     *                                OR branch_id = main branch id        -- main-branch shared rows
     *                              ))
     */
    private function applyScope($q, $user): void
    {
        if (!$user) return;
        if ($user->user_type === 'super_admin') return;

        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            $clientId = $user->client_id;
            $q->where(function ($w) use ($clientId) {
                $w->whereNull('client_id')->orWhere('client_id', $clientId);
            });
            return;
        }

        if ($user->user_type === 'branch_user') {
            $clientId = $user->client_id;
            $branchId = $user->branch_id;
            $isMain   = $user->branch?->is_main ?? false;

            if ($isMain) {
                $q->where(function ($w) use ($clientId) {
                    $w->whereNull('client_id')->orWhere('client_id', $clientId);
                });
                return;
            }

            // Non-main branch user: include global rows, client-level rows, own branch, main-branch-shared rows.
            $mainBranchId = \\App\\Models\\Branch::where('client_id', $clientId)
                ->where('is_main', true)
                ->value('id');

            $q->where(function ($w) use ($clientId, $branchId, $mainBranchId) {
                $w->whereNull('client_id')
                  ->orWhere(function ($ww) use ($clientId, $branchId, $mainBranchId) {
                      $ww->where('client_id', $clientId)
                         ->where(function ($wb) use ($branchId, $mainBranchId) {
                             $wb->whereNull('branch_id')
                                ->orWhere('branch_id', $branchId);
                             if ($mainBranchId) {
                                 $wb->orWhere('branch_id', $mainBranchId);
                             }
                         });
                  });
            });
            return;
        }

        // unknown type -> see nothing
        $q->whereRaw('1 = 0');
    }

    /**
     * Pick the (client_id, branch_id) that should be stamped on a new row.
     * Non-super-admins cannot spoof other tenants' ids.
     */
    private function resolveOwnership(Request $request, $user): array
    {
        if ($user && $user->user_type === 'super_admin') {
            return [
                $request->input('client_id'),
                $request->input('branch_id'),
            ];
        }

        if ($user && in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            return [$user->client_id, null];
        }

        if ($user && $user->user_type === 'branch_user') {
            return [$user->client_id, $user->branch_id];
        }

        return [null, null];
    }

    private function validatePayload(Request $request, string $slug, $id = null): array
    {
        $schema = self::SCHEMAS[$slug] ?? ['fields' => [], 'uFields' => []];
        $fields = $schema['fields'] ?? [];
        $uFields = $schema['uFields'] ?? [];
        $modelClass = $this->resolveModel($slug);
        $table = (new $modelClass)->getTable();

        $rules = [];
        foreach ($fields as $f) {
            $r = [];
            $r[] = $f['r'] ?? false ? 'required' : 'nullable';
            if ($f['t'] === 'number') {
                $r[] = 'numeric';
            } elseif ($f['t'] === 'email') {
                $r[] = 'email';
                $r[] = 'max:255';
            } elseif ($f['t'] === 'date') {
                $r[] = 'date';
            } elseif ($f['t'] === 'textarea') {
                $r[] = 'string';
            } else {
                $r[] = 'string';
                $r[] = 'max:255';
            }
            // Enforce enum options server-side when present and no ref override
            if (!empty($f['opts']) && empty($f['ref'])) {
                $r[] = Rule::in($f['opts']);
            }
            if (in_array($f['n'], $uFields, true)) {
                $rule = Rule::unique($table, $f['n']);
                if ($id) $rule = $rule->ignore($id);
                $r[] = $rule;
            }
            $rules[$f['n']] = $r;
        }

        $validated = $request->validate($rules);
        // Strip empty strings on nullable fields so DB gets NULL
        foreach ($validated as $k => $v) {
            if ($v === '') $validated[$k] = null;
        }
        return $validated;
    }
}
`;

fs.writeFileSync(CTRL_PATH, controller);

console.log(`Generated:`);
console.log(`  ${metadata.length} migrations in ${MIG_DIR}`);
console.log(`  ${metadata.length} models in ${MODEL_DIR}`);
console.log(`  1 controller at ${CTRL_PATH}`);
console.log('');
console.log('Masters processed:');
metadata.forEach(m => console.log(`  - ${m.slug}  (table=${m.table}, fields=${m.fields.length}, u=[${m.uFields.join(',')}])`));
