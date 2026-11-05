<?php

namespace App\Services\CredVault;

use App\Models\CredVault\Credential;
use Carbon\Carbon;
use Illuminate\Support\Str;

/**
 * Import by category — one sheet layout per credential type, built from the type's own
 * form (Credential::TYPES), so a sheet holds exactly what the Add form asks for:
 *
 *   Credential Name · the form's fields (files excepted) · 2FA · Registered Email ·
 *   Registered Phone · Recovery Key · Risk · Rotation (days) · Notes
 *
 * A header ending in " *" is required. Headers are matched by label or by field key,
 * case and spacing ignored, so a sheet saved from Excel or typed by hand both read.
 * The sample's two rows per type pass every check the form makes.
 */
class ImportTemplate
{
    public const NAME = 'Credential Name';

    /** @return array<int, array{key:string, header:string, label:string, required:bool, kind:string, options:?array, group:string, hint:string}> */
    public static function columns(string $type): array
    {
        $def  = Credential::typeDef($type);
        $cols = [['key' => 'credential_name', 'label' => self::NAME, 'required' => true, 'kind' => 'text', 'options' => null, 'group' => 'name', 'hint' => '2 to 150 characters, unique for this type in your vault']];
        foreach ($def['fields'] as $f) {
            if ($f['kind'] === 'file') continue;   // files are attached in the form after the import
            $cols[] = ['key' => $f['key'], 'label' => $f['label'], 'required' => (bool) $f['required'], 'kind' => $f['kind'],
                'options' => $f['kind'] === 'toggle' ? ['Yes', 'No'] : $f['options'], 'group' => 'field', 'hint' => self::hint($type, $f)];
        }
        if ($def['twofa'] && !collect($def['fields'])->contains('key', 'twofa')) {
            $cols[] = ['key' => 'twofa', 'label' => '2FA', 'required' => false, 'kind' => 'toggle', 'options' => ['Yes', 'No'], 'group' => 'switch', 'hint' => 'Yes or No'];
        }
        $x = $def['extras'];
        if (!empty($x['reg_email']))    $cols[] = ['key' => 'reg_email', 'label' => 'Registered Email', 'required' => false, 'kind' => 'email', 'options' => null, 'group' => 'extra', 'hint' => 'The recovery email of the account'];
        if (!empty($x['reg_phone']))    $cols[] = ['key' => 'reg_phone', 'label' => 'Registered Phone', 'required' => false, 'kind' => 'tel', 'options' => null, 'group' => 'extra', 'hint' => '10 to 16 digits, e.g. +91 98200 11223'];
        if (!empty($x['recovery_key'])) $cols[] = ['key' => 'recovery_key', 'label' => 'Recovery Key', 'required' => false, 'kind' => 'text', 'options' => null, 'group' => 'extra', 'hint' => '4 to 500 characters'];
        $cols[] = ['key' => 'risk', 'label' => 'Risk', 'required' => false, 'kind' => 'select', 'options' => ['Low', 'Medium', 'High'], 'group' => 'meta',
            'hint' => 'Low, Medium or High (empty: ' . ucfirst($def['risk'] === 'critical' ? 'high' : $def['risk']) . ')'];
        if (Credential::secretIsPassword($type)) {
            $cols[] = ['key' => 'rotation_days', 'label' => 'Rotation (days)', 'required' => false, 'kind' => 'select', 'options' => array_map('strval', array_filter(Credential::ROTATIONS)), 'group' => 'meta', 'hint' => '30, 60, 90 or 180 (empty: the policy default)'];
        }
        $cols[] = ['key' => 'notes', 'label' => 'Notes', 'required' => false, 'kind' => 'textarea', 'options' => null, 'group' => 'meta', 'hint' => 'Up to 5,000 characters'];

        return array_map(fn ($c) => $c + ['header' => $c['label'] . ($c['required'] ? ' *' : '')], $cols);
    }

