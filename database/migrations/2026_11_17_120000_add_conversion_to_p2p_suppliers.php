<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_suppliers', function (Blueprint $table) {
            if (! Schema::hasColumn('p2p_suppliers', 'origin')) {
                $table->string('origin', 16)->nullable()->after('city');
            }
            if (! Schema::hasColumn('p2p_suppliers', 'converted_vendor_id')) {
                $table->unsignedBigInteger('converted_vendor_id')->nullable()->index();
                $table->timestamp('converted_at')->nullable();
                $table->unsignedBigInteger('converted_by')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('p2p_suppliers', function (Blueprint $table) {
            foreach (['origin', 'converted_vendor_id', 'converted_at', 'converted_by'] as $c) {
                if (Schema::hasColumn('p2p_suppliers', $c)) {
                    $table->dropColumn($c);
                }
            }
        });
    }
};
