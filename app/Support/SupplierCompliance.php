<?php

namespace App\Support;

use App\Models\ClmAgreementLibrary;
use App\Models\ClmSegment;
use App\Models\ClmSegmentRule;
use App\Models\ClmSignatureRequest;
use App\Models\SegmentDocUpload;
use App\Models\Vendor;
use Illuminate\Support\Carbon;

class SupplierCompliance
{
    public const COMPLIANT     = 'Compliant';
    public const NON_COMPLIANT = 'Non Compliant';

    private const DOC_CATEGORIES = ['kyc', 'dd', 'tl', 'td'];

    private const CASE_CATEGORIES = ['td'];

    public static function statuses(array $vendorIds, int $clientId): array
    {
        $vendorIds = array_values(array_unique(array_map('intval', $vendorIds)));
        if (empty($vendorIds) || !$clientId) return [];

        $today = Carbon::today();

        $vendors = Vendor::query()
            ->whereIn('id', $vendorIds)
            ->with(['segments:id', 'primaryAddress:id,vendor_id,country_id', 'primaryAddress.country:id,name'])
            ->get(['id', 'segment_id']);

        $segIdsByVendor = [];
        $docTypeByVendor = [];
        foreach ($vendors as $v) {
            $ids = $v->segments->pluck('id')->map(fn ($x) => (int) $x)->unique()->values()->all();
            if (empty($ids) && $v->segment_id) $ids = [(int) $v->segment_id];
            $segIdsByVendor[$v->id] = $ids;

            $country = optional(optional($v->primaryAddress)->country)->name;
            $docTypeByVendor[$v->id] = trim((string) $country) === 'India' ? 'domestic' : 'international';
        }

        $rulesBySegment = [];
        foreach (ClmSegmentRule::where('client_id', $clientId)->get() as $rule) {
            $rulesBySegment[(int) $rule->segment_id][] = $rule;
        }

        $uploadsByVendor = [];
        SegmentDocUpload::query()
            ->where('uploadable_type', Vendor::class)
            ->whereIn('uploadable_id', $vendorIds)
            ->get(['uploadable_id', 'category', 'doc_code', 'expiry_date'])
            ->each(function ($u) use (&$uploadsByVendor) {
                $uploadsByVendor[(int) $u->uploadable_id][$u->category . '::' . $u->doc_code] = $u->expiry_date;
            });

        $allSegIds = collect($segIdsByVendor)->flatten()->unique()->values()->all();
        $agreementsBySegment = self::agreementLibrary($clientId, $allSegIds);
        $signedByVendor      = self::signedAgreements($clientId, $vendorIds);

        $hasPo = array_fill_keys(
            \Illuminate\Support\Facades\DB::table('p2p_purchase_orders')
                ->where('client_id', $clientId)
                ->whereIn('vendor_id', $vendorIds)
                ->whereNull('deleted_at')
                ->distinct()
                ->pluck('vendor_id')
                ->map(fn ($x) => (int) $x)
                ->all(),
            true
        );

        $out = [];
        foreach ($vendorIds as $vid) {
            $out[$vid] = self::evaluate(
                $segIdsByVendor[$vid] ?? [],
                $docTypeByVendor[$vid] ?? 'international',
                $rulesBySegment,
                $uploadsByVendor[$vid] ?? [],
                $agreementsBySegment,
                $signedByVendor[$vid] ?? [],
                $today,
                isset($hasPo[$vid])
            );
        }
        return $out;
    }

    public static function status(int $vendorId, int $clientId): string
    {
        return self::statuses([$vendorId], $clientId)[$vendorId] ?? self::COMPLIANT;
    }

