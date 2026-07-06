<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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

    /** Map of authority id (as string) => current name, for one tenant. */
    public static function idNameMap(?int $clientId): array
    {
        if (!$clientId) return [];
        $map = [];
        foreach (static::where('client_id', $clientId)->get(['id', 'name']) as $a) {
            $map[(string) $a->id] = $a->name;
        }
        return $map;
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
     */
    public static function normalizeIds(?string $input, ?int $clientId): string
    {
        if ($input === null || trim($input) === '' || !$clientId) return '';
        $byId = []; $byName = [];
        foreach (static::where('client_id', $clientId)->get(['id', 'name']) as $a) {
            $byId[(string) $a->id] = (string) $a->id;
            $byName[mb_strtolower(trim($a->name))] = (string) $a->id;
        }
        $out = [];
        foreach (explode(',', $input) as $tok) {
            $tok = trim($tok);
            if ($tok === '') continue;
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
