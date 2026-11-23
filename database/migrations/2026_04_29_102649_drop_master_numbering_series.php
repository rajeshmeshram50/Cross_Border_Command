<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::dropIfExists('master_numbering_series');

        DB::table('modules')->where('slug', 'master.numbering_series')->delete();
    }

    public function down(): void
    {
    }
};
