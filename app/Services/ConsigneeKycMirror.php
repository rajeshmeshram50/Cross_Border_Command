<?php

namespace App\Services;

use App\Models\Consignee;
use App\Models\ConsigneeAddress;
use App\Models\ConsigneeDocument;
use App\Models\ConsigneeOwner;
use App\Models\Customer;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class ConsigneeKycMirror
{
    public function resyncForCustomer(Customer $customer, ?int $actingUserId = null): void
    {
        $customer->loadMissing(['documents', 'owners']);

        $mirrors = Consignee::query()
            ->with(['documents', 'owners'])
            ->where('customer_id', $customer->id)
            ->where('same_as_customer', true)
            ->get();

        if ($mirrors->isEmpty()) return;

        foreach ($mirrors as $consignee) {
            try {
                $this->resyncOne($customer, $consignee, $actingUserId);
            } catch (\Throwable $e) {
                Log::warning('Consignee KYC mirror resync failed — continuing with the other mirrors', [
                    'customer_id'  => $customer->id,
                    'consignee_id' => $consignee->id,
                    'error'        => $e->getMessage(),
                ]);
            }
        }
    }

    public function syncCoreFromCustomer(Customer $customer, ?int $actingUserId = null): void
    {
        $mirrors = Consignee::query()
            ->where('customer_id', $customer->id)
            ->where('same_as_customer', true)
            ->get();

        if ($mirrors->isEmpty()) return;

        $customer->loadMissing('addresses');

        $core = [
            'company_name'   => $customer->company_name,
            'legal_name'     => $customer->legal_name,
            'classification' => $customer->classification,
            'risk_level'     => $customer->risk_level,
            'website'        => $customer->website,
            'primary_email'  => $customer->primary_email,
            'status'         => $customer->status,
        ];

        $addressRows = $customer->addresses->map(fn($a) => collect($a->getAttributes())
            ->except(['id', 'customer_id', 'consignee_id', 'created_at', 'updated_at'])
            ->all())->all();

        foreach ($mirrors as $consignee) {
            $custIds = $consignee->customers()->pluck('customers.id')->all() ?: [$customer->id];
            $core['segment']     = \App\Support\SegmentGuard::forCustomers($custIds) ?: null;
            $core['segment_ids'] = \App\Support\SegmentGuard::idsForCustomers($custIds) ?: null;
            DB::transaction(function () use ($consignee, $core, $addressRows) {
                $consignee->update($core);

                $consignee->addresses()->delete();
                foreach ($addressRows as $addr) {
                    ConsigneeAddress::create(array_merge($addr, ['consignee_id' => $consignee->id]));
                }
            });
        }
    }

    private function resyncOne(Customer $customer, Consignee $consignee, ?int $actingUserId): void
    {
        $disk = Storage::disk('public');

        $oldFiles = [];
        foreach ($consignee->documents as $d) {
            if ($d->attachment_path) $oldFiles[] = $d->attachment_path;
        }
        foreach ($consignee->owners as $o) {
            foreach (['id_proof_path', 'address_proof_path', 'photograph_path'] as $f) {
                if ($o->{$f}) $oldFiles[] = $o->{$f};
            }
        }

        DB::transaction(function () use ($customer, $consignee, $actingUserId, $disk) {
            $consignee->documents()->delete();
            $consignee->owners()->delete();

            foreach ($customer->documents as $doc) {
                $newPath = null;
                if ($doc->attachment_path && $disk->exists($doc->attachment_path)) {
                    $ext = pathinfo($doc->attachment_path, PATHINFO_EXTENSION) ?: 'bin';
                    $newPath = "consignee_documents/{$consignee->id}/cloned-" . bin2hex(random_bytes(6)) . ".{$ext}";
                    $disk->copy($doc->attachment_path, $newPath);
                }
                ConsigneeDocument::create([
                    'consignee_id'      => $consignee->id,
                    'kind'              => $doc->kind,
                    'name'              => $doc->name,
                    'license_number'    => $doc->license_number,
                    'issuing_authority' => $doc->issuing_authority,
                    'issue_date'        => $doc->issue_date,
                    'expiry_date'       => $doc->expiry_date,
                    'attachment_path'   => $newPath,
                    'description'       => $doc->description,
                    'status'            => $doc->status ?? 'Active',
                    'created_by'        => $actingUserId,
                ]);
            }

            $fileSlots = ['id_proof_path', 'address_proof_path', 'photograph_path'];
            foreach ($customer->owners as $owner) {
                $copies = [];
                foreach ($fileSlots as $slot) {
                    $copies[$slot] = null;
                    if ($owner->{$slot} && $disk->exists($owner->{$slot})) {
                        $ext = pathinfo($owner->{$slot}, PATHINFO_EXTENSION) ?: 'bin';
                        $slotLabel = str_replace('_path', '', $slot);
                        $newPath = "consignee_documents/{$consignee->id}/owner-clone-{$slotLabel}-" . bin2hex(random_bytes(6)) . ".{$ext}";
                        $disk->copy($owner->{$slot}, $newPath);
                        $copies[$slot] = $newPath;
                    }
                }
                ConsigneeOwner::create([
                    'consignee_id'       => $consignee->id,
                    'owner_name'         => $owner->owner_name,
                    'designation'        => $owner->designation,
                    'official_email'     => $owner->official_email,
                    'phone_number'       => $owner->phone_number,
                    'id_proof_path'      => $copies['id_proof_path'],
                    'address_proof_path' => $copies['address_proof_path'],
                    'photograph_path'    => $copies['photograph_path'],
                    'status'             => $owner->status ?? 'Active',
                    'created_by'         => $actingUserId,
                ]);
            }
        });

        foreach ($oldFiles as $old) {
            try {
                $disk->delete($old);
            } catch (\Throwable $e) {
            }
        }
    }
}
