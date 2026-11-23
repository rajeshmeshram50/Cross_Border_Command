<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') return;

        DB::statement('alter table credvault_credentials drop constraint if exists credvault_cred_vault_risk_check');
        DB::statement("alter table credvault_credentials add constraint credvault_cred_vault_risk_check check (vault = 'critical' or risk <> 'critical')");
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'pgsql') return;

        DB::statement('alter table credvault_credentials drop constraint if exists credvault_cred_vault_risk_check');
        DB::statement("alter table credvault_credentials add constraint credvault_cred_vault_risk_check check ((vault = 'critical') = (risk = 'critical'))");
    }
};