    /** The files a type's form takes that a sheet cannot carry (Certificate File, Document File …). */
    public static function fileFields(string $type): array
    {
        return array_values(array_map(fn ($f) => ['key' => $f['key'], 'label' => $f['label'], 'required' => $f['required']],
            array_filter(Credential::typeDef($type)['fields'], fn ($f) => $f['kind'] === 'file')));
    }

    /** The sheet (tab) name of a type — its label, as Excel allows (31 characters, no / \ ? * [ ]). */
    public static function sheetName(string $type): string
    {
        return mb_substr(str_replace(['/', '\\', '?', '*', '[', ']', ':'], '-', Credential::typeDef($type)['label']), 0, 31);
    }

    /** The type a sheet name stands for, or null. */
    public static function typeOfSheet(string $sheet): ?string
    {
        $n = self::norm($sheet);
        foreach (array_keys(Credential::TYPES) as $t) {
            if (in_array($n, [self::norm(self::sheetName($t)), self::norm($t), self::norm(Credential::typeDef($t)['label'])], true)) return $t;
        }
        return null;
    }

    /** "Website / URL *" → "website/url". */
    public static function norm(string $h): string
    {
        return preg_replace('/[\s_]+/', '', Str::lower(rtrim(trim($h), " *")));
    }

    /**
     * Which file header feeds which column: by label or by key.
     *
     * @return array{0: array<string,string>, 1: string[], 2: string[]} key => header, the required columns missing, headers not used
     */
    public static function mapHeaders(string $type, array $headers): array
    {
        $cols = self::columns($type);
        $map  = [];
        $used = [];
        foreach ($cols as $c) {
            foreach ($headers as $h) {
                if (isset($used[$h])) continue;
                if (in_array(self::norm($h), [self::norm($c['label']), self::norm($c['key'])], true)) { $map[$c['key']] = $h; $used[$h] = true; break; }
            }
        }
        $missing = array_values(array_map(fn ($c) => $c['header'], array_filter($cols, fn ($c) => $c['required'] && !isset($map[$c['key']]))));
        $unknown = array_values(array_filter($headers, fn ($h) => trim($h) !== '' && !isset($used[$h])));

        return [$map, $missing, $unknown];
    }

    /**
     * One sheet row as the Add form's request: name, fields[…], twofa, reg_*, risk,
     * rotation_days, notes. Empty cells are left out, so the form's own rules decide.
     */
    public static function toPayload(string $type, array $row, array $map): array
    {
        $cols = collect(self::columns($type))->keyBy('key');
        $out  = ['type' => $type, 'fields' => []];
        foreach ($map as $key => $header) {
            $v = trim((string) ($row[$header] ?? ''));
            if ($v === '') continue;
            $c = $cols[$key];
            if ($c['kind'] === 'toggle') $v = in_array(Str::lower($v), ['yes', 'y', 'true', '1', 'on', 'enabled'], true) ? '1' : '0';
            if ($c['kind'] === 'date') $v = self::excelDate($v);
            match ($c['group']) {
                'field'  => $out['fields'][$key] = $v,
                'name'   => $out['name'] = $v,
                'switch' => $out['twofa'] = $v,
                default  => $out[$key] = $key === 'risk' ? Str::lower($v) : $v,
            };
        }
        return $out;
    }

