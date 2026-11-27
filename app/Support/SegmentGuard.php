<?php

namespace App\Support;

use App\Models\ClmSegment;
use App\Models\ClmSegmentRule;
use App\Models\SegmentDocUpload;

class SegmentGuard
{
    public static function names(?string $segment): array
    {
        if (!$segment) return [];
        return array_values(array_filter(
            array_map('trim', explode(',', $segment)),
            fn ($s) => $s !== ''
        ));
    }

    public static function forCustomers(array $customerIds): string
    {
        $ids = array_values(array_filter(array_map('intval', $customerIds)));
        if (empty($ids)) return '';

        $names = [];
        $seen  = [];
        foreach (\App\Models\Customer::whereIn('id', $ids)->pluck('segment') as $raw) {
            foreach (self::names($raw) as $name) {
                $key = mb_strtolower($name);
                if (isset($seen[$key])) continue;
                $seen[$key] = true;
                $names[] = $name;
            }
        }
        return implode(', ', $names);
    }

    public static function segmentsWithUploads(string $uploadableType, int $uploadableId, int $clientId, array $segmentNames): array
    {
        $blocked = [];
        $ownerIds = self::ownerIds($uploadableType, $uploadableId);

        foreach ($segmentNames as $name) {
            $name = trim($name);
            if ($name === '') continue;

            $keys = self::docKeys($clientId, $name, $ownerIds);
            if (empty($keys)) continue;

            $hasUpload = SegmentDocUpload::query()
                ->where('uploadable_type', $uploadableType)
                ->where('uploadable_id', $uploadableId)
                ->where('client_id', $clientId)
                ->where(function ($q) use ($keys) {
                    foreach ($keys as $key) {
                        [$cat, $code] = explode('|', $key, 2);
                        $q->orWhere(fn ($w) => $w->where('category', $cat)->where('doc_code', $code));
                    }
                })
                ->exists();

            if ($hasUpload) $blocked[] = $name;
        }

        return $blocked;
    }

    public static function docKeys(int $clientId, string $segmentName, array $ownerIds = []): array
    {
        $name = trim($segmentName);
        if ($name === '') return [];

        $segIds = self::resolveIds($clientId, null, [$name], $ownerIds);
        if (!$segIds) return [];

        $keys = [];
        foreach (ClmSegmentRule::query()->where('client_id', $clientId)->whereIn('segment_id', $segIds)->pluck('doc_selections') as $sel) {
            $sel = is_array($sel) ? $sel : (json_decode((string) $sel, true) ?: []);
            foreach ($sel as $cat => $codes) {
                foreach (array_keys((array) $codes) as $code) {
                    $keys[] = $cat . '|' . (string) $code;
                }
            }
        }
        return array_values(array_unique($keys));
    }

    private static function ownerIds(string $uploadableType, int $uploadableId): array
    {
        if (!in_array($uploadableType, [\App\Models\Customer::class, \App\Models\Consignee::class], true)) return [];
        return self::idsOf($uploadableType::withoutGlobalScopes()->find($uploadableId));
    }

    public static function uploadedDocKeys(string $uploadableType, int $uploadableId, int $clientId): array
    {
        return SegmentDocUpload::query()
            ->where('uploadable_type', $uploadableType)
            ->where('uploadable_id', $uploadableId)
            ->where('client_id', $clientId)
            ->get(['category', 'doc_code'])
            ->map(fn ($r) => $r->category . '|' . $r->doc_code)
            ->unique()->values()->all();
    }

    public const PI_IGNORED = ['cancelled'];

    public const QT_IGNORED = ['cancelled'];

    public const PO_COMMITTED = ['submitted', 'sent for sign', 'signed', 'approved'];

    public const SPI_COMMITTED = ['mapped', 'grn_pending', 'closed'];

    public static function removedNames(?string $oldSegment, ?string $newSegment): array
    {
        $old = self::names($oldSegment);
        $new = array_map('mb_strtolower', self::names($newSegment));
        return array_values(array_filter($old, fn ($s) => !in_array(mb_strtolower($s), $new, true)));
    }

