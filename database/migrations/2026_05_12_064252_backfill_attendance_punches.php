<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Backfill `attendance_punches` for legacy attendance rows.
 *
 * The original AttendanceController used a "one row per day with
 * check_in_at + check_out_at columns" model. After we refactored to the
 * multi-punch ledger, those legacy rows still had the parent timestamps
 * but zero child punch records — so the Employee Profile's Attendance tab
 * would correctly show "First In 11:31, Last Out 11:32" but "Punches: 0,
 * Worked: 0h 00m" + an empty timeline, which looked broken.
 *
 * This migration synthesizes a Check In / Check Out pair for any row that
 * has the parent timestamps but no children of the matching direction.
 * Idempotent — re-running is a no-op because the existence check skips
 * rows that already have a matching punch.
 */
return new class extends Migration {
    public function up(): void
    {
        $rows = DB::table('attendances')
            ->whereNull('deleted_at')
            ->where(function ($q) {
                $q->whereNotNull('check_in_at')->orWhereNotNull('check_out_at');
            })
            ->get();

        $now = now();
        $inserted = 0;

        foreach ($rows as $row) {
            // Skip if an 'in' punch already exists for this attendance.
            $hasIn = DB::table('attendance_punches')
                ->where('attendance_id', $row->id)
                ->where('direction', 'in')
                ->whereNull('deleted_at')
                ->exists();
            if (!$hasIn && $row->check_in_at) {
                DB::table('attendance_punches')->insert([
                    'attendance_id'  => $row->id,
                    'employee_id'    => $row->employee_id,
                    'punched_at'     => $row->check_in_at,
                    'direction'      => 'in',
                    'label'          => 'Check In',
                    'method'         => $row->check_in_method ?? 'face',
                    'match_distance' => $row->check_in_match_distance,
                    'ip'             => $row->check_in_ip,
                    'lat'            => $row->check_in_lat,
                    'lng'            => $row->check_in_lng,
                    'notes'          => 'Backfilled from legacy attendance row',
                    'created_at'     => $now,
                    'updated_at'     => $now,
                ]);
                $inserted++;
            }

            $hasOut = DB::table('attendance_punches')
                ->where('attendance_id', $row->id)
                ->where('direction', 'out')
                ->whereNull('deleted_at')
                ->exists();
            if (!$hasOut && $row->check_out_at) {
                DB::table('attendance_punches')->insert([
                    'attendance_id'  => $row->id,
                    'employee_id'    => $row->employee_id,
                    'punched_at'     => $row->check_out_at,
                    'direction'      => 'out',
                    'label'          => 'Check Out',
                    'method'         => $row->check_out_method ?? 'face',
                    'match_distance' => $row->check_out_match_distance,
                    'ip'             => $row->check_out_ip,
                    'lat'             => $row->check_out_lat,
                    'lng'             => $row->check_out_lng,
                    'notes'          => 'Backfilled from legacy attendance row',
                    'created_at'     => $now,
                    'updated_at'     => $now,
                ]);
                $inserted++;
            }
        }

        echo "Backfilled {$inserted} attendance_punches rows from legacy data.\n";
    }

    public function down(): void
    {
        // Only remove the rows this migration created so we don't wipe real
        // user punches if the migration is rolled back.
        DB::table('attendance_punches')
            ->where('notes', 'Backfilled from legacy attendance row')
            ->delete();
    }
};
