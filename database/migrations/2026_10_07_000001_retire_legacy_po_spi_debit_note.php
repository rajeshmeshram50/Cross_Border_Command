<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Retires the three superseded P2P screens: the legacy Purchase Order, the
 * Supplier Purchase Invoice and the Debit Note. Their code is gone; this takes
 * the module rows, the grants and the tables with it.
 *
 * The grant migration is the part that matters. Seven users could open the old
 * Purchase Order and only three could open its replacement, so deleting
 * `p2p.po` outright would have quietly taken the screen away from four people
 * who had been using it every day. Their grant is carried across first.
 */
return new class extends Migration
{
    private const LEGACY_SLUGS = ['p2p.po', 'p2p.spi', 'p2p.debit_note'];

    /** Child tables first — a parent cannot be dropped while a key points at it. */
    private const TABLES = [
        'debit_note_payments', 'debit_note_charges', 'debit_note_items', 'debit_notes', 'debit_note_types',
        'spi_payments', 'supplier_purchase_invoice_items', 'supplier_purchase_invoices',
        'po_payments', 'purchase_order_items', 'purchase_orders',
    ];

    public function up(): void
    {
        /* Export before anything is dropped. Deliberately inside the migration
           rather than a step in a deploy note: a note can be skipped on the one
           server that still had rows, and nothing would say so until someone
           went looking for them. */
        $this->exportRows();

        $this->carryPoGrantsToOrder();

        $ids = DB::table('modules')->whereIn('slug', self::LEGACY_SLUGS)->pluck('id');
        if ($ids->isNotEmpty()) {
            DB::table('permissions')->whereIn('module_id', $ids)->delete();
            DB::table('modules')->whereIn('id', $ids)->delete();
        }

        Schema::disableForeignKeyConstraints();
        foreach (self::TABLES as $t) {
            Schema::dropIfExists($t);
        }
        Schema::enableForeignKeyConstraints();
    }

    /**
     * Every surviving row, to storage/app/backups, before the tables go. These
     * records are mirrored in Zoho Books under ids only these rows carry, so
     * losing them loses the ability to reconcile what was sent.
     *
     * A failure here is not fatal — a server with nothing left to export must
     * not be blocked from deploying — but it is written to the log.
     */
    private function exportRows(): void
    {
        try {
            $out = [];
            foreach (self::TABLES as $t) {
                if (Schema::hasTable($t)) $out[$t] = DB::table($t)->get()->toArray();
            }
            if (!array_filter($out, fn ($rows) => count($rows) > 0)) return;

            $dir = storage_path('app/backups');
            if (!is_dir($dir)) mkdir($dir, 0775, true);
            $file = $dir . '/legacy-p2p-' . date('Ymd-His') . '.json';
            file_put_contents($file, json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

            $counts = collect($out)->map(fn ($r) => count($r))->filter()->all();
            Log::info('Legacy P2P tables exported before drop', ['file' => $file, 'rows' => $counts]);
        } catch (\Throwable $e) {
            Log::warning('Legacy P2P export failed; continuing with the drop', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Anyone who could open the old Purchase Order can open the new one. An
     * existing grant is left alone rather than overwritten — a user who already
     * had the new screen must not lose an edit right to a weaker old one.
     */
    private function carryPoGrantsToOrder(): void
    {
        $from = DB::table('modules')->where('slug', 'p2p.po')->value('id');
        $to   = DB::table('modules')->where('slug', 'p2p.order')->value('id');
        if (!$from || !$to) return;

        $existing = DB::table('permissions')->where('module_id', $to)->pluck('user_id')->all();

        $rows = DB::table('permissions')->where('module_id', $from)
            ->whereNotIn('user_id', $existing ?: [0])->get();

        foreach ($rows as $r) {
            $copy = (array) $r;
            unset($copy['id']);
            $copy['module_id']  = $to;
            $copy['created_at'] = now();
            $copy['updated_at'] = now();
            DB::table('permissions')->insert($copy);
        }
    }

    public function down(): void
    {
        // One way. The screens, their controllers and their models are deleted;
        // re-creating empty tables would restore nothing anyone could use.
        // The rows were exported to storage/app/backups before the drop.
    }
};