    public static function vendorLockSources(int $vendorId, int $clientId): array
    {
        $po = \Illuminate\Support\Facades\DB::table('p2p_purchase_orders as po')
            ->join('p2p_purchase_order_items as poi', 'poi.purchase_order_id', '=', 'po.id')
            ->join('products as p', 'p.id', '=', 'poi.product_id')
            ->join('clm_segments as cs', 'cs.id', '=', 'p.segment_id')
            ->where('po.client_id', $clientId)
            ->where('po.vendor_id', $vendorId)
            ->whereIn(\Illuminate\Support\Facades\DB::raw('LOWER(po.status)'), self::PO_COMMITTED)
            ->whereNull('po.deleted_at')
            ->distinct()
            ->pluck('cs.name')
            ->all();

        $spi = \Illuminate\Support\Facades\DB::table('p2p_supplier_invoices as spi')
            ->join('p2p_supplier_invoice_items as si', 'si.supplier_invoice_id', '=', 'spi.id')
            ->join('products as p', 'p.id', '=', 'si.product_id')
            ->join('clm_segments as cs', 'cs.id', '=', 'p.segment_id')
            ->where('spi.client_id', $clientId)
            ->where('spi.vendor_id', $vendorId)
            ->whereIn(\Illuminate\Support\Facades\DB::raw('LOWER(spi.status)'), self::SPI_COMMITTED)
            ->whereNull('spi.deleted_at')
            ->distinct()
            ->pluck('cs.name')
            ->all();

        return ['po' => array_values(array_unique($po)), 'spi' => array_values(array_unique($spi))];
    }

    public static function vendorCommittedDocument(int $vendorId, int $clientId): ?string
    {
        $po = \Illuminate\Support\Facades\DB::table('p2p_purchase_orders')
            ->where('client_id', $clientId)
            ->where('vendor_id', $vendorId)
            ->whereIn(\Illuminate\Support\Facades\DB::raw('LOWER(status)'), self::PO_COMMITTED)
            ->whereNull('deleted_at')
            ->exists();
        if ($po) return 'po';

        $spi = \Illuminate\Support\Facades\DB::table('p2p_supplier_invoices')
            ->where('client_id', $clientId)
            ->where('vendor_id', $vendorId)
            ->whereIn(\Illuminate\Support\Facades\DB::raw('LOWER(status)'), self::SPI_COMMITTED)
            ->whereNull('deleted_at')
            ->exists();
        if ($spi) return 'spi';

        return null;
    }

    public static function lockedSegmentNames(string $partyType, int $partyId, int $clientId): array
    {
        if ($partyType === \App\Models\Vendor::class) {
            $src = self::vendorLockSources($partyId, $clientId);
            return array_values(array_unique(array_merge($src['po'], $src['spi'])));
        }

        $partyCol = $partyType === \App\Models\Consignee::class ? 'consignee_id'
            : ($partyType === \App\Models\Customer::class ? 'customer_id' : null);
        if ($partyCol === null) return [];

        $piNames = \Illuminate\Support\Facades\DB::table('proforma_invoices as pi')
            ->join('proforma_invoice_items as pii', 'pii.proforma_invoice_id', '=', 'pi.id')
            ->join('products as p', 'p.id', '=', 'pii.product_id')
            ->join('clm_segments as cs', 'cs.id', '=', 'p.segment_id')
            ->where('pi.client_id', $clientId)
            ->where('pi.' . $partyCol, $partyId)
            ->where(function ($q) {
                $q->whereNotIn('pi.status', self::PI_IGNORED)
                  ->orWhereExists(function ($s) {
                      $s->selectRaw('1')->from('shipment_orders as so')->whereColumn('so.proforma_invoice_id', 'pi.id');
                  });
            })
            ->distinct()
            ->pluck('cs.name')
            ->all();

        $qtNames = \Illuminate\Support\Facades\DB::table('quotations as q')
            ->join('quotation_items as qi', 'qi.quotation_id', '=', 'q.id')
            ->join('products as p', 'p.id', '=', 'qi.product_id')
            ->join('clm_segments as cs', 'cs.id', '=', 'p.segment_id')
            ->where('q.client_id', $clientId)
            ->where('q.' . $partyCol, $partyId)
            ->whereNotIn('q.status', self::QT_IGNORED)
            ->distinct()
            ->pluck('cs.name')
            ->all();

        return array_values(array_unique(array_merge($piNames, $qtNames)));
    }