    private static function evaluate(
        array $segIds,
        string $docType,
        array $rulesBySegment,
        array $uploads,
        array $agreementsBySegment,
        array $signed,
        Carbon $today,
        bool $hasCase
    ): string {
        $mandatory = [];
        foreach ($segIds as $sid) {
            $rules = $rulesBySegment[$sid] ?? [];
            if (empty($rules)) continue;
            $rule = null;
            foreach ($rules as $r) { if ($r->document_type === $docType) { $rule = $r; break; } }
            $rule = $rule ?? $rules[0];

            $sel = $rule->doc_selections ?? [];
            foreach (self::DOC_CATEGORIES as $cat) {
                if (!$hasCase && in_array($cat, self::CASE_CATEGORIES, true)) continue;
                $entries = $sel[$cat] ?? [];
                if (!is_array($entries)) continue;
                foreach ($entries as $code => $req) {
                    if ($req === 'M') $mandatory[$cat . '::' . $code] = true;
                }
            }
        }

        foreach (array_keys($mandatory) as $key) {
            if (!array_key_exists($key, $uploads)) return self::NON_COMPLIANT;
            $expiry = $uploads[$key];
            if ($expiry && Carbon::parse($expiry)->lt($today)) return self::NON_COMPLIANT;
        }

        foreach ($uploads as $expiry) {
            if ($expiry && Carbon::parse($expiry)->lt($today)) return self::NON_COMPLIANT;
        }

        if (!$hasCase) return self::COMPLIANT;
        foreach ($segIds as $sid) {
            foreach ($agreementsBySegment[$sid] ?? [] as $agrId) {
                if (!array_key_exists($agrId, $signed)) return self::NON_COMPLIANT;
                $exp = $signed[$agrId];
                if ($exp && Carbon::parse($exp)->lt($today)) return self::NON_COMPLIANT;
            }
        }

        return self::COMPLIANT;
    }

    private static function agreementLibrary(int $clientId, array $segIds): array
    {
        if (empty($segIds)) return [];

        $segments = ClmSegment::where('client_id', $clientId)->whereIn('id', $segIds)->get();
        if ($segments->isEmpty()) return [];

        $library = ClmAgreementLibrary::where('client_id', $clientId)
            ->where('agr_status', 'Active')
            ->get();
        if ($library->isEmpty()) return [];

        $bySegment = [];
        foreach ($segments as $seg) {
            $ids = [];
            foreach ($library as $row) {
                if ((string) $row->regulatory !== (string) $seg->regulatory_status) continue;
                if (!self::segmentMatches($row->segment, $seg->name, $seg->code)) continue;
                if (!self::supplierApplicable($row->party)) continue;
                $ids[] = (int) $row->id;
            }
            $bySegment[(int) $seg->id] = $ids;
        }
        return $bySegment;
    }

    private static function segmentMatches(?string $csv, ?string $name, ?string $code): bool
    {
        $tokens = array_filter(array_map(fn ($t) => strtolower(trim($t)), explode(',', (string) $csv)));
        foreach ([$name, $code] as $needle) {
            $needle = strtolower(trim((string) $needle));
            if ($needle !== '' && in_array($needle, $tokens, true)) return true;
        }
        return false;
    }

    private static function supplierApplicable(?string $party): bool
    {
        $tokens = array_filter(array_map(fn ($t) => strtolower(trim($t)), explode(',', (string) $party)));
        if (empty($tokens)) return true;
        foreach ($tokens as $t) {
            if ($t === 'supplier' || str_starts_with($t, 'supplier')) return true;
        }
        return false;
    }

    private static function signedAgreements(int $clientId, array $vendorIds): array
    {
        $rows = ClmSignatureRequest::query()
            ->where('client_id', $clientId)
            ->where('model_name', 'Vendor')
            ->where('document_type', ClmSignatureRequest::DOC_AGREEMENT)
            ->where('status', 'completed')
            ->whereIn('party_id', $vendorIds)
            ->orderBy('id')
            ->get(['id', 'party_id', 'trade_doc_id', 'trade_doc_ids', 'expiry_date']);

        $out = [];
        foreach ($rows as $r) {
            $ids = is_array($r->trade_doc_ids) && $r->trade_doc_ids ? $r->trade_doc_ids : [$r->trade_doc_id];
            foreach ((array) $ids as $id) {
                $id = (int) $id;
                if ($id) $out[(int) $r->party_id][$id] = $r->expiry_date;
            }
        }
        return $out;
    }
}
