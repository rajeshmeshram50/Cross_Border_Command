<?php

namespace App\Services\P2p;

use App\Models\P2p\Service;
use App\Models\P2p\ServiceSupplier;
use App\Models\Vendor;
use App\Support\Gst;
use App\Support\MasterVisibility;
use App\Support\SupplierPricing;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Validation\ValidationException;

class ServiceSupplierMapping
{
    public const VENDOR_WITH = [
        'primaryAddress:id,vendor_id,country_id,state_id,state_code,city,contact_name,contact_no,email,designation',
        'primaryAddress.state:id,name',
        'primaryAddress.country:id,name',
        'vendorType:id,name,kind,service_type,classification',
    ];

    public const VENDOR_TYPE_BY_NAME = [
        'soft service provider' => ['soft_digital', null],
        'trackable services'    => ['self_consumable', 'trackable'],
        'consumable services'   => ['self_consumable', 'consumable'],
        'professional services' => ['other_operational', 'professional'],
        'utility services'      => ['other_operational', 'utility'],
        'facility services'     => ['other_operational', 'facility'],
        'maintenance services'  => ['other_operational', 'maintenance'],
        'outsourcing services'  => ['other_operational', 'outsourcing'],
    ];

    public function services($user, ?int $branchFilter = null, bool $withTrashed = false): Builder
    {
        $query = $withTrashed ? Service::withTrashed() : Service::query();

        if ($user && ($user->user_type ?? null) === 'employee') {
            MasterVisibility::applyBranchScope($query, $user);

            return $query;
        }

        MasterVisibility::applyReadScope($query, $user, $branchFilter);

        return $query;
    }

    public function serviceEditDenial($user, Service $service, string $action = 'edit'): ?string
    {
        if ($user && ($user->user_type ?? null) === 'employee'
            && (int) $user->client_id === (int) $service->client_id
            && $service->branch_id && (int) $user->branch_id === (int) $service->branch_id) {
            return null;
        }

        return MasterVisibility::hierarchicalDenial($user, $service, $action);
    }

    public function vendorServiceType($type): array
    {
        if (! $type) {
            return [null, null];
        }
        if ($type->service_type) {
            return [$type->service_type, $type->classification];
        }

        return self::VENDOR_TYPE_BY_NAME[mb_strtolower(trim((string) $type->name))] ?? [null, null];
    }

    public function assertServes(Vendor $vendor, Service $service, string $field = 'service_id'): void
    {
        $vendor->loadMissing('vendorType:id,name,kind,service_type,classification');
        $type = $vendor->vendorType;
        [$st, $cls] = $this->vendorServiceType($type);

        if ($st === $service->service_type && ($cls ?: null) === ($service->classification ?: null)) {
            return;
        }

        $typeName = $type?->name ?: 'no supplier type';
        $wanted = $service->classification_label ?: $service->service_type_label ?: $service->service_type;

        $message = match (true) {
            $type === null => 'Set this supplier\'s Supplier Type first — only a supplier whose type serves '.$wanted.' can be mapped to '.$service->code.'.',
            $st === null => 'A '.$typeName.' supplier cannot supply a service. Only a supplier whose type serves '.$wanted.' can be mapped to '.$service->code.'.',
            default => 'This supplier\'s type ('.$typeName.') does not serve '.$wanted.' — '.$service->code.' needs a '.$wanted.' supplier.',
        };

        throw ValidationException::withMessages([$field => [$message]]);
    }

    public function vendorCard(Vendor $v): array
    {
        $addr = $v->primaryAddress;
        $country = $addr?->country?->name;
        [$st, $cls] = $this->vendorServiceType($v->vendorType);

        return [
            'id' => $v->id,
            'vendor_code' => $v->vendor_code,
            'company_name' => $v->company_name,
            'status' => $v->status,
            'supplier_type' => $v->vendorType?->name,
            'supplier_service_type' => $st,
            'supplier_classification' => $cls,
            'origin' => SupplierPricing::originOf($country),
            'country' => $country ?: 'India',
            'state' => $addr?->state?->name ?? ($addr?->state_code ?: null),
            'gst_state_code' => $addr?->state_code ?: null,
            'city' => $addr?->city,
            'currency' => SupplierPricing::currencyFor($country),
            'contact_person' => $addr?->contact_name,
            'contact_no' => $addr?->contact_no,
        ];
    }

