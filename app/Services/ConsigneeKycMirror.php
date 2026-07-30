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

        // Isolate each mirror: a failure on one (e.g. a disk hiccup mid-copy)
        // must not abort the rest or bubble up and fail the customer's KYC
        // request — as this method's docblock promises.
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

    /**
     * Push the customer's ENTIRE profile into every same-as-customer
     * consignee — every shared core column AND the full address book
     * (primary + every secondary location) — so editing the customer keeps
     * the mirrored consignee in complete lock-step.
     *
     * Core fields are every column the two models share; the only customer
     * column with no consignee equivalent is `type`, so it's skipped.
     * Identity/ownership columns (ids, codes, customer_id, same_as_customer)
     * are intentionally NOT copied.
     *
     * Lightweight vs the KYC resync — it touches columns + address rows
     * only, never the documents/owners file copies (those have their own
     * resyncForCustomer), so a profile edit doesn't re-copy every KYC file.
     */
    public function syncCoreFromCustomer(Customer $customer, ?int $actingUserId = null): void
    {
        $mirrors = Consignee::query()
            ->where('customer_id', $customer->id)
            ->where('same_as_customer', true)
            ->get();

        if ($mirrors->isEmpty()) return;

        $customer->loadMissing('addresses');

        // Every core field shared with the consignee (customer's `type` is
        // the only one with no consignee column, so it's left out).
        $core = [
            'company_name'   => $customer->company_name,
            'legal_name'     => $customer->legal_name,
            'segment'        => $customer->segment,
            'classification' => $customer->classification,
            'risk_level'     => $customer->risk_level,
            'website'        => $customer->website,
            'primary_email'  => $customer->primary_email,
            'status'         => $customer->status,
        ];

        // The customer's FULL address book → consignee rows. Strip identity /
        // ownership / timestamp columns; keep everything else (incl.
        // `is_primary`) so the primary + secondary split is preserved.
        $addressRows = $customer->addresses->map(fn($a) => collect($a->getAttributes())
            ->except(['id', 'customer_id', 'consignee_id', 'created_at', 'updated_at'])
            ->all())->all();

        foreach ($mirrors as $consignee) {
            DB::transaction(function () use ($consignee, $core, $addressRows) {
                $consignee->update($core);

                // Replace ALL addresses (primary + secondary) — same
                // delete-and-recreate strategy the customer update uses.
                $consignee->addresses()->delete();
                foreach ($addressRows as $addr) {
                    ConsigneeAddress::create(array_merge($addr, ['consignee_id' => $consignee->id]));
                }
            });
        }
    }

    /**
     * Single-consignee resync — the public method splits per consignee
     * so each one gets its own transaction. A failure on one mirror
     * (e.g. disk hiccup mid-copy) doesn't abort the rest.
     */
    private function resyncOne(Customer $customer, Consignee $consignee, ?int $actingUserId): void
    {
        $disk = Storage::disk('public');

        // Collect the OLD physical files but do NOT delete them yet. The new
        // copies use fresh random names, so they never collide with these. We
        // only unlink the originals AFTER the transaction commits — otherwise a
        // mid-copy failure would roll back the DB rows but leave the evidence
        // files permanently deleted.
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
            // ── Wipe existing KYC rows (replace semantics; files unlinked post-commit) ──
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

        // Commit succeeded — now it's safe to unlink the superseded originals.
        // (If the transaction had thrown, these files are still intact.)
        foreach ($oldFiles as $old) {
            try {
                $disk->delete($old);
            } catch (\Throwable $e) { /* best-effort cleanup */
            }
        }
    }
}
