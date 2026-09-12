<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\DB;

/**
 * Central CLM → Authority master row.
 *
 * The CLM document masters (KYC / DD / Trade-License / QC) reference an
 * authority by its **id** (stored as a comma-joined list, since a document can
 * map to several authorities) and resolve the display name at read time — so
 * renaming an authority propagates automatically. The helpers below are the
 * single source of truth for converting between the stored id list and the
 * human-readable names, shared by every controller that touches the field.
 *
 * (The legacy vendor/customer document tables still store the authority by
 * name; those are kept in sync by ClmAuthorityController::cascadeRename.)
 */
class ClmAuthority extends Model
{
    public const STATUS_ACTIVE   = 'active';
    public const STATUS_INACTIVE = 'inactive';
    public const STATUSES        = [self::STATUS_ACTIVE, self::STATUS_INACTIVE];

    protected $fillable = [
        'client_id', 'branch_id', 'code', 'name', 'description', 'status',
        'created_by', 'updated_by',
    ];

    public function client(): BelongsTo { return $this->belongsTo(Client::class); }

    /**
     * Map of authority id (as string) => current name, for one tenant.
     *
     * Pass `$onlyIds` to fetch just the authorities a page actually references.
     * The document masters call this to resolve the names shown on ten rows,
     * and without it the whole authority table is loaded to do that — ~235 ms
     * on a tenant with 10k authorities, on every list request.
     * Omitting it keeps the original "whole tenant" behaviour, which the
     * segment-rule screen genuinely needs.
     */
    public static function idNameMap(?int $clientId, ?array $onlyIds = null): array
    {
        if (!$clientId) return [];
        $q = static::where('client_id', $clientId);
        if ($onlyIds !== null) {
            $onlyIds = array_values(array_unique(array_filter(
                array_map('trim', $onlyIds),
                fn ($t) => $t !== '' && ctype_digit((string) $t)
            )));
            // No referenced ids at all — skip the query rather than ask for none.
            if (!$onlyIds) return [];
            $q->whereIn('id', $onlyIds);
        }
        $map = [];
        foreach ($q->get(['id', 'name']) as $a) {
            $map[(string) $a->id] = $a->name;
        }
        return $map;
    }

    /**
     * Authority ids whose NAME matches a search term, for this tenant.
     *
     * The document masters let you search by authority name, but they store
     * the authority by id — so a server-side search has to resolve the term to
     * ids first and match those. Without this, moving search to SQL would
     * silently drop a capability the client-side filter had.
     */
    public static function idsMatchingName(?int $clientId, string $term): array
    {
        $term = trim($term);
        if (!$clientId || $term === '') return [];
        return static::where('client_id', $clientId)
            ->where('name', 'ilike', '%' . $term . '%')
            ->pluck('id')->map(fn ($i) => (int) $i)->all();
    }

    /**
     * A WHERE clause matching any of `$ids` as an exact token inside a
     * comma-joined id column.
     *
     * Token-anchored on purpose: a plain LIKE '%1%' also matches 10, 100 and
     * 21, so an authority search would return documents that reference a
     * completely different authority.
     */
    public static function scopeStoredIdsIn($query, string $column, array $ids)
    {
        foreach ($ids as $id) {
            $query->orWhere($column, '~', '(^|,[[:space:]]*)' . (int) $id . '([[:space:]]*,|$)');
        }
        return $query;
    }

    /** Every authority id referenced across a set of stored id lists. */
    public static function idsReferencedIn(iterable $storedValues): array
    {
        $ids = [];
        foreach ($storedValues as $v) {
            foreach (explode(',', (string) $v) as $tok) {
                $tok = trim($tok);
                if ($tok !== '') $ids[$tok] = true;
            }
        }
        return array_keys($ids);
    }

    /**
     * Resolve a stored authority value (comma-joined ids) to a comma-joined
     * display string of current names. Tokens that aren't a known id are passed
     * through unchanged so legacy/unmatched text never disappears.
     */
    public static function displayNames(?string $stored, array $idToName): string
    {
        if ($stored === null || trim($stored) === '') return '';
        $out = [];
        foreach (explode(',', $stored) as $tok) {
            $tok = trim($tok);
            if ($tok === '') continue;
            $out[] = $idToName[$tok] ?? $tok;
        }
        return implode(', ', $out);
    }

    /**
     * Like displayNames() but returns the resolved names as an ARRAY rather
     * than a comma-joined string. Use this wherever the consumer must count or
     * iterate the distinct authorities: a comma is NOT a safe delimiter to
     * split the joined string back on, because authority names themselves may
     * contain commas (e.g. "Aadhaar, Passport, Voter ID, Driving License").
     * Splitting the joined string would over-count each such authority.
     */
    public static function displayNamesList(?string $stored, array $idToName): array
    {
        if ($stored === null || trim($stored) === '') return [];
        $out = [];
        foreach (explode(',', $stored) as $tok) {
            $tok = trim($tok);
            if ($tok === '') continue;
            $out[] = $idToName[$tok] ?? $tok;
        }
        return $out;
    }

    /**
     * Normalize an incoming authority value (comma-joined ids and/or names) to
     * a canonical, de-duplicated comma-joined list of authority IDS for this
     * tenant. Names are matched case-insensitively; unknown tokens are dropped.
     *
     * Only the tokens ACTUALLY SUPPLIED are queried. This used to load every
     * authority for the client — `get(['id','name'])` over the whole table —
     * to resolve the one or two the user picked. On a tenant with 10k
     * authorities that was ~300 ms of the save, on a form where the answer is
     * two indexed lookups. It is called on every store() and every update()
     * of the KYC, DD, QC and Trade Licence masters, so it sat in the middle of
     * the reported 5–6 s saves.
     */
    public static function normalizeIds(?string $input, ?int $clientId): string
    {
        if ($input === null || trim($input) === '' || !$clientId) return '';

        $tokens = array_values(array_filter(
            array_map('trim', explode(',', $input)),
            fn ($t) => $t !== ''
        ));
        if (!$tokens) return '';

        // A token is either an id or a name; both forms are accepted because
        // the picker sends ids while imported/legacy payloads send names.
        $ids   = array_values(array_filter($tokens, fn ($t) => ctype_digit($t)));
        $names = array_values(array_filter($tokens, fn ($t) => !ctype_digit($t)));

        $byId = $byName = [];
        $q = static::where('client_id', $clientId)->where(function ($w) use ($ids, $names) {
            if ($ids)   $w->orWhereIn('id', $ids);
            if ($names) {
                $w->orWhereIn(
                    DB::raw('LOWER(TRIM(name))'),
                    array_map(fn ($n) => mb_strtolower(trim($n)), $names)
                );
            }
        });
        foreach ($q->get(['id', 'name']) as $a) {
            $byId[(string) $a->id] = (string) $a->id;
            $byName[mb_strtolower(trim($a->name))] = (string) $a->id;
        }

        // Input order is preserved and duplicates collapse, exactly as before.
        $out = [];
        foreach ($tokens as $tok) {
            $id = $byId[$tok] ?? $byName[mb_strtolower($tok)] ?? null;
            if ($id !== null) $out[$id] = true;
        }
        return implode(', ', array_keys($out));
    }

    /** True when authority id appears as an exact token in a stored id list. */
    public static function storedContainsId(?string $stored, int $id): bool
    {
        if ($stored === null) return false;
        foreach (explode(',', $stored) as $tok) {
            if (trim($tok) === (string) $id) return true;
        }
        return false;
    }
}