    public function priceFields($user, array $in, Service $service, string $prefix = ''): array
    {
        $vendor = Vendor::query()->with(self::VENDOR_WITH)->find($in['vendor_id']);
        $card = $vendor ? $this->vendorCard($vendor) : ['origin' => SupplierPricing::DOMESTIC, 'country' => null, 'currency' => 'INR'];
        $origin = $in['origin'] ?? $card['origin'];

        if ($origin !== $card['origin']) {
            throw ValidationException::withMessages([$prefix.'origin' => [
                $origin === SupplierPricing::INTERNATIONAL
                    ? 'This supplier is based in India — map it as a Domestic supplier.'
                    : 'This supplier is based in '.($card['country'] ?: 'another country').' — map it as an International supplier.',
            ]]);
        }

        if ($origin === SupplierPricing::INTERNATIONAL) {
            $currency = strtoupper((string) ($in['currency'] ?? '')) ?: $card['currency'];
            if ($currency === 'INR') {
                throw ValidationException::withMessages([$prefix.'currency' => ["Pick the supplier's currency — an International price is not in ₹."]]);
            }
            $rate = isset($in['exchange_rate']) && (float) $in['exchange_rate'] > 0
                ? (float) $in['exchange_rate']
                : SupplierPricing::defaultRate($currency, $user);
            if (! $rate) {
                throw ValidationException::withMessages([$prefix.'exchange_rate' => ["Enter the exchange rate (₹ per {$currency})."]]);
            }

            $amounts = SupplierPricing::international((float) $in['price'], $currency, $rate) + ['gst_id' => null];
            SupplierPricing::assertFits($amounts, $prefix);

            return $amounts;
        }

        if (! $service->gst_id) {
            throw ValidationException::withMessages([$prefix.'gst_id' => ['Map a GST % to this service first (Stage 1) — domestic suppliers use the service GST.']]);
        }
        if (! empty($in['gst_id']) && (int) $in['gst_id'] !== (int) $service->gst_id) {
            throw ValidationException::withMessages([$prefix.'gst_id' => [
                'The supplier GST must be the service GST ('.(float) $service->gst_percentage.'%, gst_id '.$service->gst_id.').',
            ]]);
        }

        $amounts = $this->domesticAmounts((float) $in['price'], $service);
        SupplierPricing::assertFits($amounts, $prefix);

        return $amounts;
    }

    public function domesticAmounts(float $price, Service $service): array
    {
        return array_intersect_key(
            SupplierPricing::domestic($price, (float) $service->gst_percentage),
            array_flip(['origin', 'currency_code', 'exchange_rate', 'price', 'gst_percentage', 'gst_amount', 'total_amount', 'inr_amount'])
        ) + ['gst_id' => $service->gst_id];
    }

    public function gstSplit(ServiceSupplier $m, ?array $card, $user): array
    {
        if (($m->origin ?: SupplierPricing::DOMESTIC) === SupplierPricing::INTERNATIONAL) {
            return ['gst_type' => SupplierPricing::GST_NONE, 'cgst_amount' => 0.0, 'sgst_amount' => 0.0, 'igst_amount' => 0.0];
        }

        $home = Gst::homeStateCode($user?->branch_id);
        $type = SupplierPricing::gstTypeFor($card['state'] ?? null, $card['gst_state_code'] ?? null, null, $home);
        $s = SupplierPricing::domestic((float) $m->price, (float) $m->gst_percentage, $type);

        return [
            'gst_type' => $s['gst_type'],
            'cgst_amount' => (float) $s['cgst_amount'],
            'sgst_amount' => (float) $s['sgst_amount'],
            'igst_amount' => (float) $s['igst_amount'],
        ];
    }

    public function upsert(Service $service, int $vendorId, array $fields, ?int $userId): ServiceSupplier
    {
        $map = ServiceSupplier::firstOrNew(['service_id' => $service->id, 'vendor_id' => $vendorId]);
        if (! $map->exists) {
            $map->created_by = $userId;
        }
        $map->fill($fields + ['status' => 'active', 'updated_by' => $userId])->save();

        return $map;
    }

    public function completeStageTwo(Service $service, ?int $userId): void
    {
        if ((int) $service->step_completed >= 2 && $service->status !== 'draft') {
            return;
        }
        $service->step_completed = max((int) $service->step_completed, 2);
        if ($service->status === 'draft') {
            $service->status = 'active';
        }
        $service->updated_by = $userId;
        $service->save();
    }
}
