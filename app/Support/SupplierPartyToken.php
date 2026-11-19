<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Supplier Type → the "Applicable Party" token a CLM trade document or
 * agreement stores for it.
 *
 * The two vocabularies do not match as strings: a document stores
 * "Supplier-Soft Service" while the master row is named "Soft Service
 * Provider". The stored service_type + classification decide first, then
 * the name (rows created before that vocabulary), then `kind` as a last
 * resort for legacy per-company rows.
 *
 * Null means "unclassified": callers then keep the old behaviour and match
 * every Supplier-* document, so no supplier silently loses its documents.
 *
 * resources/js/utils/supplierPartyToken.ts is the frontend twin — keep the
 * two maps in step.
 */
class SupplierPartyToken
{
    public const MATERIAL = 'Supplier-Material / Goods';
    public const LOGISTICS = 'Supplier-FFD / Transporter';

    /** "service_type|classification" => token */
    private const BY_TAXONOMY = [
        'soft_digital|'                  => 'Supplier-Soft Service',
        'self_consumable|trackable'      => 'Supplier-Trackable',
        'self_consumable|consumable'     => 'Supplier-Consumable',
        'other_operational|professional' => 'Supplier-Professional',
        'other_operational|utility'      => 'Supplier-Utility',
        'other_operational|facility'     => 'Supplier-Facility',
        'other_operational|maintenance'  => 'Supplier-Maintenance',
        'other_operational|outsourcing'  => 'Supplier-Outsourcing',
    ];

    /** Normalised type name => token (rows with no taxonomy stored). */
    private const BY_NAME = [
        'material / goods'      => self::MATERIAL,
        'ffd / transporter'     => self::LOGISTICS,
        'logistic'              => self::LOGISTICS,
        'logistics'             => self::LOGISTICS,
        'soft service provider' => 'Supplier-Soft Service',
        'trackable services'    => 'Supplier-Trackable',
        'consumable services'   => 'Supplier-Consumable',
        'professional services' => 'Supplier-Professional',
        'utility services'      => 'Supplier-Utility',
        'facility services'     => 'Supplier-Facility',
        'maintenance services'  => 'Supplier-Maintenance',
        'outsourcing services'  => 'Supplier-Outsourcing',
    ];

    /** kind => token. "services" is deliberately absent: it spans several tokens. */
    private const BY_KIND = [
        'material'  => self::MATERIAL,
        'logistics' => self::LOGISTICS,
    ];

    /** Older party spellings a token replaced (see tradeDocParty.ts LEGACY_SUPPLIER). */
    private const LEGACY_MATERIAL = ['Supplier', 'Supplier-Material'];
    private const LEGACY_LOGISTICS = ['Supplier-Logistic'];
    private const LEGACY_SERVICES = ['Supplier-Services', 'Supplier-Tech', 'Supplier-Advisory', 'Supplier-Strategic Risk'];

    /** A master_vendor_types row (object or array) → token, or null when unclassified. */
    public static function forVendorType($type): ?string
    {
        if (!$type) return null;
        $type = (object) $type;

        $serviceType = trim((string) ($type->service_type ?? ''));
        if ($serviceType !== '') {
            $key = $serviceType . '|' . trim((string) ($type->classification ?? ''));
            if (isset(self::BY_TAXONOMY[$key])) return self::BY_TAXONOMY[$key];
        }

        $byName = self::forVendorTypeName($type->name ?? null);
        if ($byName) return $byName;

        return self::BY_KIND[strtolower(trim((string) ($type->kind ?? '')))] ?? null;
    }

    /** Type id → token. Only a global row or the caller's own company's row counts. */
    public static function forVendorTypeId(?int $typeId, ?int $clientId): ?string
    {
        if (!$typeId) return null;

        $row = DB::table('master_vendor_types')
            ->where('id', $typeId)
            ->where(function ($q) use ($clientId) {
                $q->whereNull('client_id');
                if ($clientId) $q->orWhere('client_id', $clientId);
            })
            ->first(['name', 'kind', 'service_type', 'classification']);

        return self::forVendorType($row);
    }

    /** Type name ("Material/ Goods", "Soft Service Provider", …) → token. */
    public static function forVendorTypeName(?string $name): ?string
    {
        $key = self::normalise($name);
        return $key === '' ? null : (self::BY_NAME[$key] ?? null);
    }

    /** Every lower-cased party token that counts as this token (for a CSV split in PHP). */
    public static function aliases(string $token): array
    {
        return array_map('strtolower', self::spellings($token));
    }

    /**
     * Lower-cased LIKE patterns matching any spelling as a whole CSV entry,
     * for use against LOWER(party). Whole-entry so the bare legacy "Supplier"
     * does not match every "Supplier-*" document.
     */
    public static function likePatterns(string $token): array
    {
        $out = [];
        foreach (self::aliases($token) as $a) {
            array_push($out, $a, "$a,%", "$a, %", "%,$a", "%, $a", "%,$a,%", "%, $a,%");
        }
        return array_values(array_unique($out));
    }

    /** Restricts a query on `party` to the documents of this token. */
    public static function applyToQuery($query, string $token, string $column = 'party'): void
    {
        $query->where(function ($w) use ($token, $column) {
            foreach (self::likePatterns($token) as $p) {
                $w->orWhereRaw("LOWER($column) LIKE ?", [$p]);
            }
        });
    }

    private static function spellings(string $token): array
    {
        if ($token === self::MATERIAL) return [$token, ...self::LEGACY_MATERIAL];
        if ($token === self::LOGISTICS) return [$token, ...self::LEGACY_LOGISTICS];
        if (in_array($token, self::BY_TAXONOMY, true)) return [$token, ...self::LEGACY_SERVICES];
        return [$token];
    }

    private static function normalise(?string $name): string
    {
        $s = strtolower(trim((string) $name));
        $s = preg_replace('/\s*\/\s*/', ' / ', $s);
        return preg_replace('/\s+/', ' ', $s);
    }
}
