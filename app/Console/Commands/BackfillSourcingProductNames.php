<?php

namespace App\Console\Commands;

use App\Models\P2p\SourcingProduct;
use App\Models\P2p\SourcingTarget;
use App\Models\Product;
use Illuminate\Console\Command;

class BackfillSourcingProductNames extends Command
{
    protected $signature = 'sourcing:backfill-product-names {--apply : Persist the fixes (omit for a dry run)}';

    protected $description = 'Re-resolve Bulk Sourcing master products that stored the product code instead of the name (name/segment/HSN + product_id)';

    public function handle(): int
    {
        $apply = (bool) $this->option('apply');

        $rows = SourcingProduct::where('source', 'master')->whereNull('product_id')->get();
        if ($rows->isEmpty()) {
            $this->info('Nothing to backfill — every master sourcing product already resolves.');
            return self::SUCCESS;
        }

        $this->info(($apply ? 'Applying' : 'DRY RUN — would fix') . " {$rows->count()} unresolved master sourcing product(s):");

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
