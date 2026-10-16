<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Who the handheld is working as.
 *
 * NOT created_by. That is the admin who added the device to the allow-list,
 * sitting at a desk, possibly months earlier. This is the person who logged in
 * ON the handheld to finish enrolling it, and it is the only identity a later
 * scan has: the floor does not log in again for every carton, so every
 * put-away that device confirms is authored by whoever stood there at
 * enrollment. Keeping the two apart is the difference between "who approved
 * this device" and "who moved this box".
 *
 * Nullable because devices enrolled before this column existed have no such
 * person; they fall back to created_by, which is at least a real user.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('scan_devices', function (Blueprint $table) {
            $table->unsignedBigInteger('enrolled_by')->nullable()->after('created_by');
            $table->timestamp('enrolled_at')->nullable()->after('enrolled_by');
            $table->index('enrolled_by');
        });
    }

    public function down(): void
    {
        Schema::table('scan_devices', function (Blueprint $table) {
            $table->dropIndex(['enrolled_by']);
            $table->dropColumn(['enrolled_by', 'enrolled_at']);
        });
    }
};
