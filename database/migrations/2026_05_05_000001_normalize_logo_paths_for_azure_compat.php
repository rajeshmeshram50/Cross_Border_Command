<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        $this->stripStoragePrefix('clients', 'logo');
        $this->stripStoragePrefix('clients', 'favicon');
        $this->stripStoragePrefix('branches', 'logo');
    }

    public function down(): void
    {
    }

    private function stripStoragePrefix(string $table, string $column): void
    {
        DB::table($table)
            ->where($column, 'like', '/storage/%')
            ->update([
                $column => DB::raw("substring({$column} from 10)"),
            ]);
    }
};
