<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DeviceTerminal;
use App\Services\EsslAttendanceImporter;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class EsslDeviceController extends Controller
{
    public function cdata(Request $request, EsslAttendanceImporter $importer)
    {
        $sn = (string) $request->query('SN', '');
        $terminal = $sn !== '' ? DeviceTerminal::where('serial', $sn)->first() : null;

        Log::info('[eSSL] hit cdata', [
            'method' => $request->method(), 'sn' => $sn, 'matched' => (bool) $terminal,
            'table' => $request->query('table'), 'ip' => $request->ip(),
            'bytes' => strlen($request->getContent()),
        ]);

        if ($request->isMethod('post')) {
            $table = strtoupper((string) $request->query('table', ''));
            $body  = $request->getContent();

            if (!$terminal || !$terminal->is_active) {
                Log::warning('[eSSL] push from unregistered/inactive terminal', [
                    'sn' => $sn, 'table' => $table, 'bytes' => strlen($body),
                ]);
                return $this->plain('OK');
            }

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
                return $this->plain('OK: ' . count($rows));
            }

            return $this->plain('OK');
        }

        if ($terminal) {
            $terminal->forceFill(['last_seen_at' => now()])->save();
        }
        return $this->plain($this->optionsBlock($sn));
    }

    public function getrequest(Request $request)
    {
        Log::info('[eSSL] hit getrequest', ['sn' => $request->query('SN'), 'ip' => $request->ip()]);
        return $this->plain('OK');
    }

    public function devicecmd(Request $request)
    {
        return $this->plain('OK');
    }

    private function parseAttlog(string $body): array
    {
        $maxRows = 5000;

        $rows = [];
        foreach (preg_split('/\r\n|\r|\n/', trim($body)) as $line) {
            if (trim($line) === '') {
                continue;
            }
            $f = explode("\t", $line);
            if (count($f) < 2) {
                continue;
            }
            $when = trim($f[1]);
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
