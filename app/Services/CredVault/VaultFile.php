<?php

namespace App\Services\CredVault;

use RuntimeException;
use ZipArchive;

/**
 * Reading and writing the files CredVault exchanges: CSV / TSV, JSON, Excel
 * (.xlsx and Excel 2003 XML) in, CSV / JSON / .xlsx out, and the
 * password-locked .zip a backup is wrapped in.
 *
 * No spreadsheet library is installed, and .xlsx is only a zip of XML parts,
 * so ZipArchive and SimpleXML cover it. The backup lock is AES-256 — not the
 * legacy ZipCrypto the prototype used, which is broken in minutes.
 */
class VaultFile
{
    public const MAX_ROWS = 2000;

    /* ═════════════════════════════ READ ═════════════════════════════ */

    /**
     * The file as a list of [header => value] rows.
     *
     * @throws RuntimeException with a message fit for the person who uploaded it
     */
    public static function read(string $path, string $ext): array
    {
        $raw = (string) file_get_contents($path);

        if (str_starts_with($raw, "\xD0\xCF\x11\xE0")) {
            throw new RuntimeException('This Excel file is password-protected or in the old .xls format. Open it in Excel, remove the password if it has one, and Save As .xlsx — then upload again.');
        }

        $rows = match (true) {
            str_starts_with($raw, 'PK')                      => self::readXlsx($path),
            $ext === 'json'                                  => self::readJson($raw),
            in_array($ext, ['xml', 'xls'], true)             => self::readXmlSheet($raw),
            $ext === 'tsv' || ($ext === 'txt' && str_contains($raw, "\t")) => self::readDelimited($raw, "\t"),
            default                                          => self::readDelimited($raw, ','),
        };

        if (count($rows) > self::MAX_ROWS) {
            throw new RuntimeException('The file has ' . count($rows) . ' rows. Import up to ' . self::MAX_ROWS . ' at a time.');
        }

        return $rows;
    }

    private static function readDelimited(string $raw, string $sep): array
    {
        $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw);
        $fh  = fopen('php://temp', 'r+');
        fwrite($fh, $raw);
        rewind($fh);

        $head = null;
        $rows = [];
        while (($cells = fgetcsv($fh, 0, $sep, '"', '')) !== false) {
            if ($cells === [null]) continue;
            if ($head === null) { $head = array_map(fn ($h) => trim((string) $h), $cells); continue; }
            // Undo safeCell(): our own CSVs guard =+-@ with a leading apostrophe, which
            // would otherwise come back as part of the password.
            $cells = array_map(fn ($v) => is_string($v) && preg_match("/^'+[=+\\-@\t\r]/", $v) ? substr($v, 1) : $v, $cells);
            $rows[] = self::combine($head, $cells);
        }
        fclose($fh);

