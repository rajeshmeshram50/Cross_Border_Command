<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmAuthority;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;


class ClmAuthorityController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $rows = $user->client_id
            ? ClmAuthority::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();

        return response()->json([
            'status' => true,
            'data'   => $rows,
            'count'  => $rows->count(),
        ]);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context for this user'], 403);

        $data = $request->validate([
            'name'        => 'required|string|max:255',
            'description' => 'required|string|max:500',
            'status'      => ['nullable', Rule::in(ClmAuthority::STATUSES)],
        ]);

        // Reject duplicate authority names per client (case-insensitive).
        $name = trim($data['name']);
        $exists = ClmAuthority::where('client_id', $user->client_id)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
            ->exists();
        if ($exists) {
            throw ValidationException::withMessages([
                'name' => "An authority named \"{$name}\" already exists. Pick a different name.",
            ]);
        }

        $row = DB::transaction(function () use ($user, $data, $name) {
            return ClmAuthority::create([
                'client_id'   => $user->client_id,
                'code'        => $this->nextCode($user->client_id),
                'name'        => $name,
                'description' => trim($data['description']),
                'status'      => $data['status'] ?? ClmAuthority::STATUS_ACTIVE,
                'created_by'  => $user->id,
                'updated_by'  => $user->id,
            ]);
        });

        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function update(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = ClmAuthority::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'name'        => 'sometimes|required|string|max:255',
            'description' => 'sometimes|required|string|max:500',
            'status'      => ['nullable', Rule::in(ClmAuthority::STATUSES)],
        ]);

        if (isset($data['name']))        $data['name']        = trim($data['name']);
        if (isset($data['description'])) $data['description'] = trim($data['description']);

        // Reject rename to a duplicate (case-insensitive, excluding self).
        if (isset($data['name'])) {
            $clash = ClmAuthority::where('client_id', $user->client_id)
                ->where('id', '!=', $row->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])])
                ->exists();
            if ($clash) {
                throw ValidationException::withMessages([
                    'name' => "Another authority named \"{$data['name']}\" already exists. Pick a different name.",
                ]);
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
        $row  = ClmAuthority::where('client_id', $user->client_id)->findOrFail($id);

        // Authority is referenced by NAME across downstream document
        // tables (kyc, dd, trade-license, qc, vendor/customer docs), and by
        // CODE inside the JSON `auths_json` column on segment rules.
        $name = $row->name;
        $code = $row->code;
        $usedIn = [];

        $nameTables = [
            ['table' => 'clm_kyc_documents',     'col' => 'authority',         'label' => 'KYC Documents'],
            ['table' => 'clm_dd_documents',      'col' => 'authority',         'label' => 'Due Diligence Documents'],
            ['table' => 'clm_trade_licenses',    'col' => 'authority',         'label' => 'Trade Licenses'],
            ['table' => 'clm_qc_documents',      'col' => 'issued_by',         'label' => 'Quality & Compliance Docs'],
            ['table' => 'vendor_documents',      'col' => 'issuing_authority', 'label' => 'Vendor Documents'],
            ['table' => 'customer_documents',    'col' => 'issuing_authority', 'label' => 'Customer Documents'],
            ['table' => 'vendor_owners',         'col' => 'issuing_authority', 'label' => 'Vendor Owners'],
        ];
        foreach ($nameTables as $t) {
            if (Schema::hasTable($t['table'])
                && Schema::hasColumn($t['table'], $t['col'])
                && DB::table($t['table'])->where($t['col'], $name)->exists()) {
                $usedIn[] = $t['label'];
            }
        }

        // Segment Rules stores the code inside a JSON array — substring
        // match keeps the check portable across MySQL / Postgres / SQLite.
        if (Schema::hasTable('clm_segment_rules')
            && Schema::hasColumn('clm_segment_rules', 'auths_json')
            && $code
            && DB::table('clm_segment_rules')
                ->where('auths_json', 'like', '%"' . $code . '"%')
                ->exists()) {
            $usedIn[] = 'Segment Rules';
        }

        if (!empty($usedIn)) {
            return response()->json([
                'status'  => false,
                'message' => 'This authority is in use by ' . implode(', ', $usedIn) . '. Remove or reassign those records before deleting.',
                'used_in' => $usedIn,
            ], 409);
        }

        $row->delete();

        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    private function nextCode(int $clientId): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        // Walk past max + any taken codes — count(+1) breaks when the
        // sequence has gaps (e.g. after deletes).
        $codes = ClmAuthority::where('client_id', $clientId)->pluck('code')->all();
        $maxN = 0;
        $taken = [];
        foreach ($codes as $c) {
            if (preg_match('/^AUTH-(\d+)$/', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $maxN) $maxN = $n;
            }
            $taken[(string) $c] = true;
        }
        $n = $maxN;
        do {
            $n++;
            $code = sprintf('AUTH-%03d', $n);
        } while (isset($taken[$code]));
        return $code;
    }
}
