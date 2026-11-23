<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        $rows = DB::table('clm_trade_doc_library')->where('code', 'like', 'TD-%')->get(['id', 'code', 'client_id', 'branch_id']);
        foreach ($rows as $r) {
            if (!preg_match('/^TD-(\d+)$/', (string) $r->code, $m)) continue;
            $newCode = 'TDL-' . $m[1];

            $clash = DB::table('clm_trade_doc_library')
                ->where('client_id', $r->client_id)
                ->where('code', $newCode);
            $r->branch_id === null ? $clash->whereNull('branch_id') : $clash->where('branch_id', $r->branch_id);
            if ($clash->exists()) continue;

            DB::table('clm_trade_doc_library')->where('id', $r->id)->update(['code' => $newCode]);
        }
    }

    public function down(): void
    {
        $rows = DB::table('clm_trade_doc_library')->where('code', 'like', 'TDL-%')->get(['id', 'code', 'client_id', 'branch_id']);
        foreach ($rows as $r) {
            if (!preg_match('/^TDL-(\d+)$/', (string) $r->code, $m)) continue;
            $newCode = 'TD-' . $m[1];

            $clash = DB::table('clm_trade_doc_library')
                ->where('client_id', $r->client_id)
                ->where('code', $newCode);
            $r->branch_id === null ? $clash->whereNull('branch_id') : $clash->where('branch_id', $r->branch_id);
            if ($clash->exists()) continue;

            DB::table('clm_trade_doc_library')->where('id', $r->id)->update(['code' => $newCode]);
        }
    }
};
