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

        $q = ClmQcDocument::query()->orderByDesc('id');
        MasterVisibility::applyReadScope($q, $user, $request->integer('branch_id') ?: null);

        if ($search = trim((string) $request->input('search', ''))) {
            $like = '%' . $search . '%';
            $authIds = ClmAuthority::idsMatchingName((int) $user->client_id, $search);
            $q->where(function ($w) use ($like, $authIds) {
                $w->where('name', 'ilike', $like)->orWhere('code', 'ilike', $like)->orWhere('purpose', 'ilike', $like);
                ClmAuthority::scopeStoredIdsIn($w, 'issued_by', $authIds);
            });
        }

        $counts = (clone $q)->selectRaw(
            'COUNT(*) AS all_c,'
            . ' COUNT(*) FILTER (WHERE doc_type = ?) AS cert_c,'
            . ' COUNT(*) FILTER (WHERE doc_type = ?) AS comp_c',
            [ClmQcDocument::TYPE_CERT, ClmQcDocument::TYPE_COMP]
        )->reorder()->first();

        $perPage = $request->filled('per_page')
            ? min(200, max(1, (int) $request->input('per_page')))
            : null;
        $page  = max(1, (int) $request->input('page', 1));
        $total = (int) ($counts->all_c ?? 0);

        $rows = $perPage ? $q->forPage($page, $perPage)->get() : $q->get();

        $map = ClmAuthority::idNameMap($user->client_id, ClmAuthority::idsReferencedIn($rows->pluck('issued_by')));
        $rows->each(fn ($r) => $r->issued_by_names = ClmAuthority::displayNames($r->issued_by, $map));

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
            'next_code' => ClmDocCode::preview('QC', ClmQcDocument::class, (int) $user->client_id, $user->branch_id),
        ]);
    }

    /**
     * The shared sets plus QC's own: which product QC records name which
     * document. Cached for a minute for the same reason the shared sets are —
     * the products scan is a joined read of product_qc_records plus two
     * schema lookups, identical for every row on the page, and it is what
     * left this endpoint at 23 queries when the other three masters had come
     * down to 6. Staleness only delays a delete button greying out; destroy()
     * checks live.
     */
    private function usageSets(int $clientId): array
    {
        $build = fn (): array => $this->buildUsageSets($clientId);

        try {
            return \Illuminate\Support\Facades\Cache::remember(
                'clm:qc:usage:v1:' . $clientId,
                now()->addSeconds(60),
                $build
            );
        } catch (\Throwable $e) {
            return $build();
        }
    }

    private function buildUsageSets(int $clientId): array
    {
        $sets = $this->clmDocUsageSets($clientId);

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
            return response()->json([
                'status'  => false,
                'message' => $msg,
                'errors'  => ['name' => [$msg]],
            ], 422);
        }

        $data['issued_by'] = ClmAuthority::normalizeIds($data['issued_by'] ?? null, $user->client_id);
        if ($data['issued_by'] === '') {
            throw ValidationException::withMessages(['issued_by' => 'Select a valid authority.']);
        }

        $row = DB::transaction(function () use ($user, $data) {
            return ClmQcDocument::create([
                'client_id'    => $user->client_id,
                'branch_id'    => $user->branch_id,
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

        return ClmDocCode::next('QC', ClmQcDocument::class, $clientId, $branchId);
    }
}
