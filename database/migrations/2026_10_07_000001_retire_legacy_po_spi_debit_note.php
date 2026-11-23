<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const LEGACY_SLUGS = ['p2p.po', 'p2p.spi', 'p2p.debit_note'];

    private const TABLES = [
        'debit_note_payments', 'debit_note_charges', 'debit_note_items', 'debit_notes', 'debit_note_types',
        'spi_payments', 'supplier_purchase_invoice_items', 'supplier_purchase_invoices',
        'po_payments', 'purchase_order_items', 'purchase_orders',
    ];

    public function up(): void
    {
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
    }
};
