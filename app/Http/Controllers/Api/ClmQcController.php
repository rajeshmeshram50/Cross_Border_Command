<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmAuthority;
use App\Models\ClmQcDocument;
use App\Support\MasterVisibility;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ClmQcController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        // Branch-scoped read: own rows + client-level (shared); siblings hidden (CBC-432).
        $q = ClmQcDocument::query()->orderBy('id');
        MasterVisibility::applyReadScope($q, $user, $request->integer('branch_id') ?: null);
        $rows = $q->get();

        // `issued_by` stores authority ids; expose the resolved current names.
        $map = ClmAuthority::idNameMap($user->client_id);
        $rows->each(fn ($r) => $r->issued_by_names = ClmAuthority::displayNames($r->issued_by, $map));

        // Per-row "in use" flags so the UI can disable + explain the delete
        // action for referenced documents (mirrors the checks in destroy()).
        $rows->each(function ($r) use ($user) {
            $labels = $this->usageCheck($user->client_id, $r->code, $r->name);
            $r->in_use  = !empty($labels);
            $r->used_in = array_values($labels);
        });

        return response()->json([
            'status' => true,
            'data'   => $rows,
            'counts' => [
                'all'  => $rows->count(),
                'cert' => $rows->where('doc_type', ClmQcDocument::TYPE_CERT)->count(),
                'comp' => $rows->where('doc_type', ClmQcDocument::TYPE_COMP)->count(),
            ],
        ]);
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
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
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
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'delete')) {
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
