<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

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
        DB::table('attendance_punches')
            ->where('notes', 'Backfilled from legacy attendance row')
            ->delete();
    }
};
