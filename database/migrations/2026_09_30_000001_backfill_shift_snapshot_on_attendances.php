<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;
use App\Models\Attendance;
use App\Models\Employee;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('attendances') || !Schema::hasColumn('attendances', 'shift_start')) {
            return;
        }

        $employees = [];

        Attendance::withTrashed()
            ->whereNull('shift_start')
            ->whereNull('shift_name')
            ->select(['id', 'employee_id'])
            ->chunkById(500, function ($rows) use (&$employees) {
                foreach ($rows as $row) {
                    $empId = (int) $row->employee_id;
                    if ($empId === 0) {
                        continue;
                    }
                    if (!array_key_exists($empId, $employees)) {
                        $employees[$empId] = Employee::withTrashed()
                            ->with('branch:id,shifts')
                            ->find($empId);
                    }
                    $emp = $employees[$empId];
                    if (!$emp) {
                        continue;
                    }

                    [$start, $end] = $emp->resolveShiftWindow();
                    $name = trim((string) ($emp->shift ?? '')) ?: null;
                    if ($start === null && $name === null) {
                        continue;
                    }

                    Attendance::withTrashed()->where('id', $row->id)->update([
                        'shift_name'  => $name,
                        'shift_start' => $start,
                        'shift_end'   => $end,
                    ]);
                }
            });
    }

    public function down(): void
    {
    }
};
