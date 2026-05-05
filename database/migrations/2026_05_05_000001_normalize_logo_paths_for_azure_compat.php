<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    /**
     * Normalize legacy "/storage/..." values stored in clients.logo,
     * clients.favicon, and branches.logo to plain disk-relative paths.
     *
     * Why: old code stored the full public URL (e.g.
     * "/storage/clients/logos/abc.png") so the SPA could use it directly.
     * The Azure-compatible flow stores only the relative path
     * ("clients/logos/abc.png") and resolves the URL at read time via
     * file_url() — that way the same DB row works against both the local
     * disk and Azure Blob.
     */
    public function up(): void
    {
        $this->stripStoragePrefix('clients', 'logo');
        $this->stripStoragePrefix('clients', 'favicon');
        $this->stripStoragePrefix('branches', 'logo');
    }

    public function down(): void
    {
        // Reverse not provided — re-prepending "/storage/" would break the
        // new file_url()-based resolver. If a rollback is ever needed,
        // restore from a DB backup taken before this migration.
    }

    private function stripStoragePrefix(string $table, string $column): void
    {
        DB::table($table)
            ->where($column, 'like', '/storage/%')
            ->update([
                $column => DB::raw("substring({$column} from 10)"), // drop leading "/storage/"
            ]);
    }
};
