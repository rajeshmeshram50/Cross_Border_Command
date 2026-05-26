<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmQcDocument;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;

class ClmQcController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $rows = $user->client_id
            ? ClmQcDocument::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();

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
            'qa_params'    => 'nullable|string',
            'min_criteria' => 'nullable|string',
            'status'       => ['nullable', Rule::in(ClmQcDocument::STATUSES)],
        ]);

        $name = trim($data['name']);
        if (ClmQcDocument::where('client_id', $user->client_id)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
            ->exists()) {
            return response()->json([
                'status'  => false,
                'message' => "A QC document named \"{$name}\" already exists. Pick a different name.",
            ], 409);
        }

        $row = DB::transaction(function () use ($user, $data) {
            return ClmQcDocument::create([
                'client_id'    => $user->client_id,
                'code'         => $this->nextCode($user->client_id),
                'name'         => trim($data['name']),
                'purpose'      => trim($data['purpose']),
                'issued_by'    => trim($data['issued_by']),
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
        $row  = ClmQcDocument::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'name'         => 'sometimes|required|string|max:255',
            'purpose'      => 'sometimes|required|string|max:500',
            'issued_by'    => 'sometimes|required|string|max:255',
            'doc_type'     => ['nullable', Rule::in(ClmQcDocument::TYPES)],
            'qa_params'    => 'nullable|string',
            'min_criteria' => 'nullable|string',
            'status'       => ['nullable', Rule::in(ClmQcDocument::STATUSES)],
        ]);

        foreach (['name','purpose','issued_by'] as $k) if (isset($data[$k])) $data[$k] = trim($data[$k]);

        if (isset($data['name'])
            && ClmQcDocument::where('client_id', $user->client_id)
                ->where('id', '!=', $row->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])])
                ->exists()) {
            return response()->json([
                'status'  => false,
                'message' => "Another QC document named \"{$data['name']}\" already exists. Pick a different name.",
            ], 409);
        }

        $data['updated_by'] = $user->id;
        $row->update($data);

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function destroy(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = ClmQcDocument::where('client_id', $user->client_id)->findOrFail($id);

        $usedIn = $this->usageCheck($row->code, $row->name);
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
     *  uploads) AND by name (product_qc_records.qc_name free-text). */
    private function usageCheck(?string $code, ?string $name): array
    {
        $usedIn = [];
        if ($code && Schema::hasTable('clm_segment_rules')
            && Schema::hasColumn('clm_segment_rules', 'doc_selections')
            && DB::table('clm_segment_rules')
                ->where('doc_selections', 'like', '%"' . $code . '"%')
                ->exists()) {
            $usedIn[] = 'Segment Rules';
        }
        if ($code && Schema::hasTable('segment_doc_uploads')
            && Schema::hasColumn('segment_doc_uploads', 'doc_code')
            && DB::table('segment_doc_uploads')->where('doc_code', $code)->exists()) {
            $usedIn[] = 'Segment Doc Uploads';
        }
        if ($name && Schema::hasTable('product_qc_records')
            && Schema::hasColumn('product_qc_records', 'qc_name')
            && DB::table('product_qc_records')->where('qc_name', $name)->exists()) {
            $usedIn[] = 'Product QC Records';
        }
        return $usedIn;
    }

    private function nextCode(int $clientId): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        $codes = ClmQcDocument::where('client_id', $clientId)->pluck('code')->all();
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
