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
use App\Support\ClmDocCode;

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
            $labels = $this->qcUsageLabels($sets, $r);
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
     * than once per row. Returns three lookup maps, each grouped by the branch
     * the reference belongs to (see ChecksClmDocUsage): codes used by segment
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
        // product_qc_records has no client_id or branch_id — both come from
        // its product.
        $products = [];
        if (Schema::hasTable('product_qc_records') && Schema::hasColumn('product_qc_records', 'qc_name')) {
            foreach (DB::table('product_qc_records')
                       ->join('products', 'products.id', '=', 'product_qc_records.product_id')
                       ->where('products.client_id', $clientId)
                       ->whereNotNull('product_qc_records.qc_name')
                       ->distinct()->get(['products.branch_id', 'product_qc_records.qc_name']) as $r) {
                $products[self::clmBranchKey($r->branch_id)][mb_strtolower(trim((string) $r->qc_name))] = true;
            }
        }

        return $sets + ['products' => $products];
    }

    /** Where this QC document is referenced, within its own branch's scope.
     *  Shared by the list's in_use flag and the delete guard. */
    private function qcUsageLabels(array $sets, ClmQcDocument $row): array
    {
        $labels = $this->clmDocUsageLabels($sets, $row->code, $row->branch_id);
        $name = mb_strtolower(trim((string) $row->name));
        if ($name !== '' && self::clmUsageHas($sets['products'], $row->branch_id, $name)) {
            $labels[] = 'Product QC Records';
        }
        return $labels;
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

        // Same branch-scoped sets the list's in_use flag reads, so the two agree.
        $usedIn = $this->qcUsageLabels($this->usageSets((int) $user->client_id), $row);
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


    private function nextCode(int $clientId, ?int $branchId): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();

        /* The counter never reissues a number, even after the row that
           held it is deleted — a recycled code would drag the old
           document's segment rules and uploads onto the new row. */
        return ClmDocCode::next('QC', ClmQcDocument::class, $clientId, $branchId);
    }
}
