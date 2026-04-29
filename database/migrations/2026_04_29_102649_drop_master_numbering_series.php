<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::dropIfExists('master_numbering_series');

        // FKs on permissions and plan_modules cascade on delete, so removing
        // the module row also wipes any per-user grants and plan inclusions.
        DB::table('modules')->where('slug', 'master.numbering_series')->delete();
    }

    public function down(): void
    {
        // No-op: the Numbering Series master was retired. Re-creation is not
        // supported from this migration; restore from the legacy seeder if needed.
    }
};
