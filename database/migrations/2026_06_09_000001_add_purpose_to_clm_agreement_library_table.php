<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Agreement Purpose was only ever baked into the content HTML as a leading
     * paragraph, so it was never a first-class, editable field (it vanished on
     * re-open). Give it its own column — mirrors clm_trade_doc_library.purpose.
     */
    public function up(): void
    {
        Schema::table('clm_agreement_library', function (Blueprint $table) {
            if (!Schema::hasColumn('clm_agreement_library', 'purpose')) {
                $table->string('purpose', 1000)->nullable()->after('title');
            }
        });
    }

    public function down(): void
    {
        Schema::table('clm_agreement_library', function (Blueprint $table) {
            if (Schema::hasColumn('clm_agreement_library', 'purpose')) {
                $table->dropColumn('purpose');
            }
        });
    }
};
