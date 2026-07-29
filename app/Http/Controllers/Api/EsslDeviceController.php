<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DeviceTerminal;
use App\Services\EsslAttendanceImporter;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * eSSL / ZKTeco biometric terminal receiver — the ADMS / iclock "push" protocol
 * (Mode C). The device hard-codes the /iclock/* path at the web root and cannot
 * send an auth or CSRF token, so these routes are public (registered in
 * routes/web.php above the SPA catch-all, CSRF-exempt in bootstrap/app.php) and
 * are made tenant-safe by the device Serial (SN) → device_terminals registry:
 * an unknown or inactive serial is acknowledged but NOT ingested, and the
 * tenant is ALWAYS derived from the registered terminal, never from the body.
 *
 * Protocol (plain text over HTTP):
 *   GET  /iclock/cdata?SN=..&options=all   → handshake; reply the options block
 *   GET  /iclock/getrequest?SN=..          → poll for commands; reply "OK"
 *   POST /iclock/cdata?SN=..&table=ATTLOG  → punch upload; reply "OK: <n>"
 *
 * See docs/ESSL_ATTENDANCE_INTEGRATION.md §17, §26.
 */
class EsslDeviceController extends Controller
{
    public function cdata(Request $request, EsslAttendanceImporter $importer)
    {
        $sn = (string) $request->query('SN', '');
        $terminal = $sn !== '' ? DeviceTerminal::where('serial', $sn)->first() : null;

        // TEMP device-bring-up trace — logs exactly what the terminal sends so a
        // serial mismatch is visible. Safe to remove once the device is verified.
        Log::info('[eSSL] hit cdata', [
            'method' => $request->method(), 'sn' => $sn, 'matched' => (bool) $terminal,
            'table' => $request->query('table'), 'ip' => $request->ip(),
            'bytes' => strlen($request->getContent()),
        ]);

        if ($request->isMethod('post')) {
            $table = strtoupper((string) $request->query('table', ''));
            $body  = $request->getContent();

            if (!$terminal || !$terminal->is_active) {
                // Ack so the device doesn't loop, but do not ingest — an
                // unregistered serial has no tenant to attribute punches to.
                Log::warning('[eSSL] push from unregistered/inactive terminal', [
                    'sn' => $sn, 'table' => $table, 'bytes' => strlen($body),
                ]);
                return $this->plain('OK');
            }

            // Mode C hardening — reject a push from an IP not on the terminal's
            // allow-list (when one is configured). Ack so the device doesn't
            // loop, but do not ingest a potentially spoofed source.
            if (!$terminal->permitsIp($request->ip())) {
                Log::warning('[eSSL] push from disallowed IP', [
                    'sn' => $sn, 'ip' => $request->ip(), 'table' => $table,
                ]);
                return $this->plain('OK');
            }

            $terminal->forceFill(['last_seen_at' => now()])->save();

            if ($table === 'ATTLOG') {
                $rows = $this->parseAttlog($body);
                $summary = $importer->importForTerminal($terminal, $rows);
                Log::info('[eSSL] ATTLOG ingested', [
                    'sn'        => $sn,
                    'received'  => count($rows),
                    'imported'  => $summary['imported'],
                    'dupes'     => $summary['skipped_duplicates'],
                    'unmatched' => $summary['unmatched_user_ids'],
                ]);
                // The device expects the number of records it sent to be acked.
                return $this->plain('OK: ' . count($rows));
            }

            // OPERLOG (user edits), ATTPHOTO, etc. — acknowledge, not consumed yet.
            return $this->plain('OK');
        }

        // GET handshake / registration poll.
        if ($terminal) {
            $terminal->forceFill(['last_seen_at' => now()])->save();
        }
        return $this->plain($this->optionsBlock($sn));
    }

    /** The device polls this for queued commands; we have none. */
    public function getrequest(Request $request)
    {
        Log::info('[eSSL] hit getrequest', ['sn' => $request->query('SN'), 'ip' => $request->ip()]);
        return $this->plain('OK');
    }

    /** The device posts command-execution results here; just acknowledge. */
    public function devicecmd(Request $request)
    {
        return $this->plain('OK');
    }

    /**
     * Parse an ATTLOG body: tab-delimited lines of
     *   PIN <TAB> "YYYY-MM-DD HH:MM:SS" <TAB> status <TAB> verify <TAB> workcode ...
     * The datetime keeps its internal space because fields are TAB-separated.
     */
    private function parseAttlog(string $body): array
    {
        // Cap rows accepted from a single public push (DoS / memory guard). A
        // real terminal pushes a handful of records per cycle; anything past
        // this is dropped (and would be re-sent by the device next poll).
        $maxRows = 5000;

        $rows = [];
        foreach (preg_split('/\r\n|\r|\n/', trim($body)) as $line) {
            if (trim($line) === '') {
                continue;
            }
            $f = explode("\t", $line);
            if (count($f) < 2) {
                continue; // not a punch line we understand
            }
            $when = trim($f[1]);
            // Skip a header row: a real punch time carries a digit + date/time
            // separator (mirrors AttendanceController::parseUploadedPunches).
            if (!preg_match('/\d/', $when) || !preg_match('/[-:\/]/', $when)) {
                continue;
            }
            $rows[] = [
                'user_id'    => trim($f[0]),
                'punched_at' => $when,
                'status'     => isset($f[2]) ? trim($f[2]) : '',
            ];
            if (count($rows) >= $maxRows) {
                break;
            }
        }
        return $rows;
    }

    /**
     * Minimal ADMS handshake response. We deliberately omit TimeZone so the
     * device keeps its own clock (we convert local→UTC on ingest using the
     * terminal's configured timezone). Realtime=1 requests live push.
     */
    private function optionsBlock(string $sn): string
    {
        return implode("\n", [
            'GET OPTION FROM: ' . $sn,
            'Stamp=9999',
            'OpStamp=9999',
            'ErrorDelay=60',
            'Delay=30',
            'TransTimes=00:00;23:59',
            'TransInterval=1',
            'TransFlag=1111000000',
            'Realtime=1',
            'Encrypt=0',
        ]);
    }

    private function plain(string $body)
    {
        return response($body . "\n", 200)->header('Content-Type', 'text/plain');
    }
}
