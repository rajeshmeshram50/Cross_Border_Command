<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmTncCategory;
use App\Models\ClmTncLibrary;
use App\Support\MasterVisibility;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;


class ClmTncController extends Controller
{
 

    public function categoriesIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        // The four standard categories are GLOBAL (client_id NULL) and show
        // for every tenant; a client's own custom categories are merged on top.
        // Branch-scoped read: branch users see globals + client-level rows +
        // their own branch's rows; sibling branches stay hidden.
        $query = ClmTncCategory::query()->orderBy('id');
        MasterVisibility::applyReadScope($query, $user, $request->integer('branch_id') ?: null);
        $rows = $query->get();
        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    public function categoriesStore(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $request->validate([
            'short_code' => 'required|string|max:12',
            'name'       => 'required|string|max:255',
        ]);

        $row = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = $this->nextCode(ClmTncCategory::class, $user->client_id, $user->branch_id, 'DC-');
            return ClmTncCategory::create([
                'client_id'  => $user->client_id,
                'branch_id'  => $user->branch_id,   // branch-owned; null for client-level users → shared
                'code'       => $code,
                'short_code' => strtoupper(trim($data['short_code'])),
                'name'       => trim($data['name']),
                'created_by' => $user->id,
                'updated_by' => $user->id,
            ]);
        });
        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function categoriesUpdate(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmTncCategory::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        $data = $request->validate([
            'short_code' => 'sometimes|required|string|max:12',
            'name'       => 'sometimes|required|string|max:255',
        ]);
        if (isset($data['short_code'])) $data['short_code'] = strtoupper(trim($data['short_code']));
        if (isset($data['name']))       $data['name']       = trim($data['name']);
        $data['updated_by'] = $user->id;
        $row->update($data);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function categoriesDestroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmTncCategory::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'delete')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }
        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    /* ── LIBRARY ── */

    public function libraryIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => true, 'data' => [], 'count' => 0]);
        }
        // Branch-scoped read (globals + client-level + own branch; siblings hidden).
        $query = ClmTncLibrary::query()->orderBy('id', 'desc');   // newest entry first
        MasterVisibility::applyReadScope($query, $user, $request->integer('branch_id') ?: null);
        $rows = $query->get();
        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    public function libraryStore(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $request->validate([
            // segment now holds a CSV (one for "highly", many for "less").
            // Debit/Credit Note documents carry NO segment/regulatory/party —
            // they're saved blank (rendered as "—" in the list), so regulatory
            // accepts an empty string and party is no longer required.
            'segment'    => 'nullable|string|max:1024',
            'regulatory' => 'nullable|string|max:16',
            'category'   => 'required|string|max:255',
            'party'      => 'nullable|string|max:255',
            'content'    => 'nullable|string',
        ]);

        // Debit/Credit Note documents carry NO segment/regulatory/party. Force
        // them blank HERE (not via the payload): Laravel's
        // ConvertEmptyStringsToNull middleware turns the frontend's '' into
        // null, so the "?? 'General'/'highly'" fallbacks below would otherwise
        // wrongly backfill them. Empty string keeps the NOT-NULL columns valid
        // and the list renders "—". Matched by category name.
        if ($this->isNoteCategory($data['category'] ?? '')) {
            $data['segment'] = '';
            $data['regulatory'] = '';
            $data['party'] = '';
        }

        // One Terms & Conditions entry per (segment, document category) within a
        // branch — e.g. "Tobacco + Proforma Invoice" can exist only once. A row
        // may scope many segments (CSV, for "less" regulatory), so any overlap
        // with an existing same-category row is a duplicate. (CBC #18)
        if ($dup = $this->findDuplicate($user->client_id, $user->branch_id, $data['category'], $data['segment'] ?? null)) {
            return response()->json([
                'status'  => false,
                'message' => 'A Terms & Conditions entry already exists for this segment and document category (' . $dup->code . ').',
                'errors'  => ['category' => ['This segment already has a "' . trim($data['category']) . '" entry.']],
            ], 422);
        }

        $row = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = $this->nextCode(ClmTncLibrary::class, $user->client_id, $user->branch_id, 'TNC-');
            return ClmTncLibrary::create([
                'client_id'  => $user->client_id,
                'branch_id'  => $user->branch_id,   // branch-owned; null for client-level users → shared
                'code'       => $code,
                // '' preserved (?? only catches null) so note docs stay blank.
                'segment'    => $data['segment'] ?? 'General',
                'regulatory' => $data['regulatory'] ?? 'highly',
                'category'   => trim($data['category']),
                'party'      => trim((string) ($data['party'] ?? '')),
                'content'    => $data['content'] ?? null,
                'created_by' => $user->id,
                'updated_by' => $user->id,
            ]);
        });
        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function libraryUpdate(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmTncLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        $data = $request->validate([
            // (see libraryStore) — keep the same relaxed rules on update.
            'segment'    => 'nullable|string|max:1024',
            'regulatory' => 'nullable|string|max:16',
            'category'   => 'sometimes|required|string|max:255',
            'party'      => 'sometimes|nullable|string|max:255',
            'content'    => 'nullable|string',
        ]);
        $data['updated_by'] = $user->id;
        // Same note-doc blanking as libraryStore (category may be omitted on a
        // partial update, so fall back to the row's current category).
        if ($this->isNoteCategory($data['category'] ?? $row->category)) {
            $data['segment'] = '';
            $data['regulatory'] = '';
            $data['party'] = '';
        }

        // Re-run the segment+category uniqueness guard against the row's OWN
        // branch, ignoring itself. Fall back to the stored values for whichever
        // of category/segment this partial update omits. (CBC #18)
        $effCategory = $data['category'] ?? $row->category;
        $effSegment  = array_key_exists('segment', $data) ? $data['segment'] : $row->segment;
        if ($dup = $this->findDuplicate($row->client_id, $row->branch_id, $effCategory, $effSegment, $row->id)) {
            return response()->json([
                'status'  => false,
                'message' => 'A Terms & Conditions entry already exists for this segment and document category (' . $dup->code . ').',
                'errors'  => ['category' => ['This segment already has a "' . trim((string) $effCategory) . '" entry.']],
            ], 422);
        }
        $row->update($data);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    /** Debit/Credit Note documents store no segment / regulatory / party. */
    private function isNoteCategory(?string $name): bool
    {
        return in_array(mb_strtolower(trim((string) $name)), ['debit note', 'credit note'], true);
    }

    /**
     * Find an existing T&C library row that collides with (segment, category)
     * for the given branch — the one-entry-per-segment-per-category rule (CBC
     * #18). Segment is a CSV (many segments for "less" regulatory rows), so a
     * collision is ANY same-category row whose segment set overlaps the incoming
     * one. Note-category docs carry no segment, so they're exempt. Scoped to the
     * SAME branch (T&C is branch-isolated — the same combo may exist per branch).
     */
    private function findDuplicate(int $clientId, ?int $branchId, ?string $category, ?string $segmentCsv, $ignoreId = null): ?ClmTncLibrary
    {
        $cat = mb_strtolower(trim((string) $category));
        if ($cat === '' || $this->isNoteCategory($category)) return null;

        $incoming = $this->segmentTokens($segmentCsv);
        if (empty($incoming)) return null;

        $query = ClmTncLibrary::where('client_id', $clientId)
            ->whereRaw('LOWER(TRIM(category)) = ?', [$cat]);
        $branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id', $branchId);
        if ($ignoreId !== null) $query->where('id', '!=', $ignoreId);

        foreach ($query->get(['id', 'code', 'segment']) as $existing) {
            if (array_intersect($incoming, $this->segmentTokens($existing->segment))) {
                return $existing;
            }
        }
        return null;
    }

    /** Normalise a segment CSV to a de-duplicated set of lowercased tokens. */
    private function segmentTokens(?string $csv): array
    {
        return array_values(array_unique(array_filter(array_map(
            fn ($s) => mb_strtolower(trim($s)),
            explode(',', (string) $csv)
        ), fn ($s) => $s !== '')));
    }

    public function libraryDestroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmTncLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'delete')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }
        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    /**
     * Allocate the next per-tenant code (DC-NNN / TNC-NNN). Uses MAX(numeric
     * suffix) + 1 rather than count()+1 so a deleted row in the middle of the
     * sequence doesn't make the next allocation reuse a code that still
     * exists — which throws a unique-constraint violation on save. Caller
     * must already hold the client row lock; the composite UNIQUE
     * (client_id, code) is the final guard.
     *
     * @param class-string<\Illuminate\Database\Eloquent\Model> $modelClass
     */
    private function nextCode(string $modelClass, int $clientId, ?int $branchId, string $prefix): string
    {
        // Branch-scoped so each branch restarts its own sequence from 001
        // (DC-001 / TNC-001) rather than continuing another branch's tally —
        // the T&C master is branch-isolated via MasterVisibility. A client-
        // level creator ($branchId null) sequences the shared rows.
        $query = $modelClass::where('client_id', $clientId);
        $branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id', $branchId);
        $codes = $query->pluck('code')->all();
        $maxN  = 0;
        $taken = [];
        $re    = '/^' . preg_quote($prefix, '/') . '(\d+)$/';
        foreach ($codes as $c) {
            if (preg_match($re, (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $maxN) $maxN = $n;
            }
            $taken[(string) $c] = true;
        }
        $n = $maxN;
        do {
            $n++;
            $code = sprintf('%s%03d', $prefix, $n);
        } while (isset($taken[$code]));
        return $code;
    }
}
