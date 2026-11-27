<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('candidates')
            ->whereNotNull('email')
            ->whereRaw('email <> LOWER(email)')
            ->update(['email' => DB::raw('LOWER(email)')]);
    }

    public function down(): void
    {
    }
};