        return $rows;
    }

    private static function readJson(string $raw): array
    {
        $data = json_decode(preg_replace('/^\xEF\xBB\xBF/', '', $raw), true);
        if (!is_array($data)) throw new RuntimeException('The JSON file could not be read.');

        foreach (['credentials', 'items', 'data', 'logins'] as $k) {
            if (isset($data[$k]) && is_array($data[$k])) { $data = $data[$k]; break; }
        }
        if (!array_is_list($data)) throw new RuntimeException('The JSON file has no list of credentials in it.');

        // Nested exports (Bitwarden's login.username) are flattened to dotted keys.
        return array_map(fn ($r) => is_array($r) ? self::flatten($r) : [], $data);
    }

    private static function flatten(array $r, string $prefix = ''): array
    {
        $out = [];
        foreach ($r as $k => $v) {
            $key = $prefix . $k;
            if (is_array($v) && !array_is_list($v)) {
                $out += self::flatten($v, $key . '.');
            } elseif (is_array($v)) {
                // login.uris[0].uri — the first entry is the one that matters.
                $first = $v[0] ?? null;
                if (is_array($first)) $out += self::flatten($first, $key . '.');
                elseif ($first !== null) $out[$key] = (string) $first;
            } else {
                $out[$key] = is_bool($v) ? ($v ? 'true' : 'false') : (string) $v;
            }
        }
        return $out;
    }

    private static function readXlsx(string $path): array
    {
        $zip = new ZipArchive();
        if ($zip->open($path) !== true) throw new RuntimeException('The Excel file could not be opened.');

        $shared = [];
        if (($xml = $zip->getFromName('xl/sharedStrings.xml')) !== false) {
            $sx = simplexml_load_string($xml);
            foreach ($sx->si as $si) {
                // Plain text sits in <t>; rich text is split into <r><t> runs.
                $text = (string) $si->t;
                foreach ($si->r as $run) $text .= (string) $run->t;
                $shared[] = $text;
            }
        }

        $sheet = $zip->getFromName('xl/worksheets/sheet1.xml');
        $zip->close();
        if ($sheet === false) throw new RuntimeException('The Excel file has no first sheet.');

        $sx   = simplexml_load_string($sheet);
        $grid = [];
        foreach ($sx->sheetData->row as $row) {
            $cells = [];
            foreach ($row->c as $c) {
                $col = self::colIndex(preg_replace('/\d+/', '', (string) $c['r']));
                $t   = (string) $c['t'];
                $val = match ($t) {
                    's'         => $shared[(int) $c->v] ?? '',
                    'inlineStr' => (string) $c->is->t,
                    default     => (string) $c->v,
                };
                $cells[$col] = $val;
            }
            if ($cells) {
                $max  = max(array_keys($cells));
                $grid[] = array_map(fn ($i) => $cells[$i] ?? '', range(0, $max));
            }
        }

        $head = array_map('trim', array_shift($grid) ?? []);
        return array_map(fn ($cells) => self::combine($head, $cells), $grid);
    }

    /** Excel 2003 "XML Spreadsheet" (.xls saved as XML). */
    private static function readXmlSheet(string $raw): array
    {
        $sx = @simplexml_load_string($raw);
        if (!$sx) throw new RuntimeException('The file could not be read as an Excel XML sheet.');

        $sx->registerXPathNamespace('ss', 'urn:schemas-microsoft-com:office:spreadsheet');
        $grid = [];
        foreach ($sx->xpath('//ss:Worksheet[1]//ss:Row') as $row) {
            $row->registerXPathNamespace('ss', 'urn:schemas-microsoft-com:office:spreadsheet');
            $grid[] = array_map(fn ($d) => (string) $d, $row->xpath('ss:Cell/ss:Data'));
        }

        $head = array_map('trim', array_shift($grid) ?? []);
        return array_map(fn ($cells) => self::combine($head, $cells), $grid);
    }

    private static function combine(array $head, array $cells): array
    {
        $out = [];
        foreach ($head as $i => $h) {
            if ($h === '') continue;
            $out[$h] = trim((string) ($cells[$i] ?? ''));
        }
        return $out;
    }

    private static function colIndex(string $letters): int
    {
        $n = 0;
        foreach (str_split(strtoupper($letters)) as $ch) $n = $n * 26 + (ord($ch) - 64);
        return $n - 1;
    }

    /* ═════════════════════════════ WRITE ═════════════════════════════ */

    /**
     * $rows (keyed by column) as a file body. JSON is a bare array of row
     * objects unless an envelope is given, then {…envelope, credentials: […]}.
     * CSV cells that start with = + - @ are prefixed with a quote so a
     * spreadsheet never runs them as a formula.
     */
    public static function build(array $columns, array $rows, string $format, ?array $jsonEnvelope = null): string
    {
        $records = array_map(fn ($r) => array_combine($columns, array_map(fn ($c) => $r[$c] ?? '', $columns)), $rows);

        return match ($format) {
            'json'  => json_encode($jsonEnvelope === null ? $records : $jsonEnvelope + ['credentials' => $records],
                JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'xlsx'  => self::xlsx([['name' => 'Credentials', 'rows' => array_merge([$columns], array_map('array_values', $records)), 'head' => true, 'freeze' => true]]),
            default => self::csv($columns, array_map('array_values', $records)),
        };
    }

    /**
     * CSV with a BOM and CRLF line ends, as Excel opens it. A value is quoted
     * only when it holds a quote, a comma or a line break — the prototype's rule.
     */
    public static function csv(array $header, array $rows): string
    {
        $q = function ($v): string {
            $v = (string) $v;
            return preg_match('/[",\r\n]/', $v) ? '"' . str_replace('"', '""', $v) . '"' : $v;
        };
        $lines = [implode(',', array_map($q, $header))];
        foreach ($rows as $r) $lines[] = implode(',', array_map(fn ($v) => $q(self::safeCell($v)), $r));

        return "\xEF\xBB\xBF" . implode("\r\n", $lines);
    }

    private static function safeCell($v): string
    {
        $v = (string) $v;
        // Apostrophes already in front of a formula character get one more, so the
        // reader's single-apostrophe strip always gives the original value back.
        return preg_match("/^'*[=+\\-@\t\r]/", $v) ? "'" . $v : $v;
    }

    /**
     * A workbook. Each sheet: ['name', 'rows' => [[…], …], 'head' => bool
     * (style the first row), 'freeze' => bool (freeze it), 'widths' => [chars…]].
     */
    public static function xlsx(array $sheets): string
    {
        $esc  = fn ($v) => htmlspecialchars((string) $v, ENT_XML1 | ENT_QUOTES, 'UTF-8');
        $cell = fn ($v, bool $head) => '<c t="inlineStr"' . ($head ? ' s="1"' : '') . '><is><t xml:space="preserve">' . $esc($v) . '</t></is></c>';
        $ns   = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
        $rel  = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

        $parts = [];
        $over = $sheetTags = $rels = '';
        foreach (array_values($sheets) as $i => $s) {
            $n = $i + 1;
            $xmlRows = '';
            foreach ($s['rows'] as $ri => $row) {
                $xmlRows .= '<row>' . implode('', array_map(fn ($v) => $cell($v, $ri === 0 && !empty($s['head'])), $row)) . '</row>';
            }
            $cols = !empty($s['widths'])
                ? '<cols>' . implode('', array_map(fn ($w, $ci) => '<col min="' . ($ci + 1) . '" max="' . ($ci + 1) . '" width="' . $w . '" customWidth="1"/>', $s['widths'], array_keys($s['widths']))) . '</cols>'
                : '';
            $view = !empty($s['freeze']) ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
            $parts["xl/worksheets/sheet{$n}.xml"] = '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="' . $ns . '">' . $view . $cols . '<sheetData>' . $xmlRows . '</sheetData></worksheet>';
            $over .= '<Override PartName="/xl/worksheets/sheet' . $n . '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
            $sheetTags .= '<sheet name="' . $esc(mb_substr($s['name'], 0, 31)) . '" sheetId="' . $n . '" r:id="rId' . $n . '"/>';
            $rels .= '<Relationship Id="rId' . $n . '" Type="' . $rel . '/worksheet" Target="worksheets/sheet' . $n . '.xml"/>';
        }
        $styleId = count($sheets) + 1;

        $parts += [
            '[Content_Types].xml' => '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' . $over . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
            '_rels/.rels' => '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' . $rel . '/officeDocument" Target="xl/workbook.xml"/></Relationships>',
            'xl/workbook.xml' => '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="' . $ns . '" xmlns:r="' . $rel . '"><sheets>' . $sheetTags . '</sheets></workbook>',
            'xl/_rels/workbook.xml.rels' => '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' . $rels . '<Relationship Id="rId' . $styleId . '" Type="' . $rel . '/styles" Target="styles.xml"/></Relationships>',
            'xl/styles.xml' => '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="' . $ns . '"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0E7490"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs></styleSheet>',
        ];

        return self::zip($parts);
    }

    /** One file inside an AES-256 zip that only $password opens. */
    public static function lock(string $innerName, string $body, string $password): string
    {
        return self::zip([$innerName => $body], $password);
    }

    private static function zip(array $parts, ?string $password = null): string
    {
        $tmp = tempnam(sys_get_temp_dir(), 'cvz');
        $zip = new ZipArchive();
        $zip->open($tmp, ZipArchive::OVERWRITE);
        if ($password !== null) $zip->setPassword($password);
        foreach ($parts as $name => $body) {
            $zip->addFromString($name, $body);
            if ($password !== null) $zip->setEncryptionName($name, ZipArchive::EM_AES_256);
        }
        $zip->close();

        $out = (string) file_get_contents($tmp);
        @unlink($tmp);

        return $out;
    }
}
