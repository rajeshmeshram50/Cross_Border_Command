<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmAuthority;
use App\Models\ClmQcDocument;
use App\Support\ClmMasterAccess;
use App\Support\MasterVisibility;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ClmQcController extends Controller
{
    use \App\Http\Controllers\Concerns\ChecksClmDocUsage;

    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        // Branch-scoped read: own rows + client-level (shared); siblings hidden (CBC-432).
        $q = ClmQcDocument::query()->orderByDesc('id');   // newest entry first
        MasterVisibility::applyReadScope($q, $user, $request->integer('branch_id') ?: null);

        /* Search in SQL, alongside the paging. Filtering a single page in the
           browser searches ten rows out of the whole master. */
        if ($search = trim((string) $request->input('search', ''))) {
            $like = '%' . $search . '%';
            /* Authority is stored by ID, but the list shows — and the old
               client-side filter searched — the resolved NAME. Resolve the
               term to ids so searching by authority still works. */
            $authIds = ClmAuthority::idsMatchingName((int) $user->client_id, $search);
            $q->where(function ($w) use ($like, $authIds) {
                $w->where('name', 'ilike', $like)->orWhere('code', 'ilike', $like)->orWhere('purpose', 'ilike', $like);
                ClmAuthority::scopeStoredIdsIn($w, 'issued_by', $authIds);
            });
        }

        /* Counts describe the WHOLE scoped set, so they are aggregated in SQL
           and not derived from the rows in hand — otherwise page 2 would report
           its own ten rows as the totals. */
        $counts = (clone $q)->selectRaw(
            'COUNT(*) AS all_c,'
            . ' COUNT(*) FILTER (WHERE doc_type = ?) AS cert_c,'
            . ' COUNT(*) FILTER (WHERE doc_type = ?) AS comp_c',
            [ClmQcDocument::TYPE_CERT, ClmQcDocument::TYPE_COMP]
        )->reorder()->first();

        /* PAGINATION — opt-in via per_page, so existing callers are unchanged. */
        $perPage = $request->filled('per_page')
            ? min(200, max(1, (int) $request->input('per_page')))
            : null;
        $page  = max(1, (int) $request->input('page', 1));
        $total = (int) ($counts->all_c ?? 0);

        $rows = $perPage ? $q->forPage($page, $perPage)->get() : $q->get();

        // `issued_by` stores authority ids; expose the resolved current names.
        $map = ClmAuthority::idNameMap($user->client_id, ClmAuthority::idsReferencedIn($rows->pluck('issued_by')));
        $rows->each(fn ($r) => $r->issued_by_names = ClmAuthority::displayNames($r->issued_by, $map));

        /* Per-row "in use" flags, from sets built ONCE.
           This used to call usageCheck() inside the loop — one row, three
           existence queries, plus six Schema::hasTable/hasColumn calls that
           each hit information_schema. Twenty rows meant 182 queries and
           ~560 ms locally; it scales with the row count, which is what made
           the page take 13 s on a real dataset.
           The three referencing tables are small and bounded, so reading each
           ONCE and matching in memory turns the whole loop into hash lookups. */
        $sets = $this->usageSets((int) $user->client_id);
        $rows->each(function ($r) use ($sets) {
            $labels = [];
            if ($r->code && isset($sets['rules'][$r->code]))   $labels[] = 'Segment Rules';
            if ($r->code && isset($sets['uploads'][$r->code])) $labels[] = 'Segment Doc Uploads';
            if ($r->name && isset($sets['products'][mb_strtolower(trim((string) $r->name))])) {
                $labels[] = 'Product QC Records';
            }
            $r->in_use  = !empty($labels);
            $r->used_in = $labels;
        });

        return response()->json([
            'status' => true,
            'data'   => $rows,
            'total'  => $total,
            'counts' => [
                'all'  => $total,
                'cert' => (int) ($counts->cert_c ?? 0),
                'comp' => (int) ($counts->comp_c ?? 0),
            ],
        ]);
    }

    /**
     * Everything that references a QC document, read once per REQUEST rather
     * than once per row. Returns three lookup maps: codes used by segment
     * rules, codes used by segment doc uploads, and lowercased names used by
     * product QC records.
     *
     * Bounded by the size of those three tables, not by the number of QC
     * documents on the page — which is the whole point.
     */
    private function usageSets(int $clientId): array
    {
        // Segment rules + doc uploads are shared with KYC / DD / Trade Licenses.
        $sets = $this->clmDocUsageSets($clientId);

        // QC alone also appears in product QC records, matched by NAME.
        // product_qc_records has no client_id — scope through its product.
        $products = [];
        if (Schema::hasTable('product_qc_records') && Schema::hasColumn('product_qc_records', 'qc_name')) {
            foreach (DB::table('product_qc_records')
                       ->join('products', 'products.id', '=', 'product_qc_records.product_id')
                       ->where('products.client_id', $clientId)
                       ->whereNotNull('product_qc_records.qc_name')
                       ->distinct()->pluck('product_qc_records.qc_name') as $n) {
                $products[mb_strtolower(trim((string) $n))] = true;
            }
        }

        return $sets + ['products' => $products];
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context for this user'], 403);

        $data = $request->validate([
            'name'         => 'required|string|max:255',
            'purpose'      => 'required|string|max:500',
            'issued_by'    => 'required|string|max:255',
            'doc_type'     => ['nullable', Rule::in(ClmQcDocument::TYPES)],
            'qa_params'    => 'nullable|string|max:256',
            'min_criteria' => 'nullable|string|max:256',
            'status'       => ['nullable', Rule::in(ClmQcDocument::STATUSES)],
        ]);

        $name = trim($data['name']);
        $dupe = ClmQcDocument::query()->whereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
        MasterVisibility::applyReadScope($dupe, $user, $user->branch_id ?: null);
        if ($dupe->exists()) {
            $msg = "A QC document named \"{$name}\" already exists. Pick a different name.";
            // 422 + errors.name so the modal shows it inline under QC CERTIFICATE
            // NAME (not a global toast) — same shape Laravel's `unique` rule returns.
            return response()->json([
                'status'  => false,
                'message' => $msg,
                'errors'  => ['name' => [$msg]],
            ], 422);
        }

        // Store issuing authority by id (resolve names → ids).
        $data['issued_by'] = ClmAuthority::normalizeIds($data['issued_by'] ?? null, $user->client_id);
        if ($data['issued_by'] === '') {
            throw ValidationException::withMessages(['issued_by' => 'Select a valid authority.']);
        }

        $row = DB::transaction(function () use ($user, $data) {
            return ClmQcDocument::create([
                'client_id'    => $user->client_id,
                'branch_id'    => $user->branch_id,   // branch-owned; null for client-level users → shared
                'code'         => $this->nextCode($user->client_id, $user->branch_id),
                'name'         => trim($data['name']),
                'purpose'      => trim($data['purpose']),
                'issued_by'    => $data['issued_by'],
                'doc_type'     => $data['doc_type'] ?? ClmQcDocument::TYPE_CERT,
                'qa_params'    => $data['qa_params']    ?? null,
                'min_criteria' => $data['min_criteria'] ?? null,
                'status'       => $data['status'] ?? ClmQcDocument::STATUS_ACTIVE,
                'created_by'   => $user->id,
                'updated_by'   => $user->id,
            ]);
        });

        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function update(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $lookup = ClmQcDocument::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = ClmMasterAccess::denial($user, $row, 'edit', 'clm.quality_docs')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        $data = $request->validate([
            'name'         => 'sometimes|required|string|max:255',
            'purpose'      => 'sometimes|required|string|max:500',
            'issued_by'    => 'sometimes|required|string|max:255',
            'doc_type'     => ['nullable', Rule::in(ClmQcDocument::TYPES)],
            'qa_params'    => 'nullable|string|max:256',
            'min_criteria' => 'nullable|string|max:256',
            'status'       => ['nullable', Rule::in(ClmQcDocument::STATUSES)],
        ]);

        foreach (['name','purpose'] as $k) if (isset($data[$k])) $data[$k] = trim($data[$k]);
        if (isset($data['issued_by'])) {
            $data['issued_by'] = ClmAuthority::normalizeIds($data['issued_by'], $user->client_id);
            if ($data['issued_by'] === '') {
                throw ValidationException::withMessages(['issued_by' => 'Select a valid authority.']);
            }
        }

        if (isset($data['name'])) {
            $clash = ClmQcDocument::query()->where('id', '!=', $row->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])]);
            MasterVisibility::applyReadScope($clash, $user, $user->branch_id ?: null);
            if ($clash->exists()) {
                $msg = "Another QC document named \"{$data['name']}\" already exists. Pick a different name.";
                return response()->json([
                    'status'  => false,
                    'message' => $msg,
                    'errors'  => ['name' => [$msg]],
                ], 422);
            }
        }

        $data['updated_by'] = $user->id;
        $row->update($data);

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function destroy(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $lookup = ClmQcDocument::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = ClmMasterAccess::denial($user, $row, 'delete', 'clm.quality_docs')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        $usedIn = $this->usageCheck($user->client_id, $row->code, $row->name);
        if (!empty($usedIn)) {
            return response()->json([
                'status'  => false,
                'message' => 'This QC document is in use by ' . implode(', ', $usedIn) . '. Remove or reassign those records before deleting.',
                'used_in' => $usedIn,
            ], 409);
        }

        $row->delete();

        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    /** QC docs are referenced by code (segment rules JSON + segment doc
     *  uploads) AND by name (product_qc_records.qc_name free-text).
     *
     *  Codes (QC-001, …) are allocated PER CLIENT, so every tenant has a
     *  "QC-001". The usage lookups MUST be scoped to this client's rows —
     *  otherwise a freshly created QC-001 falsely matches another tenant's
     *  reference to their own QC-001 and the delete is wrongly blocked. */
    private function usageCheck(int $clientId, ?string $code, ?string $name): array
    {
        $usedIn = [];
        if ($code && Schema::hasTable('clm_segment_rules')
            && Schema::hasColumn('clm_segment_rules', 'doc_selections')
            && DB::table('clm_segment_rules')
                ->where('client_id', $clientId)
                ->where('doc_selections', 'like', '%"' . $code . '"%')
                ->exists()) {
            $usedIn[] = 'Segment Rules';
        }
        if ($code && Schema::hasTable('segment_doc_uploads')
            && Schema::hasColumn('segment_doc_uploads', 'doc_code')
            && DB::table('segment_doc_uploads')
                ->where('client_id', $clientId)
                ->where('doc_code', $code)
                ->exists()) {
            $usedIn[] = 'Segment Doc Uploads';
        }
        // product_qc_records has no client_id — scope through its product.
        if ($name && Schema::hasTable('product_qc_records')
            && Schema::hasColumn('product_qc_records', 'qc_name')
            && DB::table('product_qc_records')
                ->join('products', 'products.id', '=', 'product_qc_records.product_id')
                ->where('products.client_id', $clientId)
                ->where('product_qc_records.qc_name', $name)
                ->exists()) {
            $usedIn[] = 'Product QC Records';
        }
        return $usedIn;
    }

    private function nextCode(int $clientId, ?int $branchId): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        // Branch-scoped so each branch restarts from QC-001 rather than
        // continuing another branch's tally — the QC master is branch-
        // isolated via MasterVisibility. A client-level creator ($branchId
        // null) sequences the shared rows.
        $query = ClmQcDocument::where('client_id', $clientId);
        $branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id', $branchId);
        $codes = $query->pluck('code')->all();
        $maxN = 0;
        $taken = [];
        foreach ($codes as $c) {
            if (preg_match('/^QC-(\d+)$/', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $maxN) $maxN = $n;
            }
            $taken[(string) $c] = true;
        }
        $n = $maxN;
        do {
            $n++;
            $code = sprintf('QC-%03d', $n);
        } while (isset($taken[$code]));
        return $code;
    }
}
