<?php

namespace App\Support;

use App\Models\ClmSegment;
use Illuminate\Support\Facades\DB;

/**
 * Which CLM segments an Agreement / Trade Document library row belongs to.
 *
 * The libraries used to store their segments only as text ("Foods, Oil"), and
 * every screen matched that text against the segment's name or code. A renamed
 * segment, a stray space or a case difference silently dropped the documents,
 * and the screens did not all compare the text the same way, so their counts
 * could disagree. Rows now also carry `segment_ids`:
 *
 *   - a row WITH segment_ids matches a segment by id (rename-proof);
 *   - a row WITHOUT them (a name that matched no segment when the ids were
 *     filled in) keeps matching by name exactly as before, so nothing that
 *     matches today stops matching.
 *
 * The regulatory check is unchanged: the row's `regulatory` must equal the
 * segment's `regulatory_status`, as every caller already required.
 */
class LibrarySegments
{
    /** Lower-cased, trimmed, non-empty tokens of a "Foods, Oil" style list. */
    public static function tokens(?string $csv): array
    {
        $out = [];
        foreach (explode(',', (string) $csv) as $t) {
            $t = mb_strtolower(trim($t));
            if ($t !== '' && !in_array($t, $out, true)) $out[] = $t;
        }
        return $out;
    }

    /**
     * Segment ids for a library row, resolved branch-wise:
     *
     *   - a row with a branch looks only at that branch's segments plus the
     *     client-wide ones (no branch) - what a branch user's dropdown offers;
     *   - a row without a branch (created by a client admin) looks at all of
     *     the client's segments, as the admin's dropdown does.
     *
     * Every name (or code) in the text must resolve to exactly one segment in
     * that scope. If any name is missing there, or is ambiguous (two segments
     * with that name), nothing is stored: the row keeps segment_ids NULL and
     * goes on matching by name exactly as it always did.
     */
    public static function idsFor(?int $clientId, ?string $csv, ?int $branchId = null): array
    {
        $tokens = self::tokens($csv);
        if (!$tokens || !$clientId) return [];

        $segments = ClmSegment::withoutGlobalScopes()
            ->where('client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where(fn ($w) => $w->where('branch_id', $branchId)->orWhereNull('branch_id')))
            ->where(function ($q) use ($tokens) {
                $q->whereIn(DB::raw('LOWER(TRIM(name))'), $tokens)
                  ->orWhereIn(DB::raw('LOWER(TRIM(code))'), $tokens);
            })
            ->orderBy('id')
            ->get(['id', 'name', 'code']);

        $ids = [];
        foreach ($tokens as $t) {
            $hits = $segments->filter(fn ($s) => mb_strtolower(trim((string) $s->name)) === $t
                || mb_strtolower(trim((string) $s->code)) === $t);
            if ($hits->count() !== 1) return [];   // missing or ambiguous -> keep NULL
            $id = (int) $hits->first()->id;
            if (!in_array($id, $ids, true)) $ids[] = $id;
        }
        return $ids;
    }

    /** The ids stored on a library row (array cast, JSON string or null). */
    public static function rowIds($row): array
    {
        $ids = is_array($row) ? ($row['segment_ids'] ?? null) : ($row->segment_ids ?? null);
        if (is_string($ids)) $ids = json_decode($ids, true);
        return array_values(array_unique(array_filter(array_map('intval', (array) $ids))));
    }

    /** PHP-side check: does this library row belong to this segment? */
    public static function matches($row, $segment): bool
    {
        $regulatory = is_array($row) ? ($row['regulatory'] ?? null) : ($row->regulatory ?? null);
        if ((string) $regulatory !== (string) $segment->regulatory_status) return false;

        $ids = self::rowIds($row);
        if ($ids) return in_array((int) $segment->id, $ids, true);

        $csv = is_array($row) ? ($row['segment'] ?? null) : ($row->segment ?? null);
        $tokens = self::tokens($csv);
        foreach ([$segment->name, $segment->code] as $needle) {
            $needle = mb_strtolower(trim((string) $needle));
            if ($needle !== '' && in_array($needle, $tokens, true)) return true;
        }
        return false;
    }

    /**
     * Query-side version of matches(): restricts a library query (Eloquent or
     * DB::table) to the rows of one segment. The name fallback only applies to
     * rows that have no ids.
     */
    public static function scopeForSegment($query, $segment)
    {
        $id = (int) $segment->id;
        $needles = array_values(array_filter(array_map(
            fn ($n) => mb_strtolower(trim((string) $n)),
            [$segment->name, $segment->code]
        ), fn ($n) => $n !== ''));

        // Code deployed before its migration ran: no segment_ids column yet, so
        // match by name only (the old behaviour) instead of failing the query.
        $hasIds = self::hasIdsColumn($query);

        return $query
            ->where('regulatory', $segment->regulatory_status)
            ->where(function ($q) use ($id, $needles, $hasIds) {
                if ($hasIds) {
                    $q->whereRaw("(segment_ids IS NOT NULL AND segment_ids::jsonb @> ?::jsonb)", [json_encode([$id])]);
                }
                if (!$needles) {
                    if (!$hasIds) $q->whereRaw('1 = 0');
                    return;
                }
                $q->orWhere(function ($w) use ($needles, $hasIds) {
                    if ($hasIds) {
                        $w->where(fn ($n) => $n->whereNull('segment_ids')->orWhereRaw("segment_ids::jsonb = '[]'::jsonb"));
                    }
                    $w->where(function ($m) use ($needles) {
                          // Same token rule as tokens(): split on commas, trim, ignore case.
                          foreach ($needles as $n) {
                              $m->orWhereRaw(
                                  "? = ANY (SELECT LOWER(TRIM(t)) FROM unnest(string_to_array(COALESCE(segment, ''), ',')) AS t)",
                                  [$n]
                              );
                          }
                      });
                });
            });
    }

    /** Column list for a ->get([...]) on a library table, plus segment_ids once it exists. */
    public static function columns(string $table, array $cols): array
    {
        if (!in_array('segment_ids', $cols, true) && self::tableHasIds($table)) {
            $cols[] = 'segment_ids';
        }
        return $cols;
    }

    /** Whether the table has the segment_ids column yet (cached per request). */
    public static function tableHasIds(string $table): bool
    {
        return self::$hasIds[$table] ??= \Illuminate\Support\Facades\Schema::hasColumn($table, 'segment_ids');
    }

    /**
     * Model saving hook: when the segment text changes (and the caller did not
     * set the ids itself), store the ids of those segments with it.
     */
    public static function syncIdsOnSave(\Illuminate\Database\Eloquent\Model $m): void
    {
        if (!self::tableHasIds($m->getTable())) return;
        if (!$m->isDirty('segment') || $m->isDirty('segment_ids')) return;
        $ids = self::idsFor(
            $m->client_id ? (int) $m->client_id : null,
            $m->segment,
            $m->branch_id ? (int) $m->branch_id : null
        );
        $m->segment_ids = $ids ?: null;
    }

    /** @var array<string,bool> */
    private static array $hasIds = [];

    private static function hasIdsColumn($query): bool
    {
        $table = method_exists($query, 'getModel') ? $query->getModel()->getTable() : ($query->from ?? null);
        if (!is_string($table) || $table === '') return false;
        $table = trim(preg_replace('/\s+as\s+.*$/i', '', $table));
        return self::tableHasIds($table);
    }
}
