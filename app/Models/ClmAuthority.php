<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\DB;

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

    public static function idNameMap(?int $clientId, ?array $onlyIds = null): array
    {
        if (!$clientId) return [];
        $q = static::where('client_id', $clientId);
        if ($onlyIds !== null) {
            $onlyIds = array_values(array_unique(array_filter(
                array_map('trim', $onlyIds),
                fn ($t) => $t !== '' && ctype_digit((string) $t)
            )));
            if (!$onlyIds) return [];
            $q->whereIn('id', $onlyIds);
        }
        return $q->pluck('name', 'id')->all();
    }

    public static function idsMatchingName(?int $clientId, string $term): array
    {
        $term = trim($term);
        if (!$clientId || $term === '') return [];
        return static::where('client_id', $clientId)
            ->where('name', 'ilike', '%' . $term . '%')
            ->pluck('id')->map(fn ($i) => (int) $i)->all();
    }

    public static function scopeStoredIdsIn($query, string $column, array $ids)
    {
        foreach ($ids as $id) {
            $query->orWhere($column, '~', '(^|,[[:space:]]*)' . (int) $id . '([[:space:]]*,|$)');
        }
        return $query;
    }

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

    public static function normalizeIds(?string $input, ?int $clientId): string
    {
        if ($input === null || trim($input) === '' || !$clientId) return '';

        $tokens = array_values(array_filter(
            array_map('trim', explode(',', $input)),
            fn ($t) => $t !== ''
        ));
        if (!$tokens) return '';

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

        $out = [];
        foreach ($tokens as $tok) {
            $id = $byId[$tok] ?? $byName[mb_strtolower($tok)] ?? null;
            if ($id !== null) $out[$id] = true;
        }
        return implode(', ', array_keys($out));
    }

    public static function canonicalIds(?string $stored): string
    {
        $ids = array_unique(array_filter(array_map('trim', explode(',', (string) $stored)), fn ($t) => $t !== ''));
        sort($ids, SORT_NATURAL);
        return implode(',', $ids);
    }

    public static function sameIdSet(?string $a, ?string $b): bool
    {
        return static::canonicalIds($a) === static::canonicalIds($b);
    }

    public static function storedContainsId(?string $stored, int $id): bool
    {
        if ($stored === null) return false;
        foreach (explode(',', $stored) as $tok) {
            if (trim($tok) === (string) $id) return true;
        }
        return false;
    }
}
