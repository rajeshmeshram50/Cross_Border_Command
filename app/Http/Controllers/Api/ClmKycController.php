<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmAuthority;
use App\Models\ClmKycDocument;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ClmKycController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $rows = $user->client_id
            ? ClmKycDocument::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();

        // `authority` stores authority ids; expose the resolved current names so
        // the list (and any name search) shows live values.
        $map = ClmAuthority::idNameMap($user->client_id);
        $rows->each(fn ($r) => $r->authority_names = ClmAuthority::displayNames($r->authority, $map));

        // Per-row "in use" flags so the UI can disable + explain the delete
        // action for referenced documents (mirrors the checks in destroy()).
        $rows->each(function ($r) {
            $labels = $this->usageCheck($r->code);
            $r->in_use  = !empty($labels);
            $r->used_in = array_values($labels);
        });

        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context for this user'], 403);

        $data = $request->validate([
            'name'      => 'required|string|max:255',
            'authority' => 'required|string|max:2000',
            'expiry'    => 'nullable|string|max:32',
            'status'    => ['nullable', Rule::in(ClmKycDocument::STATUSES)],
        ]);

        $name = trim($data['name']);
        if (ClmKycDocument::where('client_id', $user->client_id)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
            ->exists()) {
            throw ValidationException::withMessages([
                'name' => "A KYC document named \"{$name}\" already exists. Pick a different name.",
            ]);
        }

        // Store authority by id (resolve names → ids); reject if nothing valid.
        $data['authority'] = ClmAuthority::normalizeIds($data['authority'] ?? null, $user->client_id);
        if ($data['authority'] === '') {
            throw ValidationException::withMessages(['authority' => 'Select at least one valid authority.']);
        }

        $row = DB::transaction(function () use ($user, $data) {
            return ClmKycDocument::create([
                'client_id'  => $user->client_id,
                'code'       => $this->nextCode($user->client_id),
                'name'       => trim($data['name']),
                'authority'  => $data['authority'],
                'expiry'     => $data['expiry'] ?? 'N/A',
                'status'     => $data['status'] ?? ClmKycDocument::STATUS_ACTIVE,
                'created_by' => $user->id,
                'updated_by' => $user->id,
            ]);
        });

        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function update(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = ClmKycDocument::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'name'      => 'sometimes|required|string|max:255',
            'authority' => 'sometimes|required|string|max:2000',
            'expiry'    => 'nullable|string|max:32',
            'status'    => ['nullable', Rule::in(ClmKycDocument::STATUSES)],
        ]);

        if (isset($data['name'])) $data['name'] = trim($data['name']);
        if (isset($data['authority'])) {
            $data['authority'] = ClmAuthority::normalizeIds($data['authority'], $user->client_id);
            if ($data['authority'] === '') {
                throw ValidationException::withMessages(['authority' => 'Select at least one valid authority.']);
            }
        }

        if (isset($data['name'])
            && ClmKycDocument::where('client_id', $user->client_id)
                ->where('id', '!=', $row->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])])
                ->exists()) {
            throw ValidationException::withMessages([
                'name' => "Another KYC document named \"{$data['name']}\" already exists. Pick a different name.",
            ]);
        }

        $data['updated_by'] = $user->id;
        $row->update($data);

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function destroy(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = ClmKycDocument::where('client_id', $user->client_id)->findOrFail($id);

        $usedIn = $this->usageCheck($row->code);
        if (!empty($usedIn)) {
            return response()->json([
                'status'  => false,
                'message' => 'This KYC document is in use by ' . implode(', ', $usedIn) . '. Remove or reassign those records before deleting.',
                'used_in' => $usedIn,
            ], 409);
        }

        $row->delete();

        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    private function usageCheck(?string $code): array
    {
        if (!$code) return [];
        $usedIn = [];
        if (Schema::hasTable('clm_segment_rules')
            && Schema::hasColumn('clm_segment_rules', 'doc_selections')
            && DB::table('clm_segment_rules')
                ->where('doc_selections', 'like', '%"' . $code . '"%')
                ->exists()) {
            $usedIn[] = 'Segment Rules';
        }
        if (Schema::hasTable('segment_doc_uploads')
            && Schema::hasColumn('segment_doc_uploads', 'doc_code')
            && DB::table('segment_doc_uploads')->where('doc_code', $code)->exists()) {
            $usedIn[] = 'Segment Doc Uploads';
        }
        return $usedIn;
    }

    private function nextCode(int $clientId): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        $codes = ClmKycDocument::where('client_id', $clientId)->pluck('code')->all();
        $maxN = 0;
        $taken = [];
        foreach ($codes as $c) {
            if (preg_match('/^KYC-(\d+)$/', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $maxN) $maxN = $n;
            }
            $taken[(string) $c] = true;
        }
        $n = $maxN;
        do {
            $n++;
            $code = sprintf('KYC-%03d', $n);
        } while (isset($taken[$code]));
        return $code;
    }
}
