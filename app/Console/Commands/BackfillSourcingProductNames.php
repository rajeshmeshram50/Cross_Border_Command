<?php

namespace App\Console\Commands;

use App\Models\P2p\SourcingProduct;
use App\Models\P2p\SourcingTarget;
use App\Models\Product;
use Illuminate\Console\Command;

/**
 * Repair Bulk Sourcing master products whose Product-Master link never resolved.
 *
 * When a master product is added to a sourcing target the frontend sends the
 * DISPLAY code (padded by SourcingController::padCode — "P-41" → "P-041"), but
 * older code looked the product up by the exact `product_code`. When the stored
 * code was unpadded the match missed, so the row was saved with the CODE as its
 * name and no segment / HSN (product_id left NULL). The controller now falls
 * back to matching the padded form, but rows created BEFORE that fix stay broken
 * and a NULL product_id can't be live-resolved on read — they need this one-time
 * backfill to re-resolve name / segment / HSN and set product_id.
 *
 *   php artisan sourcing:backfill-product-names          # dry run (report only)
 *   php artisan sourcing:backfill-product-names --apply  # write the fixes
 *
 * Idempotent: only touches master rows with a NULL product_id, and re-running
 * after a successful apply finds nothing left to do.
 */
class BackfillSourcingProductNames extends Command
{
    protected $signature = 'sourcing:backfill-product-names {--apply : Persist the fixes (omit for a dry run)}';

    protected $description = 'Re-resolve Bulk Sourcing master products that stored the product code instead of the name (name/segment/HSN + product_id)';

    public function handle(): int
    {
        $apply = (bool) $this->option('apply');

        // Only master rows that never linked to a product need repair.
        $rows = SourcingProduct::where('source', 'master')->whereNull('product_id')->get();
        if ($rows->isEmpty()) {
            $this->info('Nothing to backfill — every master sourcing product already resolves.');
            return self::SUCCESS;
        }

        $this->info(($apply ? 'Applying' : 'DRY RUN — would fix') . " {$rows->count()} unresolved master sourcing product(s):");

        // client_id lives on the target, not the product row.
        $targetClient = SourcingTarget::whereIn('id', $rows->pluck('sourcing_target_id')->unique())
            ->pluck('client_id', 'id');

        $fixed = 0;
        $skipped = 0;
        foreach ($rows as $r) {
            $clientId = $targetClient[$r->sourcing_target_id] ?? null;
            if (!$clientId || !$r->code) {
                $skipped++;
                $this->line("  ~ skip id={$r->id} (no client/code)");
                continue;
            }

            // Exact match first, then the padded-form fallback (mirrors
            // SourcingController::syncProducts).
            $prod = Product::where('client_id', $clientId)
                ->with(['segment:id,name', 'hsn:id,hsn_code'])
                ->where('product_code', $r->code)
                ->first();
            if (!$prod) {
                $prod = Product::where('client_id', $clientId)
                    ->with(['segment:id,name', 'hsn:id,hsn_code'])
                    ->get()
                    ->first(fn($x) => $this->padCode($x->product_code) === $r->code);
            }
            if (!$prod) {
                $skipped++;
                $this->line("  ~ no product for code={$r->code} (client {$clientId})");
                continue;
            }

            $name = $prod->name ?: $r->name;
            $seg  = $prod->segment->name ?? $r->segment;
            $hsn  = $prod->hsn->hsn_code ?? $r->hsn;

            if ($apply) {
                $r->product_id = $prod->id;
                $r->name       = $name;
                $r->segment    = $seg;
                $r->hsn        = $hsn;
                $r->save();
            }

            $fixed++;
            $this->line("  " . ($apply ? '+' : '·') . " id={$r->id} code={$r->code} -> name=\"{$name}\" segment=\"{$seg}\" hsn=\"{$hsn}\"");
        }

        $verb = $apply ? 'Fixed' : 'Would fix';
        $this->info("{$verb}: {$fixed}   skipped: {$skipped}");
        if (!$apply && $fixed > 0) {
            $this->warn('Dry run only — re-run with --apply to persist.');
        }

        return self::SUCCESS;
    }

    /**
     * Pad the trailing numeric run to 3 digits ("P-41" → "P-041"), matching
     * SourcingController::padCode so the two lookups agree.
     */
    private function padCode(?string $code): ?string
    {
        if (!$code) return $code;
        return preg_replace_callback(
            '/(\d+)$/',
            fn($m) => str_pad($m[1], 3, '0', STR_PAD_LEFT),
            $code,
        );
    }
}