    public static function blockedByCompletedDocs(string $partyType, int $partyId, int $clientId, array $removedNames): array
    {
        $removed = array_values(array_filter(array_map('trim', $removedNames), fn ($s) => $s !== ''));
        if (empty($removed)) return [];
        $locked = array_map('mb_strtolower', self::lockedSegmentNames($partyType, $partyId, $clientId));
        if (empty($locked)) return [];
        return array_values(array_filter($removed, fn ($s) => in_array(mb_strtolower($s), $locked, true)));
    }

    public static function productMappingSegmentNames(string $partyType, int $partyId, int $clientId): array
    {
        if ($partyType === \App\Models\Vendor::class) {
            return \Illuminate\Support\Facades\DB::table('vendor_product_mappings as vpm')
                ->join('products as p', 'p.id', '=', 'vpm.product_id')
                ->join('clm_segments as cs', 'cs.id', '=', 'p.segment_id')
                ->where('vpm.vendor_id', $partyId)
                ->whereNull('vpm.deleted_at')
                ->whereNull('p.deleted_at')
                ->distinct()
                ->pluck('cs.name')
                ->all();
        }

        $leadCol = $partyType === \App\Models\Consignee::class ? 'consignee_id'
            : ($partyType === \App\Models\Customer::class ? 'customer_id' : null);
        if ($leadCol === null) return [];

        return \Illuminate\Support\Facades\DB::table('lead_products as lp')
            ->join('leads as l', 'l.id', '=', 'lp.lead_id')
            ->join('products as p', 'p.id', '=', 'lp.product_id')
            ->join('clm_segments as cs', 'cs.id', '=', 'p.segment_id')
            ->where('l.client_id', $clientId)
            ->where('l.' . $leadCol, $partyId)
            ->whereNull('l.deleted_at')
            ->whereNull('p.deleted_at')
            ->distinct()
            ->pluck('cs.name')
            ->all();
    }

    public static function blockedByProductMapping(string $partyType, int $partyId, int $clientId, array $removedNames): array
    {
        $removed = array_values(array_filter(array_map('trim', $removedNames), fn ($s) => $s !== ''));
        if (empty($removed)) return [];
        $used = array_map('mb_strtolower', self::productMappingSegmentNames($partyType, $partyId, $clientId));
        if (empty($used)) return [];
        return array_values(array_filter($removed, fn ($s) => in_array(mb_strtolower($s), $used, true)));
    }

    public static function blockedByOrphanDocs(string $uploadableType, int $uploadableId, int $clientId, array $removedNames, array $remainingNames): array
    {
        $ownerIds = self::ownerIds($uploadableType, $uploadableId);
        $removed = array_values(array_filter(array_map('trim', $removedNames), fn ($s) => $s !== ''));
        if (empty($removed)) return [];

        $keepKeys = [];
        foreach ($remainingNames as $name) {
            $keepKeys = array_merge($keepKeys, self::docKeys($clientId, trim((string) $name), $ownerIds));
        }
        $keepKeys = array_flip($keepKeys);

        $blocked = [];
        foreach ($removed as $name) {
            $orphan = array_values(array_filter(self::docKeys($clientId, $name, $ownerIds), fn ($k) => !isset($keepKeys[$k])));
            if (empty($orphan)) continue;
            $hasUpload = SegmentDocUpload::query()
                ->where('uploadable_type', $uploadableType)
                ->where('uploadable_id', $uploadableId)
                ->where('client_id', $clientId)
                ->where(function ($q) use ($orphan) {
                    foreach ($orphan as $key) {
                        [$cat, $code] = explode('|', $key, 2);
                        $q->orWhere(fn ($w) => $w->where('category', $cat)->where('doc_code', $code));
                    }
                })
                ->exists();
            if ($hasUpload) $blocked[] = $name;
        }
        return $blocked;
    }

