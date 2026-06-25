<?php
/**
 * One-off generator: builds a PostgreSQL backfill script for ~4 months of
 * attendance for the 36 employees of client_id=10 / branch_id=27.
 *
 * Storage conventions (verified against the app):
 *   - DB is PostgreSQL.
 *   - check_in_at / check_out_at / punched_at are stored in UTC; the app
 *     renders them in Asia/Kolkata (IST = UTC+5:30).
 *   - attendance_date is the IST calendar date.
 *   - attendances has UNIQUE(employee_id, attendance_date) -> we use
 *     ON CONFLICT DO NOTHING so a re-run is safe.
 *
 * Run:  php docs/generate_attendance_backfill.php > docs/attendance_backfill.sql
 */

const CLIENT_ID = 10;
const BRANCH_ID = 27;

// Rolling 4-month window ending "yesterday" relative to 2026-06-25.
const START = '2026-02-25';
const END   = '2026-06-24';

// employee_id => EMP code (code only used for SQL comments / readability)
$employees = [
    109 => 'EMP-035', 108 => 'EMP-034', 107 => 'EMP-033', 104 => 'EMP-032',
    100 => 'EMP-031',  99 => 'EMP-030',  98 => 'EMP-029',  97 => 'EMP-028',
     96 => 'EMP-027',  94 => 'EMP-026',  93 => 'EMP-025',  92 => 'EMP-024',
     91 => 'EMP-023',  90 => 'EMP-022',  89 => 'EMP-021',  88 => 'EMP-020',
     87 => 'EMP-019',  86 => 'EMP-018',  85 => 'EMP-017',  84 => 'EMP-016',
     83 => 'EMP-015',  82 => 'EMP-014',  81 => 'EMP-013',  80 => 'EMP-012',
     79 => 'EMP-011',  78 => 'EMP-010',  77 => 'EMP-009',  76 => 'EMP-008',
     75 => 'EMP-007',  74 => 'EMP-006',  73 => 'EMP-005',  72 => 'EMP-004',
     71 => 'EMP-003',  70 => 'EMP-002',  69 => 'EMP-001',  68 => 'EMP-000',
];

$tz   = new DateTimeZone('Asia/Kolkata');
$utc  = new DateTimeZone('UTC');

/** Convert an IST "Y-m-d H:i:s" to a UTC SQL literal. */
function istToUtc(string $date, string $histime, DateTimeZone $tz, DateTimeZone $utc): string {
    $dt = new DateTime("$date $histime", $tz);
    $dt->setTimezone($utc);
    return $dt->format('Y-m-d H:i:s');
}

$ids = implode(',', array_keys($employees));

echo "-- Attendance backfill for client_id=" . CLIENT_ID . " branch_id=" . BRANCH_ID . "\n";
echo "-- Window: " . START . " .. " . END . " (weekdays Mon-Fri only)\n";
echo "-- Employees: " . count($employees) . "\n";
echo "-- Safe to re-run: attendances use ON CONFLICT DO NOTHING; punches guarded by NOT EXISTS.\n";
echo "BEGIN;\n\n";

$attRows = [];
$dayIdx  = 0;
$period  = new DatePeriod(new DateTime(START, $tz), new DateInterval('P1D'), (new DateTime(END, $tz))->modify('+1 day'));

foreach ($period as $day) {
    $dow = (int) $day->format('N'); // 1=Mon .. 7=Sun
    if ($dow >= 6) continue;        // skip Sat/Sun
    $date = $day->format('Y-m-d');
    $dayIdx++;

    foreach ($employees as $eid => $code) {
        $seed = $eid * 7 + $dayIdx;

        // Status mix: mostly Present, deterministic sprinkle of Absent/Leave/Late.
        $status = 'Present';
        $absent = (($eid + $dayIdx) % 23 === 0);
        $leave  = (($eid + $dayIdx) % 37 === 0);
        $late   = (($seed) % 11 === 0);
        if ($absent)      $status = 'Absent';
        elseif ($leave)   $status = 'Leave';
        elseif ($late)    $status = 'Late';

        if ($status === 'Absent' || $status === 'Leave') {
            // No punches / no times for these.
            $attRows[] = sprintf(
                "(%d,%d,%d,'%s',NULL,NULL,NULL,NULL,'%s',NULL,NOW(),NOW())",
                CLIENT_ID, BRANCH_ID, $eid, $date, $status
            );
            continue;
        }

        // Varied IST in/out times.
        $inMin  = $late ? (40 + $seed % 25) : (25 + $seed % 20);   // 09:25-09:44, late 09:40-10:04
        $inH    = 9 + intdiv($inMin, 60);
        $inM    = $inMin % 60;
        $outMin = 20 + ($seed % 30);                               // 18:20-18:49
        $inIst  = sprintf('%02d:%02d:00', $inH, $inM);
        $outIst = sprintf('18:%02d:00', $outMin);

        $inUtc  = istToUtc($date, $inIst,  $tz, $utc);
        $outUtc = istToUtc($date, $outIst, $tz, $utc);

        $attRows[] = sprintf(
            "(%d,%d,%d,'%s','%s','%s','manual','manual','%s',NULL,NOW(),NOW())",
            CLIENT_ID, BRANCH_ID, $eid, $date, $inUtc, $outUtc, $status
        );
    }
}

// --- attendances insert (chunked) ---
echo "INSERT INTO attendances\n";
echo "  (client_id, branch_id, employee_id, attendance_date, check_in_at, check_out_at, check_in_method, check_out_method, status, notes, created_at, updated_at)\nVALUES\n";
$chunks = array_chunk($attRows, 500);
$firstChunk = true;
echo implode(",\n", $attRows) . "\n";
echo "ON CONFLICT (employee_id, attendance_date) DO NOTHING;\n\n";

// --- punches: derive Check In + Check Out from the rows we just inserted ---
echo "-- Check In punches (direction in)\n";
echo "INSERT INTO attendance_punches (attendance_id, employee_id, punched_at, direction, label, method, created_at, updated_at)\n";
echo "SELECT a.id, a.employee_id, a.check_in_at, 'in', 'Check In', 'manual', NOW(), NOW()\n";
echo "FROM attendances a\n";
echo "WHERE a.client_id = " . CLIENT_ID . " AND a.branch_id = " . BRANCH_ID . "\n";
echo "  AND a.employee_id IN ($ids)\n";
echo "  AND a.attendance_date BETWEEN '" . START . "' AND '" . END . "'\n";
echo "  AND a.check_in_at IS NOT NULL\n";
echo "  AND NOT EXISTS (SELECT 1 FROM attendance_punches p WHERE p.attendance_id = a.id AND p.direction = 'in');\n\n";

echo "-- Check Out punches (direction out)\n";
echo "INSERT INTO attendance_punches (attendance_id, employee_id, punched_at, direction, label, method, created_at, updated_at)\n";
echo "SELECT a.id, a.employee_id, a.check_out_at, 'out', 'Check Out', 'manual', NOW(), NOW()\n";
echo "FROM attendances a\n";
echo "WHERE a.client_id = " . CLIENT_ID . " AND a.branch_id = " . BRANCH_ID . "\n";
echo "  AND a.employee_id IN ($ids)\n";
echo "  AND a.attendance_date BETWEEN '" . START . "' AND '" . END . "'\n";
echo "  AND a.check_out_at IS NOT NULL\n";
echo "  AND NOT EXISTS (SELECT 1 FROM attendance_punches p WHERE p.attendance_id = a.id AND p.direction = 'out');\n\n";

echo "COMMIT;\n";
echo "-- rows: " . count($attRows) . " attendances\n";
