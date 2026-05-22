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

/**
 * Central CLM → Document Control Panel · Segment Rule CRUD.
 *
 * One row per (segment × regulatory tier) configuration with the per-document
 * Mandatory/Optional matrix stored as JSON. See the migration header on
 * clm_segment_rules for the JSON shape.
 *
 * GET /clm/segment-rules/bootstrap returns every master collection the
 * Add-Segment-Rule modal needs in one round-trip so the frontend doesn't
 * have to chain 7 separate calls when opening the modal.
 */
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

        $row = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = sprintf('SR-%03d', ClmSegmentRule::where('client_id', $user->client_id)->count() + 1);

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
}
