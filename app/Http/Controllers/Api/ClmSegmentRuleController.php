<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmAuthority;
use App\Models\ClmDdDocument;
use App\Models\ClmKycDocument;
use App\Models\ClmQcDocument;
use App\Models\ClmSegment;
use App\Models\ClmSegmentRule;
use App\Models\ClmTradeDocLibrary;
use App\Models\ClmTradeLicense;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;


class ClmSegmentRuleController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $rows = $user->client_id
            ? ClmSegmentRule::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();
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

    /**
     * GET /clm/segment-rules/bootstrap — bundles every master the segment-rule
     * modal needs so it can render Stage 1 + Stage 2 without further fetches.
     */
    public function bootstrap(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $cid = $user->client_id;

        $segments    = $cid ? ClmSegment::where('client_id', $cid)->orderBy('id')->get() : collect();
        $authorities = $cid ? ClmAuthority::where('client_id', $cid)->orderBy('id')->get() : collect();
        $kyc         = $cid ? ClmKycDocument::where('client_id', $cid)->orderBy('id')->get() : collect();
        $dd          = $cid ? ClmDdDocument::where('client_id', $cid)->orderBy('id')->get() : collect();
        $tl          = $cid ? ClmTradeLicense::where('client_id', $cid)->orderBy('id')->get() : collect();
        $td          = $cid ? ClmTradeDocLibrary::where('client_id', $cid)->orderBy('id')->get() : collect();
        $qc          = $cid ? ClmQcDocument::where('client_id', $cid)->orderBy('id')->get() : collect();

        return response()->json([
            'status' => true,
            'data'   => [
                'segments'    => $segments,
                'authorities' => $authorities,
                'kyc'         => $kyc,
                'dd'          => $dd,
                'tl'          => $tl,
                'td'          => $td,
                'qc'          => $qc,
            ],
        ]);
    }

    public function store(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $this->validatePayload($request);

        // One rule per segment per tenant. If a rule already exists for this
        // segment_code, return 409 with the existing row so the frontend can
        // pivot the Add modal into Edit mode against it instead of creating
        // a duplicate. The composite (client_id, segment_code) is the only
        // guard — no DB-level UNIQUE because pre-existing duplicate data
        // would block the migration; application-layer is sufficient.
        $existing = ClmSegmentRule::where('client_id', $user->client_id)
            ->where('segment_code', $data['segment_code'])
            ->first();
        if ($existing) {
            return response()->json([
                'status'   => false,
                'message'  => "A rule already exists for segment {$data['segment_code']} ({$existing->rule_code}). Edit the existing rule instead.",
                'existing' => $existing,
            ], 409);
        }

        $row = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = $this->nextRuleCode($user->client_id);

            $segment = ClmSegment::where('client_id', $user->client_id)
                ->where('code', $data['segment_code'])->first();

            [$mand, $opt] = $this->countSelections($data['doc_selections']);

            return ClmSegmentRule::create([
                'client_id'         => $user->client_id,
                'segment_id'        => $segment?->id,
                'segment_code'      => $data['segment_code'],
                'rule_code'         => $code,
                'regulatory_status' => $data['regulatory_status'],
                'auths_json'        => $data['auths'] ?? [],
                'doc_selections'    => $data['doc_selections'],
                'mandatory_count'   => $mand,
                'optional_count'    => $opt,
                'created_by'        => $user->id,
                'updated_by'        => $user->id,
            ]);
        });

        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function update(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmSegmentRule::where('client_id', $user->client_id)->findOrFail($id);
        $data = $this->validatePayload($request);

        [$mand, $opt] = $this->countSelections($data['doc_selections']);

        $row->update([
            'segment_code'      => $data['segment_code'],
            'segment_id'        => ClmSegment::where('client_id', $user->client_id)->where('code', $data['segment_code'])->value('id'),
            'regulatory_status' => $data['regulatory_status'],
            'auths_json'        => $data['auths'] ?? [],
            'doc_selections'    => $data['doc_selections'],
            'mandatory_count'   => $mand,
            'optional_count'    => $opt,
            'updated_by'        => $user->id,
        ]);

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function destroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmSegmentRule::where('client_id', $user->client_id)->findOrFail($id);
        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    /**
     * GET /clm/segment-rules/for-segment/{segmentId}
     *
     * Resolve the segment-rule for a given segment plus the FULL document
     * master rows referenced by its doc_selections payload, so the consumer
     * forms (AddCustomer, AddConsignee, AddVendor) can pre-populate their
     * Stage-2 KYC / DD / Trade-Document lists without three extra fetches.
     *
     * Response shape — always 200 even when no rule exists, so the caller
     * can render an empty Stage 2 instead of having to swallow a 404:
     *   {
     *     "rule": null | { … },
     *     "kyc": [ { code, name, authority, requirement: 'M'|'O', … } ],
     *     "dd":  [ … ],
     *     "tl":  [ … ],
     *     "td":  [ … ],
     *     "qc":  [ … ]
     *   }
     */
    public function forSegment(Request $request, $segmentId)
    {
        $user = $request->user(); if (!$user) abort(401);
        $cid  = $user->client_id;
        if (!$cid) {
            return response()->json(['status' => false, 'message' => 'No tenant context'], 403);
        }

        $rule = ClmSegmentRule::where('client_id', $cid)
            ->where('segment_id', $segmentId)
            ->first();

        // Resolve a category's codes (from doc_selections) to the actual
        // master rows + stamp the M|O requirement so the frontend can render
        // each row as Mandatory / Optional in one pass.
        $resolveCat = function (string $cat, string $modelClass) use ($rule, $cid) {
            $sel = $rule?->doc_selections ?? [];
            $entries = $sel[$cat] ?? [];
            if (empty($entries) || !is_array($entries)) return [];
            $codes = array_keys($entries);
            $rows = $modelClass::query()
                ->where('client_id', $cid)
                ->whereIn('code', $codes)
                ->get();
            return $rows->map(function ($r) use ($entries) {
                // Each model has a slightly different shape — surface the
                // intersection plus everything from the row's attributes
                // so the frontend can pick whatever fields it wants.
                $base = $r->only(['id', 'code', 'name', 'status']);
                // Optional fields — present on some models only.
                foreach (['authority', 'expiry', 'validity', 'title', 'doc_type', 'purpose', 'party'] as $opt) {
                    if (array_key_exists($opt, $r->getAttributes())) {
                        $base[$opt] = $r->getAttribute($opt);
                    }
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
                'td'   => $resolveCat('td',  ClmTradeDocLibrary::class),
                'qc'   => $resolveCat('qc',  ClmQcDocument::class),
            ],
        ]);
    }

    private function validatePayload(Request $request): array
    {
        return $request->validate([
            'segment_code'      => 'required|string|max:16',
            'regulatory_status' => ['required', Rule::in(ClmSegmentRule::REG_VALUES)],
            'auths'             => 'nullable|array',
            'auths.*'           => 'string',
            'doc_selections'              => 'required|array',
            'doc_selections.kyc'          => 'nullable|array',
            'doc_selections.dd'           => 'nullable|array',
            'doc_selections.tl'           => 'nullable|array',
            'doc_selections.td'           => 'nullable|array',
            'doc_selections.qc'           => 'nullable|array',
        ]);
    }

    /**
     * Roll up the per-document Mandatory / Optional counts across all five
     * categories so the DCP listing table can render badges without re-parsing
     * the JSON for every row.
     */
    private function countSelections(array $sel): array
    {
        $mand = 0; $opt = 0;
        foreach (['kyc', 'dd', 'tl', 'td', 'qc'] as $cat) {
            foreach ($sel[$cat] ?? [] as $v) {
                if ($v === 'M') $mand++;
                elseif ($v === 'O') $opt++;
            }
        }
        return [$mand, $opt];
    }

    /**
     * Allocate the next per-tenant rule code (SR-NNN). Uses MAX(numeric
     * suffix) + 1 rather than count()+1 so a deleted rule in the middle of
     * the sequence doesn't make the next allocation reuse a rule_code that
     * still exists — which throws a unique-constraint violation on save.
     * Caller must already hold the client row lock.
     */
    private function nextRuleCode(int $clientId): string
    {
        $codes = ClmSegmentRule::where('client_id', $clientId)->pluck('rule_code')->all();
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