    public static function orphanUploads(string $uploadableType, int $uploadableId, int $clientId, array $removedNames, array $remainingNames)
    {
        $ownerIds = self::ownerIds($uploadableType, $uploadableId);
        $removed = array_values(array_filter(array_map('trim', $removedNames), fn ($s) => $s !== ''));
        if (empty($removed)) return collect();

        $keepKeys = [];
        foreach ($remainingNames as $name) {
            $keepKeys = array_merge($keepKeys, self::docKeys($clientId, trim((string) $name), $ownerIds));
        }
        $keepKeys = array_flip($keepKeys);

        $orphanKeys = [];
        foreach ($removed as $name) {
            foreach (self::docKeys($clientId, $name, $ownerIds) as $k) {
                if (!isset($keepKeys[$k])) $orphanKeys[$k] = true;
            }
        }
        if (empty($orphanKeys)) return collect();

        return SegmentDocUpload::query()
            ->where('uploadable_type', $uploadableType)
            ->where('uploadable_id', $uploadableId)
            ->where('client_id', $clientId)
            ->where(function ($q) use ($orphanKeys) {
                foreach (array_keys($orphanKeys) as $key) {
                    [$cat, $code] = explode('|', $key, 2);
                    $q->orWhere(fn ($w) => $w->where('category', $cat)->where('doc_code', $code));
                }
            })
            ->get();
    }

    public static function ids($ids): array
    {
        if (is_string($ids)) $ids = json_decode($ids, true);
        return array_values(array_unique(array_filter(array_map('intval', (array) $ids))));
    }

    public static function namesFor(array $ids): string
    {
        $ids = self::ids($ids);
        if (!$ids) return '';
        $byId = ClmSegment::withoutGlobalScopes()->whereIn('id', $ids)->pluck('name', 'id');
        return implode(', ', array_values(array_filter(array_map(fn ($id) => trim((string) ($byId[$id] ?? '')), $ids))));
    }

    public static function resolveIds(?int $clientId, ?int $branchId, array $names, array $prefer = [], ?string $tier = null): array
    {
        $prefer = self::ids($prefer);
        $tier = mb_strtolower(trim((string) $tier));
        $preferByName = [];
        if ($prefer) {
            foreach (ClmSegment::withoutGlobalScopes()->whereIn('id', $prefer)->get(['id', 'name']) as $s) {
                $preferByName[mb_strtolower(trim($s->name))][] = (int) $s->id;
            }
        }
        $scope = ($clientId ?? 'n') . '|' . ($branchId ?? 'n') . '|' . $tier;
        self::$resolveMemo[$scope] ??= [];
        $memo = &self::$resolveMemo[$scope];

        $keys = [];
        foreach ($names as $name) {
            $key = mb_strtolower(trim((string) $name));
            if ($key !== '' && !isset($preferByName[$key]) && !array_key_exists($key, $memo)) {
                $keys[$key] = true;
            }
        }

        if ($keys) {
            $rows = ClmSegment::withoutGlobalScopes()
                ->whereIn(\Illuminate\Support\Facades\DB::raw('LOWER(TRIM(name))'), array_keys($keys))
                ->where(fn ($q) => $q->where('client_id', $clientId)->orWhereNull('client_id'))
                ->when($tier !== '', fn ($q) => $q->whereRaw('LOWER(TRIM(regulatory_status)) = ?', [$tier]))
                ->orderByRaw('CASE WHEN branch_id = ? THEN 0 WHEN branch_id IS NULL THEN 1 ELSE 2 END', [$branchId])
                ->orderBy('id')
                ->get(['id', 'name']);
            foreach ($rows as $r) {
                $k = mb_strtolower(trim((string) $r->name));
                if (!isset($memo[$k])) $memo[$k] = (int) $r->id;
            }
            foreach (array_keys($keys) as $k) $memo[$k] ??= null;
        }

        $out = [];
        foreach ($names as $name) {
            $key = mb_strtolower(trim((string) $name));
            if ($key === '') continue;
            $ids = $preferByName[$key] ?? (isset($memo[$key]) ? [$memo[$key]] : []);
            foreach ($ids as $id) if (!in_array($id, $out, true)) $out[] = $id;
        }
        return $out;
    }

