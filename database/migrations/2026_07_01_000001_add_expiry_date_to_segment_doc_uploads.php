<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('segment_doc_uploads')) {
            return;
        }
        if (Schema::hasColumn('segment_doc_uploads', 'expiry_date')) {
            return;
        }
        Schema::table('segment_doc_uploads', function (Blueprint $table) {
            $table->date('expiry_date')->nullable()->after('attachment_name');
        });
    }

    public function down(): void
    {
        if (Schema::hasColumn('segment_doc_uploads', 'expiry_date')) {
            Schema::table('segment_doc_uploads', function (Blueprint $table) {
                $table->dropColumn('expiry_date');
            });
        }
    }
};
