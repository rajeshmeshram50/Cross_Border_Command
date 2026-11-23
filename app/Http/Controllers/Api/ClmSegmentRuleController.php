<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmAuthority;
use App\Models\ClmDdDocument;
use App\Models\ClmKycDocument;
use App\Models\ClmQcDocument;
use App\Models\ClmSegment;
use App\Models\ClmSegmentRule;
use App\Models\ClmTradeLicense;
use App\Support\MasterBundleCache;
use App\Support\MasterVisibility;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class ClmSegmentRuleController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => true, 'data' => [], 'counts' => ['all' => 0, 'highly' => 0, 'less' => 0]]);
        }
        $query = ClmSegmentRule::query()->orderByDesc('id');
        MasterVisibility::applyReadScope($query, $user, $request->integer('branch_id') ?: null);
        $rows = $query->get();
        return response()->json([
            'status' => true,
            'data'   => $rows,
            'counts' => [
                'all'    => $rows->count(),
                'highly' => $rows->where('regulatory_status', ClmSegmentRule::REG_HIGHLY)->count(),
                'less'   => $rows->where('regulatory_status', ClmSegmentRule::REG_LESS)->count(),
            ],
        ]);
    }

    public function bootstrap(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $cid = $user->client_id;

        $branchId = $request->integer('branch_id') ?: null;
        $load = function (string $modelClass) use ($cid, $user, $branchId) {
            if (!$cid) return collect();
            $q = $modelClass::query()->orderBy('id');
            MasterVisibility::applyReadScope($q, $user, $branchId);
            return $q->get();
        };

        $segments    = $load(ClmSegment::class);
        $authorities = $load(ClmAuthority::class);
        $kyc         = $load(ClmKycDocument::class);
        $dd          = $load(ClmDdDocument::class);
        $tl          = $load(ClmTradeLicense::class);
        $qc          = $load(ClmQcDocument::class);

        $authMap = ClmAuthority::idNameMap($cid);
        $kyc->each(function ($r) use ($authMap) {
            $r->authority_list = ClmAuthority::displayNamesList($r->authority, $authMap);
            $r->authority      = ClmAuthority::displayNames($r->authority, $authMap);
        });
        $dd->each(function ($r) use ($authMap) {
            $r->authority_list = ClmAuthority::displayNamesList($r->authority, $authMap);
            $r->authority      = ClmAuthority::displayNames($r->authority, $authMap);
        });
        $tl->each(function ($r) use ($authMap) {
            $r->authority_list = ClmAuthority::displayNamesList($r->authority, $authMap);
            $r->authority      = ClmAuthority::displayNames($r->authority, $authMap);
        });
        $qc->each(function ($r) use ($authMap) {
            $r->authority_list = ClmAuthority::displayNamesList($r->issued_by, $authMap);
            $r->issued_by      = ClmAuthority::displayNames($r->issued_by, $authMap);
        });

        return response()->json([
            'status' => true,
            'data'   => [
                'segments'    => $segments,
                'authorities' => $authorities,
                'kyc'         => $kyc,
                'dd'          => $dd,
                'tl'          => $tl,
                'qc'          => $qc,
            ],
        ]);
    }

    private function resolveSegmentId($user, string $segmentCode): ?int
    {
        $q = ClmSegment::where('code', $segmentCode);
        MasterVisibility::applyReadScope($q, $user, $user->branch_id ?: null);
        return $q->value('id');
    }

    private function segmentStatusMismatch($user, array $data): ?\Illuminate\Http\JsonResponse
    {
        $q = ClmSegment::where('code', $data['segment_code']);
        MasterVisibility::applyReadScope($q, $user, $user->branch_id ?: null);
        $segment = $q->first(['name', 'regulatory_status']);
        if (!$segment) {
            $msg = "Segment {$data['segment_code']} was not found in your branch. Pick a segment from the list.";
            return response()->json(['status' => false, 'message' => $msg, 'errors' => ['segment_code' => [$msg]]], 422);
        }
        if ($segment->regulatory_status !== $data['regulatory_status']) {
            $label = $segment->regulatory_status === ClmSegment::REG_HIGHLY ? 'Highly Regulated' : 'Less Regulated';
            $msg = "{$segment->name} ({$data['segment_code']}) is {$label} — the rule's regulatory status must match the segment.";
            return response()->json(['status' => false, 'message' => $msg, 'errors' => ['regulatory_status' => [$msg]]], 422);
        }
        return null;
    }

    public function store(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $this->validatePayload($request);

        $existingQuery = ClmSegmentRule::query()
            ->where('segment_code', $data['segment_code'])
            ->where('document_type', $data['document_type']);
        MasterVisibility::applyReadScope($existingQuery, $user, $user->branch_id ?: null);
        $existing = $existingQuery->first();
        if ($existing) {
            $typeLabel = ucfirst($data['document_type']);
            return response()->json([
                'status'   => false,
                'message'  => "A {$typeLabel} rule already exists for segment {$data['segment_code']} ({$existing->rule_code}). Edit the existing rule instead.",
                'existing' => $existing,
            ], 409);
        }

        if ($bad = $this->segmentStatusMismatch($user, $data)) return $bad;

        $row = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = $this->nextRuleCode($user->client_id);

            $segmentId = $this->resolveSegmentId($user, $data['segment_code']);

            [$mand, $opt] = $this->countSelections($data['doc_selections']);

            return ClmSegmentRule::create([
                'client_id'         => $user->client_id,
                'branch_id'         => $user->branch_id,
                'segment_id'        => $segmentId,
                'segment_code'      => $data['segment_code'],
                'rule_code'         => $code,
                'regulatory_status' => $data['regulatory_status'],
                'document_type'     => $data['document_type'],
                'auths_json'        => $data['auths'] ?? [],
                'doc_selections'    => $data['doc_selections'],
                'mandatory_count'   => $mand,
                'optional_count'    => $opt,
                'created_by'        => $user->id,
                'updated_by'        => $user->id,
            ]);
        });

        MasterBundleCache::bump();

        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function update(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmSegmentRule::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }
        $data = $this->validatePayload($request);
        if ($bad = $this->segmentStatusMismatch($user, $data)) return $bad;
        $clashQuery = ClmSegmentRule::query()
            ->whereKeyNot($row->id)
            ->where('segment_code', $data['segment_code'])
            ->where('document_type', $data['document_type']);
        MasterVisibility::applyReadScope($clashQuery, $user, $user->branch_id ?: null);
        if ($clash = $clashQuery->first()) {
            $typeLabel = ucfirst($data['document_type']);
            return response()->json([
                'status'   => false,
                'message'  => "A {$typeLabel} rule already exists for segment {$data['segment_code']} ({$clash->rule_code}).",
                'existing' => $clash,
            ], 409);
        }

        [$mand, $opt] = $this->countSelections($data['doc_selections']);

        $row->update([
            'segment_code'      => $data['segment_code'],
            'segment_id'        => $this->resolveSegmentId($user, $data['segment_code']),
            'regulatory_status' => $data['regulatory_status'],
            'document_type'     => $data['document_type'],
            'auths_json'        => $data['auths'] ?? [],
            'doc_selections'    => $data['doc_selections'],
            'mandatory_count'   => $mand,
            'optional_count'    => $opt,
            'updated_by'        => $user->id,
        ]);

        MasterBundleCache::bump();

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function destroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmSegmentRule::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'delete')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }
        $row->delete();

        MasterBundleCache::bump();

        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    public function forSegment(Request $request, $segmentId)
    {
        $user = $request->user(); if (!$user) abort(401);
        $cid  = $user->client_id;
        if (!$cid) {
            return response()->json(['status' => false, 'message' => 'No tenant context'], 403);
        }

        $segQuery = ClmSegment::whereKey($segmentId);
        MasterVisibility::applyReadScope($segQuery, $user, $user->branch_id ?: null);
        $segment = $segQuery->first();

        $ruleQuery = ClmSegmentRule::query();
        MasterVisibility::applyReadScope($ruleQuery, $user, $user->branch_id ?: null);
        $segment
            ? $ruleQuery->where('segment_code', $segment->code)
            : $ruleQuery->whereRaw('1 = 0');

        $reqType = $request->query('document_type');
        if (in_array($reqType, ClmSegmentRule::DOC_TYPE_VALUES, true)) {
            $ruleQuery->where('document_type', $reqType);
        }
        $rule = $ruleQuery->first();

        $authMap = ClmAuthority::idNameMap($cid);

        $docBranch = $rule?->branch_id ?? $segment?->branch_id;
        $resolveCat = function (string $cat, string $modelClass) use ($rule, $cid, $authMap, $docBranch) {
            $sel = $rule?->doc_selections ?? [];
            $entries = $sel[$cat] ?? [];
            if (empty($entries) || !is_array($entries)) return [];
            $codes = array_keys($entries);
            $rows = \App\Support\SegmentGuard::branchCatalogue($modelClass::query(), $cid, $codes, $docBranch)
                ->get()->unique('code');
            return $rows->map(function ($r) use ($entries, $authMap) {
                $base = $r->only(['id', 'code', 'name', 'status']);
                foreach (['authority', 'expiry', 'validity', 'title', 'doc_type', 'purpose', 'party'] as $opt) {
                    if (array_key_exists($opt, $r->getAttributes())) {
                        $base[$opt] = $r->getAttribute($opt);
                    }
                }
                if (isset($base['authority'])) {
                    $base['authority_list'] = ClmAuthority::displayNamesList($base['authority'], $authMap);
                    $base['authority']      = ClmAuthority::displayNames($base['authority'], $authMap);
                }
                $base['requirement'] = $entries[$r->code] ?? 'O';
                return $base;
            })->values();
        };

        return response()->json([
            'status' => true,
            'data'   => [
                'rule' => $rule,
                'kyc'  => $resolveCat('kyc', ClmKycDocument::class),
                'dd'   => $resolveCat('dd',  ClmDdDocument::class),
                'tl'   => $resolveCat('tl',  ClmTradeLicense::class),
                'qc'   => $resolveCat('qc',  ClmQcDocument::class),
            ],
        ]);
    }

    private function validatePayload(Request $request): array
    {
        $data = $request->validate([
            'segment_code'      => 'required|string|max:16',
            'regulatory_status' => ['required', Rule::in(ClmSegmentRule::REG_VALUES)],
            'document_type'     => ['required', Rule::in(ClmSegmentRule::DOC_TYPE_VALUES)],
            'auths'             => 'nullable|array',
            'auths.*'           => 'string',
            'doc_selections'              => 'required|array',
            'doc_selections.kyc'          => 'nullable|array',
            'doc_selections.dd'           => 'nullable|array',
            'doc_selections.tl'           => 'nullable|array',
            'doc_selections.qc'           => 'nullable|array',
        ]);
        unset($data['doc_selections']['td']);
        return $data;
    }

    private function countSelections(array $sel): array
    {
        $mand = 0; $opt = 0;
        foreach (['kyc', 'dd', 'tl', 'qc'] as $cat) {
            foreach ($sel[$cat] ?? [] as $v) {
                if ($v === 'M') $mand++;
                elseif ($v === 'O') $opt++;
            }
        }
        return [$mand, $opt];
    }

    private function nextRuleCode(int $clientId): string
    {
        $codes = ClmSegmentRule::withoutGlobalScope('tenant')
            ->where('client_id', $clientId)->pluck('rule_code')->all();
        $maxN  = 0;
        $taken = [];
        foreach ($codes as $c) {
            if (preg_match('/^SR-(\d+)$/', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $maxN) $maxN = $n;
            }
            $taken[(string) $c] = true;
        }
        $n = $maxN;
        do {
            $n++;
            $code = sprintf('SR-%03d', $n);
        } while (isset($taken[$code]));
        return $code;
    }
}
