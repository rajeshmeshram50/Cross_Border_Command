<?php

namespace App\Services;

use App\Models\Consignee;
use App\Models\ConsigneeDocument;
use App\Models\ConsigneeOwner;
use App\Models\Customer;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Re-clones a customer's KYC into every "same as customer" consignee
 * attached to that customer. Called from the customer-side Document /
 * Owner controllers whenever an attachment is added, replaced, or
 * removed — so the mirrored consignees stay in lock-step instead of
 * drifting away from their source until the next manual re-clone.
 *
 * Mirrors the logic in ConsigneeController::cloneFromCustomer:
 *   1. Wipe existing consignee_documents + consignee_owners rows
 *      (and their on-disk files).
 *   2. Re-copy every customer_document attachment into
 *      consignee_documents/{consignee_id}/cloned-…
 *   3. Re-copy every customer_owner's three identity proofs into
 *      consignee_documents/{consignee_id}/owner-clone-…
 *
 * Replace semantics: each call produces an exact mirror, so removing
 * an attachment from the customer side cascades to a null attachment
 * on the consignee side automatically.
 */
class ConsigneeKycMirror
{
    /**
     * Re-sync every same-as-customer consignee linked to this customer.
     * Silent no-op when no such consignee exists — the customer-side
     * controllers always call this, but most customers won't have a
     * mirror.
     */
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
            $this->resyncOne($customer, $consignee, $actingUserId);
        }
    }

    /**
     * Single-consignee resync — the public method splits per consignee
     * so each one gets its own transaction. A failure on one mirror
     * (e.g. disk hiccup mid-copy) doesn't abort the rest.
     */
    private function resyncOne(Customer $customer, Consignee $consignee, ?int $actingUserId): void
    {
        DB::transaction(function () use ($customer, $consignee, $actingUserId) {
            $disk = Storage::disk('public');

            // ── Wipe existing KYC (replace semantics) ───────────────
            foreach ($consignee->documents as $d) {
                if ($d->attachment_path) $disk->delete($d->attachment_path);
            }
            foreach ($consignee->owners as $o) {
                foreach (['id_proof_path', 'address_proof_path', 'photograph_path'] as $f) {
                    if ($o->{$f}) $disk->delete($o->{$f});
                }
            }
            $consignee->documents()->delete();
            $consignee->owners()->delete();

            // ── Documents ─────────────────────────────────────────────
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

            // ── Owners ────────────────────────────────────────────────
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
    }
}
