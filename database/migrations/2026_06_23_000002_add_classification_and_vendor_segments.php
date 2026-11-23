<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vendors', function (Blueprint $table) {
            if (!Schema::hasColumn('vendors', 'classification_id')) {
                $table->foreignId('classification_id')
                    ->nullable()
                    ->after('compliance_behaviour_id')
                    ->constrained('master_customer_classifications')
                    ->nullOnDelete();
            }
        });

        Schema::create('vendor_segments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('vendor_id')->constrained('vendors')->cascadeOnDelete();
            $table->foreignId('segment_id')->constrained('clm_segments')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['vendor_id', 'segment_id']);
            $table->index('segment_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vendor_segments');

        Schema::table('vendors', function (Blueprint $table) {
            if (Schema::hasColumn('vendors', 'classification_id')) {
                $table->dropConstrainedForeignId('classification_id');
            }
        });
    }
};