    private static array $resolveMemo = [];

    public static function forgetResolved(): void
    {
        self::$resolveMemo = [];
    }

    public static function branchCatalogue($query, int $clientId, array $codes, ?int $branchId)
    {
        $query->where('client_id', $clientId)->whereIn('code', $codes);
        if ($branchId) {
            $query->where(fn ($q) => $q->where('branch_id', $branchId)->orWhereNull('branch_id'))
                ->orderByRaw('CASE WHEN branch_id IS NULL THEN 1 ELSE 0 END');
        }
        return $query->orderBy('id');
    }

    public static function tncMatches($tnc, $segment): bool
    {
        $ids = self::ids($tnc->segment_ids ?? []);
        if ($ids) return in_array((int) $segment->id, $ids, true);
        if (mb_strtolower(trim((string) $tnc->regulatory)) !== mb_strtolower(trim((string) $segment->regulatory_status))) return false;
        return in_array(mb_strtolower(trim((string) $segment->name)), array_map('mb_strtolower', self::names($tnc->segment)), true);
    }

    public static function idsOf($owner): array
    {
        if (!$owner) return [];
        $ids = self::ids($owner->segment_ids ?? []);
        if ($ids) return $ids;
        return self::resolveIds($owner->client_id ?? null, $owner->branch_id ?? null, self::names($owner->segment ?? null));
    }

    public static function idsForCustomers(array $customerIds): array
    {
        $out = [];
        foreach (\App\Models\Customer::whereIn('id', array_filter(array_map('intval', $customerIds)))->get() as $c) {
            foreach (self::idsOf($c) as $id) if (!in_array($id, $out, true)) $out[] = $id;
        }
        return $out;
    }

    public static function consigneeIds(array $customerIds, array $retainNames, $consignee): array
    {
        $ids = self::idsForCustomers($customerIds);
        if (!$retainNames) return $ids;
        $covered = array_map('mb_strtolower', self::names(self::namesFor($ids)));
        $missing = array_values(array_filter($retainNames, fn ($n) => !in_array(mb_strtolower(trim($n)), $covered, true)));
        if (!$missing) return $ids;
        $extra = self::resolveIds($consignee->client_id ?? null, $consignee->branch_id ?? null, $missing, self::ids($consignee->segment_ids ?? []));
        foreach ($extra as $id) if (!in_array($id, $ids, true)) $ids[] = $id;
        return $ids;
    }

    private static array $rowCache = [];

    public static function rowsFor(array $ids): array
    {
        $ids = self::ids($ids);
        if (!$ids) return [];
        $missing = array_values(array_filter($ids, fn ($id) => !array_key_exists($id, self::$rowCache)));
        if ($missing) {
            foreach ($missing as $id) self::$rowCache[$id] = null;
            foreach (ClmSegment::withoutGlobalScopes()->whereIn('id', $missing)->get(['id', 'code', 'name', 'regulatory_status']) as $s) {
                self::$rowCache[(int) $s->id] = ['id' => (int) $s->id, 'code' => $s->code, 'name' => $s->name, 'regulatory_status' => $s->regulatory_status];
            }
        }
        return array_values(array_filter(array_map(fn ($id) => self::$rowCache[$id] ?? null, $ids)));
    }

    public static function mergeRetained(?string $derivedSegment, array $retain): string
    {
        $names = self::names($derivedSegment);
        $seen  = array_map('mb_strtolower', $names);
        foreach ($retain as $name) {
            $name = trim($name);
            if ($name === '' || in_array(mb_strtolower($name), $seen, true)) continue;
            $names[] = $name;
            $seen[]  = mb_strtolower($name);
        }
        return implode(', ', $names);
    }
}
