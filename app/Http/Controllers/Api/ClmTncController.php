<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmSegment;
use App\Models\ClmTncCategory;
use App\Models\ClmTncLibrary;
use App\Models\Product;
use App\Support\MasterVisibility;
use App\Support\SegmentGuard;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ClmTncController extends Controller
{
    public function categoriesIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
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
                'branch_id'  => $user->branch_id,
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

    public function libraryIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => true, 'data' => [], 'count' => 0]);
        }
        $query = ClmTncLibrary::query()
            ->where('scope', ClmTncLibrary::SCOPE_SEGMENT)
            ->orderBy('id', 'desc');
        MasterVisibility::applyReadScope($query, $user, $request->integer('branch_id') ?: null);
        $rows = $query->get();
        // Which documents use each entry, so the page can lock its delete - the same two checks
        // libraryDestroy refuses on (tncInUse: Quotations / PIs; proformaUsage: PIs / POs by code),
        // so a button that looks deletable never meets a 409.
        $usage = $this->proformaUsage($rows);
        foreach ($rows as $r) {
            $codes = $usage[(int) $r->id] ?? [];
            $byType = $this->tncInUse($r);
            $piCodes = count(array_filter($codes, fn ($c) => str_starts_with((string) $c, 'PI')));
            $count = max($byType['pi'], $piCodes) + $byType['quote'] + (count($codes) - $piCodes);
            $r->setAttribute('in_use', $count > 0);
            $r->setAttribute('used_count', $count);
            $r->setAttribute('used_in', array_slice($codes, 0, 5));
        }
        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    public function libraryStore(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $request->validate([
            'segment'    => 'nullable|string|max:1024',
            'regulatory' => 'nullable|string|max:16',
            'category'   => 'required|string|max:255',
            'content'    => 'nullable|string',
        ]);

        $data['party'] = '';

        if ($this->isNoteCategory($data['category'] ?? '')) {
            $data['segment'] = '';
            $data['regulatory'] = '';
        }

        if ($dup = $this->findDuplicate($user->client_id, $user->branch_id, $data['category'], $data['segment'] ?? null, null, $data['regulatory'] ?? null)) {
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
                'branch_id'  => $user->branch_id,
                'code'       => $code,
                'segment'    => $data['segment'] ?? 'General',
                'segment_ids' => $this->segmentIdsFor($user->client_id, $user->branch_id, $data['segment'] ?? '', $data['regulatory'] ?? 'highly'),
                'regulatory' => $data['regulatory'] ?? 'highly',
                'category'   => trim($data['category']),
                'scope'      => ClmTncLibrary::SCOPE_SEGMENT,
                'party'      => trim((string) ($data['party'] ?? '')),
                'content'    => $data['content'] ?? null,
                'created_by' => $user->id,
                'updated_by' => $user->id,
            ]);
        });
        return response()->json(['status' => true, 'data' => $row->makeHidden('content')], 201);
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
            'segment'    => 'nullable|string|max:1024',
            'regulatory' => 'nullable|string|max:16',
            'category'   => 'sometimes|required|string|max:255',
            'content'    => 'nullable|string',
        ]);
        $data['updated_by'] = $user->id;
        $data['party'] = '';
        if ($this->isNoteCategory($data['category'] ?? $row->category)) {
            $data['segment'] = '';
            $data['regulatory'] = '';
        }

        $effCategory = $data['category'] ?? $row->category;
        $effSegment  = array_key_exists('segment', $data) ? $data['segment'] : $row->segment;
        $effRegulatory = array_key_exists('regulatory', $data) ? $data['regulatory'] : $row->regulatory;
        if ($dup = $this->findDuplicate($row->client_id, $row->branch_id, $effCategory, $effSegment, $row->id, $effRegulatory)) {
            return response()->json([
                'status'  => false,
                'message' => 'A Terms & Conditions entry already exists for this segment and document category (' . $dup->code . ').',
                'errors'  => ['category' => ['This segment already has a "' . trim((string) $effCategory) . '" entry.']],
            ], 422);
        }
        $data['segment_ids'] = $this->segmentIdsFor($row->client_id, $row->branch_id, $effSegment, $effRegulatory);
        $row->update($data);
        return response()->json(['status' => true, 'data' => $row->fresh()->makeHidden('content')]);
    }

    private function segmentIdsFor(?int $clientId, ?int $branchId, ?string $segmentCsv, ?string $regulatory): ?array
    {
        $names = \App\Support\SegmentGuard::names($segmentCsv);
        if (!$names || trim((string) $regulatory) === '') return null;
        return \App\Support\SegmentGuard::resolveIds($clientId, $branchId, $names, [], $regulatory) ?: null;
    }

    private function isNoteCategory(?string $name): bool
    {
        return in_array(mb_strtolower(trim((string) $name)), ['debit note', 'credit note'], true);
    }

    private function findDuplicate(int $clientId, ?int $branchId, ?string $category, ?string $segmentCsv, $ignoreId = null, ?string $regulatory = null): ?ClmTncLibrary
    {
        $cat = mb_strtolower(trim((string) $category));
        if ($cat === '' || $this->isNoteCategory($category)) return null;

        $incoming = $this->segmentTokens($segmentCsv);
        if (empty($incoming)) return null;

        $query = ClmTncLibrary::where('client_id', $clientId)
            ->whereRaw('LOWER(TRIM(category)) = ?', [$cat]);
        $branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id', $branchId);
        if ($ignoreId !== null) $query->where('id', '!=', $ignoreId);
        if ($regulatory !== null && $regulatory !== '') $query->whereRaw('LOWER(TRIM(regulatory)) = ?', [mb_strtolower(trim($regulatory))]);

        foreach ($query->get(['id', 'code', 'segment']) as $existing) {
            if (array_intersect($incoming, $this->segmentTokens($existing->segment))) {
                return $existing;
            }
        }
        return null;
    }

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

        // A segment-wise T&C is applied to a Quotation / PI whenever that document
        // has a line-item product in the T&C's segment (same match the PDF uses).
        // If any such document exists, the entry is in use and must not be deleted.
        $used = $this->tncInUse($row);
        if (($used['pi'] + $used['quote']) > 0) {
            $parts = [];
            if ($used['pi'])    $parts[] = $used['pi'] . ' Proforma Invoice' . ($used['pi'] === 1 ? '' : 's');
            if ($used['quote']) $parts[] = $used['quote'] . ' Quotation' . ($used['quote'] === 1 ? '' : 's');
            return response()->json([
                'status'  => false,
                'message' => 'These Terms & Conditions are in use by ' . implode(' and ', $parts)
                    . ' (a product in this segment is on those documents) and cannot be deleted. Set it to Inactive instead.',
            ], 409);
        }

        // Also printed on Purchase Orders (and PIs matched by Domestic / International type): an entry
        // in use on any of them stays, deleting it would silently change those documents.
        if ($row->scope === ClmTncLibrary::SCOPE_SEGMENT) {
            $codes = $this->proformaUsage(collect([$row]))[(int) $row->id] ?? [];
            if ($codes) {
                $n = count($codes);
                $list = implode(', ', array_slice($codes, 0, 3)) . ($n > 3 ? ' and ' . ($n - 3) . ' more' : '');
                return response()->json([
                    'status'  => false,
                    'message' => "This Terms & Conditions entry is used by {$n} document" . ($n === 1 ? '' : 's') . " ({$list}) and can't be deleted.",
                ], 409);
            }
        }
        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    /**
     * How many Quotations / Proforma Invoices a segment-wise T&C is used on.
     *
     * There is no stored link — the T&C renders onto a document when the
     * document has a line-item whose product sits in the T&C's segment, so the
     * usage is derived through: T&C segment(s) → products → document items.
     * Reuses SegmentGuard::tncMatches so this matches exactly what the PDF does.
     * Global / unscoped entries resolve to no segment and are left deletable.
     */
    private function tncInUse(ClmTncLibrary $row): array
    {
        $segIds = SegmentGuard::ids($row->segment_ids ?? []);
        if (!$segIds) {
            $segIds = ClmSegment::where('client_id', $row->client_id)
                ->get(['id', 'name', 'regulatory_status'])
                ->filter(fn ($s) => SegmentGuard::tncMatches($row, $s))
                ->pluck('id')->map(fn ($i) => (int) $i)->all();
        }
        if (!$segIds) return ['pi' => 0, 'quote' => 0];

        $productIds = Product::where('client_id', $row->client_id)
            ->whereIn('segment_id', $segIds)->pluck('id');
        if ($productIds->isEmpty()) return ['pi' => 0, 'quote' => 0];

        return [
            'pi'    => (int) DB::table('proforma_invoice_items')->whereIn('product_id', $productIds)->distinct()->count('proforma_invoice_id'),
            'quote' => (int) DB::table('quotation_items')->whereIn('product_id', $productIds)->distinct()->count('quotation_id'),
        ];
    }

    /**
     * Documents that print each segment-wise T&C entry: [entry id => [document code, …]].
     *
     * Neither a Proforma Invoice nor a Purchase Order stores which T&C it used - SalesPdfController
     * picks them while the PDF is built: fetchSegmentTncs for a PI (category "… Proforma Invoice"),
     * fetchPoTncs for a PO (category "… Purchase Order"), each from the document's Domestic /
     * International type and its items' product segments (SegmentGuard::tncMatches). This applies the
     * same rules. One query per document kind for every entry at once (document x item x product x
     * segment, distinct), matched in memory, so the list costs the same however many entries it holds.
     */
    private function proformaUsage(\Illuminate\Support\Collection $rows): array
    {
        $kinds = [
            // category keyword => [document table, items table, items fk, type column, type when blank / unrecognised]
            'proforma invoice' => ['proforma_invoices', 'proforma_invoice_items', 'proforma_invoice_id', 'doc_type', 'international'],
            'purchase order'   => ['p2p_purchase_orders', 'p2p_purchase_order_items', 'purchase_order_id', 'document_type', 'domestic'],
        ];
        $out = [];
        foreach ($kinds as $kw => [$docTable, $itemTable, $fk, $typeCol, $fallback]) {
            $mine = $rows->filter(fn ($r) => str_contains(mb_strtolower((string) $r->category), $kw));
            if ($mine->isEmpty()) continue;
            try {
                $q = DB::table("$docTable as d")
                    ->whereIn('d.client_id', $mine->pluck('client_id')->filter()->unique()->values()->all())
                    ->join("$itemTable as it", "it.$fk", '=', 'd.id')
                    ->join('products as p', 'p.id', '=', 'it.product_id')
                    ->join('clm_segments as s', 's.id', '=', 'p.segment_id')
                    ->select('d.client_id', 'd.code', "d.$typeCol as doc_type", 's.id as seg_id', 's.name as seg_name', 's.regulatory_status')
                    ->distinct();
                if (\Illuminate\Support\Facades\Schema::hasColumn($docTable, 'deleted_at')) $q->whereNull('d.deleted_at');
                $pairs = $q->get();
            } catch (\Throwable $e) {
                report($e);
                continue;
            }
            foreach ($mine as $t) {
                $want = str_contains(mb_strtolower((string) $t->category), 'domestic') ? 'domestic' : 'international';
                $codes = [];
                foreach ($pairs as $pr) {
                    if ((int) $pr->client_id !== (int) $t->client_id) continue;
                    $dt = mb_strtolower(trim((string) $pr->doc_type));
                    $type = str_contains($dt, 'international') ? 'international' : (str_contains($dt, 'domestic') ? 'domestic' : $fallback);
                    if ($type !== $want) continue;
                    if (isset($codes[$pr->code])) continue;
                    $seg = (object) ['id' => $pr->seg_id, 'name' => $pr->seg_name, 'regulatory_status' => $pr->regulatory_status];
                    if (\App\Support\SegmentGuard::tncMatches($t, $seg)) $codes[(string) $pr->code] = true;
                }
                if ($codes) $out[(int) $t->id] = array_merge($out[(int) $t->id] ?? [], array_keys($codes));
            }
        }
        return $out;
    }

    public function globalIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => true, 'data' => [], 'count' => 0]);

        $branchId = $request->integer('branch_id') ?: null;

        $cats = ClmTncCategory::query()->whereRaw("LOWER(TRIM(COALESCE(status, 'active'))) = 'active'");
        MasterVisibility::applyReadScope($cats, $user, $branchId);

        $rows = ClmTncLibrary::query()->where('scope', ClmTncLibrary::SCOPE_GLOBAL);
        MasterVisibility::applyReadScope($rows, $user, $branchId);
        $own = $branchId ?: ($user->branch_id ? (int) $user->branch_id : null);
        $byCategory = $rows->get()
            ->sortByDesc(fn ($r) => (int) ($own !== null && (int) $r->branch_id === $own))
            ->keyBy(fn ($r) => mb_strtolower(trim((string) $r->category)));

        $data = $cats->orderBy('id')->get(['id', 'code', 'name'])->map(function ($c) use ($byCategory) {
            $row = $byCategory->get(mb_strtolower(trim((string) $c->name)));
            return [
                'category_id'   => (int) $c->id,
                'category_code' => $c->code,
                'category'      => $c->name,
                'id'            => $row?->id,
                'code'          => $row?->code,
                'content'       => $row?->content,
                'status'        => $row?->status ?? 'active',
                'updated_at'    => $row?->updated_at?->toIso8601String(),
            ];
        })->values();

        return response()->json(['status' => true, 'data' => $data, 'count' => $data->count()]);
    }

    public function globalSave(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $request->validate([
            'category' => 'required|string|max:255',
            'content'  => 'nullable|string',
            'status'   => 'nullable|string|max:16',
        ], ['category.required' => 'Select the document category.']);

        $branchId = $user->branch_id ? (int) $user->branch_id : null;
        $row = ClmTncLibrary::query()
            ->where('scope', ClmTncLibrary::SCOPE_GLOBAL)
            ->where('client_id', $user->client_id)
            ->when($branchId !== null, fn ($q) => $q->where('branch_id', $branchId))
            ->when($branchId === null, fn ($q) => $q->whereNull('branch_id'))
            ->whereRaw('LOWER(TRIM(category)) = ?', [mb_strtolower(trim($data['category']))])
            ->first();

        if ($row) {
            if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
                return response()->json(['status' => false, 'message' => $msg], 403);
            }
            $row->update([
                'content'    => $data['content'] ?? null,
                'status'     => $data['status'] ?? $row->status ?? 'active',
                'updated_by' => $user->id,
            ]);
            return response()->json(['status' => true, 'data' => $row->makeHidden('content')]);
        }

        $known = ClmTncCategory::query()->whereRaw('LOWER(TRIM(name)) = ?', [mb_strtolower(trim($data['category']))]);
        MasterVisibility::applyReadScope($known, $user, $branchId);
        if (!$known->exists()) {
            return response()->json([
                'status'  => false,
                'message' => 'Pick one of the document categories — a global T&C belongs to a category.',
                'errors'  => ['category' => ['Unknown document category.']],
            ], 422);
        }

        $row = DB::transaction(function () use ($user, $data, $branchId) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            return ClmTncLibrary::create([
                'client_id'  => $user->client_id,
                'branch_id'  => $user->branch_id,
                'code'       => $this->nextCode(ClmTncLibrary::class, $user->client_id, $branchId, 'TNC-'),
                'segment'    => '',
                'segment_ids' => null,
                'regulatory' => '',
                'category'   => trim($data['category']),
                'scope'      => ClmTncLibrary::SCOPE_GLOBAL,
                'party'      => '',
                'content'    => $data['content'] ?? null,
                'status'     => $data['status'] ?? 'active',
                'created_by' => $user->id,
                'updated_by' => $user->id,
            ]);
        });
        return response()->json(['status' => true, 'data' => $row->makeHidden('content')], 201);
    }

    private function nextCode(string $modelClass, int $clientId, ?int $branchId, string $prefix): string
    {
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
