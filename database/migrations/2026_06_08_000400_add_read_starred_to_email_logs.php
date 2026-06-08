<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Gmail-style state on each email row: read/unread (bold rows) and starred.
 * Trash is already covered by the table's soft-delete column.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('email_logs', function (Blueprint $table) {
            $table->boolean('is_read')->default(false)->index()->after('status');
            $table->boolean('is_starred')->default(false)->index()->after('is_read');
        });
    }

    public function down(): void
    {
        Schema::table('email_logs', function (Blueprint $table) {
            $table->dropColumn(['is_read', 'is_starred']);
        });
    }
};