    /** A date Excel stored as a serial number (46843) or typed as 31/03/2028 → 2028-03-31. Anything else as it is. */
    public static function excelDate(string $v): string
    {
        if (preg_match('/^\d{5}(\.\d+)?$/', $v)) return Carbon::create(1899, 12, 30)->addDays((int) $v)->format('Y-m-d');
        if (preg_match('#^(\d{1,2})/(\d{1,2})/(\d{4})$#', $v, $m) && checkdate((int) $m[2], (int) $m[1], (int) $m[3])) return sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1]);
        return $v;
    }

    /* ═════════════════════════════ SAMPLE ═════════════════════════════ */

    /** Two example rows for a type — every value passes the form's checks. @return array<int, array<string,string>> key => value */
    public static function sampleRows(string $type): array
    {
        $label = Credential::typeDef($type)['label'];
        $names = self::SAMPLE_NAMES[$type] ?? ["{$label} — sample 1", "{$label} — sample 2"];
        $rows  = [];
        foreach ([0, 1] as $i) {
            $r = [];
            foreach (self::columns($type) as $c) {
                $r[$c['key']] = match ($c['key']) {
                    'credential_name' => $names[$i],
                    'risk'          => '',
                    'rotation_days' => $i ? '90' : '',
                    'notes'         => $i ? 'Imported from the CredVault sample' : '',
                    default         => self::sampleValue($type, $c, $i),
                };
            }
            $rows[] = $r;
        }
        return $rows;
    }

    private const SAMPLE_NAMES = [
        'login' => ['Zoho Books Admin', 'Canva Team'], 'password' => ['Tally Prime Login', 'GST Portal'], 'email' => ['Accounts Mailbox', 'HR Mailbox'],
        'passkey' => ['GitHub Passkey', 'Google Workspace Passkey'], 'totp' => ['AWS Root 2FA Seed', 'Razorpay 2FA Seed'],
        'card' => ['HDFC Corporate Card', 'ICICI Travel Card'], 'bank' => ['HDFC Current Account', 'Axis Payroll Account'],
        'crypto' => ['Treasury Cold Wallet', 'Ops Hot Wallet'], 'rewards' => ['Air India Flying Returns', 'Marriott Bonvoy'],
        'api' => ['Razorpay Live Keys', 'SendGrid API'], 'ssh' => ['Prod Bastion Key', 'Staging Deploy Key'],
        'database' => ['Production Postgres', 'Reporting MySQL'], 'server' => ['App Server 01', 'File Server'],
        'cert' => ['inhpl.com Wildcard SSL', 'Portal SSL'], 'license' => ['Microsoft 365 Business', 'Adobe Acrobat Pro'],
        'wifi' => ['Office Wi-Fi 5G', 'Guest Wi-Fi'], 'identity' => ['Director Identity', 'Signatory Identity'],
        'passport' => ['Director Passport', 'CFO Passport'], 'driver' => ['Company Driver License', 'Director Driver License'],
        'govid' => ['Company PAN', 'Director Aadhaar'], 'document' => ['GST Registration Certificate', 'IEC Certificate'],
        'note' => ['Server Room Door Code', 'Vendor Escalation Notes'], 'membership' => ['ICAI Membership', 'Chamber of Commerce'],
        'medical' => ['Group Health Policy', 'Director Health Policy'], 'outdoor' => ['Fishing Permit', 'Trekking Permit'],
    ];

    private static function sampleValue(string $type, array $c, int $i): string
    {
        $k = $c['key'];
        $byKey = [
            'cardno' => ['4111111111111111', '5555555555554444'], 'cvv' => ['123', '4567'], 'pin' => ['4321', ''], 'exp' => ['12/29', '06/30'],
            'acno' => ['50100012345678', '91702004561234'], 'ifsc' => ['HDFC0000123', 'UTIB0000456'], 'nbuser' => ['inhpl_corp', ''],
            'address' => $type === 'crypto' ? ['0x71C7656EC7ab88b098defB751B7401B5f6d8976F', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'] : ['Inorbvict House, Pune 411001', ''],
            'apikey' => ['rzp_live_AbC123xYz789', 'SG.k9f8d7s6a5.Q1w2E3r4T5y6'], 'secret' => ['sk_live_9f8e7d6c5b4a3210', 'SG.secret.Z9y8X7w6V5'],
            'privkey' => ["-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ\n-----END OPENSSH PRIVATE KEY-----", "-----BEGIN OPENSSH PRIVATE KEY-----\nc2FtcGxlLWtleS1mb3ItdGhlLXRlbXBsYXRl\n-----END OPENSSH PRIVATE KEY-----"],
            'lkey' => ['M365B-7Q2KX-9XZMP-4HT8R', 'ACRPR-55821-90337-KK21Q'], 'seats' => ['25', '5'],
            'host' => ['db.prod.inhpl.com', '10.0.2.14'], 'port' => $type === 'database' ? ['5432', '3306'] : ['22', '3389'], 'dbname' => ['erp_prod', 'reports'],
            'ssid' => ['INHPL-Office-5G', 'INHPL-Guest'], 'number' => match ($type) {
                'passport' => ['N1234567', 'Z7654321'], 'driver' => ['MH1220110012345', 'MH1420150067890'],
                'govid' => ['ABCDE1234F', '1234 5678 9012'], default => ['FP-2026-0042', 'TP-2026-0107'] },
            'name' => ['Inorbvict Healthcare India Pvt Ltd', 'Rajesh Meshram'], 'idtype' => ['PAN', 'Aadhaar'],
            'policy' => ['POL-778899-2026', 'HLT-445566-2026'], 'note' => ['Door code 4729#, change every quarter', 'Escalate to vendor desk after 2 hours'],
            'docno' => ['27AAACI1234F1Z5', 'AAACI1234F'], 'issued' => ['GST Department', 'DGFT'],
            'fullname' => ['Rajesh Meshram', 'Priya Sharma'], 'nationality' => ['Indian', 'Indian'], 'state' => ['Maharashtra', 'Maharashtra'],
            'member' => ['AI1234567', 'MB98765432'], 'program' => ['Flying Returns', 'Bonvoy'], 'org' => ['ICAI', 'MCCIA'],
            'patient' => ['Rajesh Meshram', 'Priya Sharma'], 'provider' => $type === 'email' ? null : ['Star Health', 'HDFC Ergo'],
            'wallet' => ['Ledger Nano X', 'MetaMask'], 'account' => ['root@inhpl.com', 'admin@inhpl.com'], 'service' => ['AWS', 'Razorpay'],
            'domain' => ['*.inhpl.com', 'portal.inhpl.com'], 'issuer' => $type === 'card' ? ['HDFC Bank', 'ICICI Bank'] : ['DigiCert', "Let's Encrypt"],
            'product' => ['Microsoft 365 Business', 'Adobe Acrobat Pro'], 'licto' => ['Inorbvict Healthcare', 'Finance Team'],
            'holder' => ['Inorbvict Healthcare India Pvt Ltd', 'Rajesh Meshram'], 'bank' => ['HDFC Bank', 'Axis Bank'],
            'recovery' => ['it.desk@inhpl.com', ''], 'backup' => ["8F2K-1Q9X\n7Z3M-5T8R", ''], 'ltype' => ['Fishing', 'Trekking'],
            'endpoint' => ['https://api.razorpay.com', 'https://api.sendgrid.com'], 'engine' => null, 'device' => null,
            'username' => ['admin@inhpl.com', 'ops@inhpl.com'], 'email' => ['accounts@inhpl.com', 'hr@inhpl.com'],
            'reg_email' => ['it.desk@inhpl.com', ''], 'reg_phone' => ['+91 98200 11223', ''], 'recovery_key' => ['RECOVERY-7Q2K-9XZM', ''],
            'twofa' => ['Yes', 'No'], 'admin' => ['http://192.168.1.1', 'http://192.168.0.1'],
        ];
        if (isset($byKey[$k]) && $byKey[$k] !== null) return $byKey[$k][$i];
        if ($k === 'seed') return $type === 'totp' ? ['JBSWY3DPEHPK3PXP', 'KRSXG5CTMVRXEZLU'][$i]
            : ['abandon ability able about above absent absorb abstract absurd abuse access accident', 'legal winner thank year wave sausage worth useful legal winner thank yellow'][$i];

        return match ($c['kind']) {
            'url'      => ['https://books.zoho.in', 'https://www.canva.com'][$i],
            'email'    => ['accounts@inhpl.com', 'hr@inhpl.com'][$i],
            'tel'      => ['+91 98200 11223', '+91 98765 43210'][$i],
            'password' => ['Zoho@Books#2026', 'Canva!Team#2026x'][$i],
            'date'     => self::sampleDate($k, $i),
            'number'   => ['10', '5'][$i],
            'select', 'toggle' => ($c['options'] ?? [''])[$i % max(1, count($c['options'] ?? []))],
            'secret'   => ['S3cret-Value-01', 'S3cret-Value-02'][$i],
            default    => ["Sample {$c['label']} 1", "Sample {$c['label']} 2"][$i],
        };
    }

    private static function sampleDate(string $key, int $i): string
    {
        // Expiry dates in the future; birth / issue / created dates in the past.
        return in_array($key, ['dob', 'issue', 'created', 'issued'], true) ? ['1984-06-15', '2019-01-20'][$i] : ['2028-03-31', '2029-12-31'][$i];
    }

    private static function hint(string $type, array $f): string
    {
        return match (true) {
            $f['key'] === 'cardno'   => '12 to 19 digits (a real card number check is made)',
            $f['key'] === 'exp'      => 'MM/YY, not in the past',
            $f['key'] === 'cvv'      => '3 or 4 digits',
            $f['key'] === 'pin'      => '4 to 6 digits',
            $f['key'] === 'ifsc'     => 'e.g. HDFC0000123',
            $f['key'] === 'port'     => '1 to 65535',
            $f['key'] === 'seed'     => $type === 'totp' ? 'The base32 setup key (A–Z, 2–7)' : '12 to 24 words',
            $f['kind'] === 'select'  => 'One of: ' . implode(', ', $f['options'] ?? []),
            $f['kind'] === 'toggle'  => 'Yes or No',
            $f['kind'] === 'date'    => 'YYYY-MM-DD (or DD/MM/YYYY)',
            $f['kind'] === 'url'     => 'A web address, e.g. https://app.example.com',
            $f['kind'] === 'email'   => 'An email address',
            $f['kind'] === 'tel'     => '10 to 16 digits',
            $f['kind'] === 'number'  => 'A whole number',
            in_array($f['kind'], ['password', 'secret'], true) => 'Encrypted as soon as it is imported',
            default                  => $f['max'] ? "Up to {$f['max']} characters" : 'Text',
        };
    }

    /* ═════════════════════════════ FILES ═════════════════════════════ */

    /** One type's sheet: the header row, then $rows (key => value). */
    public static function sheet(string $type, array $rows): array
    {
        $cols = self::columns($type);
        return [
            'name'   => self::sheetName($type), 'head' => true, 'freeze' => true,
            'widths' => array_map(fn ($c) => $c['group'] === 'name' ? 30 : ($c['kind'] === 'textarea' ? 40 : 22), $cols),
            'rows'   => array_merge([array_column($cols, 'header')], array_map(fn ($r) => array_map(fn ($c) => (string) ($r[$c['key']] ?? ''), $cols), $rows)),
        ];
    }

    /** The "How to fill" sheet: one line per column of every type in $types. */
    public static function guideSheet(array $types): array
    {
        $rows = [['Sheet (type)', 'Column', 'Required', 'What to enter']];
        foreach ($types as $t) {
            foreach (self::columns($t) as $c) $rows[] = [self::sheetName($t), $c['label'], $c['required'] ? 'Yes' : 'No', $c['hint']];
            foreach (self::fileFields($t) as $f) $rows[] = [self::sheetName($t), $f['label'], $f['required'] ? 'After import' : 'No', 'Files are not in the sheet — attach it in the credential form after the import'];
        }
        $rows[] = ['', '', '', ''];
        $rows[] = ['Tips', '', '', 'Keep the header row as it is. Replace the two example rows with your own — one credential per row. Import one sheet (type) at a time: choose the same category on the import screen.'];
        $rows[] = ['', '', '', 'Format number-like columns (card numbers, PINs, account numbers) as Text in Excel, so leading zeros and long numbers are kept.'];

        return ['name' => 'How to fill', 'head' => true, 'freeze' => true, 'widths' => [22, 22, 12, 80], 'rows' => $rows];
    }
}
