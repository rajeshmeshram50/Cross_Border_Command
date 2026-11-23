<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use PhpOffice\PhpWord\IOFactory;
use PhpOffice\PhpWord\PhpWord;
use PhpOffice\PhpWord\Settings;
use PhpOffice\PhpWord\Shared\Html;
use PhpOffice\PhpWord\Style\Table;
use PhpOffice\PhpWord\SimpleType\TblWidth;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class HrTemplateDocxRenderer
{
    private const HEADER_WIDTH_TWIPS = 11906 - (2 * 1440);

    public static function buildPath($row): string
    {
        $prevEscaping = Settings::isOutputEscapingEnabled();
        Settings::setOutputEscapingEnabled(true);
        try {
            return self::build($row);
        } finally {
            Settings::setOutputEscapingEnabled($prevEscaping);
        }
    }

    private static function build($row): string
    {
        $phpWord = new PhpWord();
        $section = $phpWord->addSection([
            'pageSizeW'    => 11906,
            'pageSizeH'    => 16838,
            'headerHeight' => 90 * 20,
            'footerHeight' => 50 * 20,
        ]);

        self::writeHeader($section, is_array($row->header_config) ? $row->header_config : []);
        self::writeFooter($section, is_array($row->footer_config) ? $row->footer_config : []);

        $html = (string) ($row->content_html ?: '<p>(empty template)</p>');
        $html = preg_replace(
            '#<(br|hr|col|input|area|base|embed|link|meta|param|source|track|wbr)\b([^>]*?)/?>#i',
            '<$1$2/>',
            $html
        );
        $html = preg_replace('/<img([^>]*[^\/])>/i', '<img$1/>', $html);
        $html = self::pageBreaksToWord($html);
        $html = self::localiseImageSources($html);
        $wrapped = '<html><body>' . $html . '</body></html>';

        $parsedCleanly = true;
        try {
            $probe = new PhpWord();
            $probeSection = $probe->addSection();
            Html::addHtml($probeSection, $wrapped, false, false);
            $parsedCleanly = count($probeSection->getElements()) > 0;
            if (!$parsedCleanly) {
                Log::warning('DOCX body HTML parsed to nothing; falling back to plain paragraphs');
            }
        } catch (\Throwable $e) {
            $parsedCleanly = false;
            Log::warning('DOCX body HTML did not parse; falling back to plain text', [
                'error' => $e->getMessage(),
            ]);
        }

        if ($parsedCleanly) {
            Html::addHtml($section, $wrapped, false, false);
        } else {
            $plain = preg_replace('#</t[dh]\s*>#i', "\t", $html);
            $plain = preg_replace('#<(?:br\s*/?|/p|/h[1-6]|/li|/tr|/div|/blockquote)\s*>#i', "\n", $plain);
            $plain = html_entity_decode(strip_tags($plain), ENT_QUOTES | ENT_HTML5, 'UTF-8');
            $any = false;
            foreach (preg_split('/\n/', $plain) ?: [] as $line) {
                $line = trim(preg_replace('/[ \x{00A0}]{2,}/u', ' ', $line));
                if ($line === '') continue;
                $section->addText($line);
                $any = true;
            }
            if (!$any) $section->addText(trim(strip_tags($html)));
        }

        $writer = IOFactory::createWriter($phpWord, 'Word2007');
        $tmp = tempnam(sys_get_temp_dir(), 'tpl_') . '.docx';
        $writer->save($tmp);
        return $tmp;
    }

    private static function pageBreaksToWord(string $html): string
    {
        return preg_replace(
            '#<div[^>]*(?:class="[^"]*\bpage-break\b[^"]*"|data-page-break)[^>]*>\s*</div>#i',
            '<p style="page-break-after: always"></p>',
            $html
        ) ?? $html;
    }
    public static function render($row, string $filename): BinaryFileResponse
    {
        $tmp = self::buildPath($row);
        return response()->download($tmp, $filename)->deleteFileAfterSend(true);
    }

    private static function localFile(?string $path): ?string
    {
        if (!$path) return null;

        $disk = null;
        foreach (array_unique([(string) config('filesystems.default'), 'public']) as $name) {
            try {
                $candidate = Storage::disk($name);
                if ($candidate->exists($path)) { $disk = $candidate; break; }
            } catch (Throwable $e) { }
        }
        if (!$disk) return null;

        try {
            $local = $disk->path($path);
            if (is_string($local) && is_file($local)) return $local;
        } catch (\Throwable $e) { }
        try {
            $bytes = $disk->get($path);
            if ($bytes === null) return null;
            $ext = pathinfo($path, PATHINFO_EXTENSION) ?: 'tmp';
            $tmp = tempnam(sys_get_temp_dir(), 'cbc_') . '.' . $ext;
            file_put_contents($tmp, $bytes);
            return $tmp;
        } catch (\Throwable $e) {
            return null;
        }
    }

    private static function localiseImageSources(string $html): string
    {
        return preg_replace_callback(
            '#<img\b([^>]*?)\bsrc=([\'"])(.*?)\2([^>]*?)/?>#i',
            function (array $m) {
                [$full, $pre, $q, $src, $post] = $m;
                if ($src === '' || str_starts_with($src, 'data:')) return $full;

                $path = parse_url($src, PHP_URL_PATH) ?: $src;
                $path = ltrim(str_replace('\\', '/', $path), '/');
                if (preg_match('#(?:^|/)storage/(.+)$#', $path, $sm)) $path = $sm[1];
                elseif (str_starts_with($src, 'http')) return '';

                $abs = self::resolveDocxLogo($path);
                if (!$abs) return '';
                return '<img' . $pre . 'src=' . $q . $abs . $q . $post . '/>';
            },
            $html,
        ) ?? $html;
    }

    private static function logoFromUrl(?string $url): ?string
    {
        $url = trim((string) $url);
        if ($url === '' || !preg_match('~^https?://~i', $url)) return null;

        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        $allowed = array_filter([
            strtolower((string) parse_url((string) config('app.url'), PHP_URL_HOST)),
            strtolower((string) parse_url((string) config('filesystems.disks.azure.url', env('AZURE_STORAGE_URL', '')), PHP_URL_HOST)),
        ]);
        if (!$host || !in_array($host, $allowed, true)) {
            Log::warning('DOCX header logo URL refused (host not allowed)', ['host' => $host]);
            return null;
        }

        try {
            $res = Http::timeout(8)->get($url);
            if (!$res->successful()) return null;
            $ext = strtolower(pathinfo((string) parse_url($url, PHP_URL_PATH), PATHINFO_EXTENSION)) ?: 'png';
            $tmp = tempnam(sys_get_temp_dir(), 'cbc_logo_') . '.' . $ext;
            file_put_contents($tmp, $res->body());
            return self::resolveDocxLogo($tmp) ?: null;
        } catch (Throwable $e) {
            Log::warning('DOCX header logo fetch failed', ['error' => $e->getMessage()]);
            return null;
        }
    }

    private static function resolveDocxLogo(?string $logoPath): ?string
    {
        $abs = self::localFile($logoPath);
        if (!$abs) return null;
        $ext = strtolower(pathinfo($abs, PATHINFO_EXTENSION));

        if (in_array($ext, ['png', 'jpg', 'jpeg', 'gif', 'bmp'], true)) return $abs;

        if ($ext === 'webp' && function_exists('imagecreatefromwebp')) {
            try {
                $img = @imagecreatefromwebp($abs);
                if ($img) {
                    imagepalettetotruecolor($img);
                    imagealphablending($img, false);
                    imagesavealpha($img, true);
                    $tmp = tempnam(sys_get_temp_dir(), 'logo_') . '.png';
                    imagepng($img, $tmp);
                    imagedestroy($img);
                    return $tmp;
                }
            } catch (\Throwable $e) { }
        }

        if ($ext === 'svg' && class_exists('Imagick')) {
            try {
                $im = new \Imagick();
                $im->setBackgroundColor(new \ImagickPixel('transparent'));
                $im->readImage($abs);
                $im->setImageFormat('png');
                $tmp = tempnam(sys_get_temp_dir(), 'logo_') . '.png';
                $im->writeImage($tmp);
                $im->clear();
                return $tmp;
            } catch (\Throwable $e) { }
        }

        return null;
    }

    public static function logoFitStyle(string $absLogo, int $maxHeightPt, int $cellWidthTwips): array
    {
        $maxWidthPt = $cellWidthTwips / 20.0;

        $dim = @getimagesize($absLogo);
        if (!is_array($dim) || ($dim[0] ?? 0) <= 0 || ($dim[1] ?? 0) <= 0) {
            return ['height' => $maxHeightPt, 'width' => $maxWidthPt];
        }

        $scale = min($maxHeightPt / $dim[1], $maxWidthPt / $dim[0], 1.0);

        return [
            'width'  => round($dim[0] * $scale, 2),
            'height' => round($dim[1] * $scale, 2),
        ];
    }

    private static function writeHeader($section, array $cfg): void
    {
        $logoPath = $cfg['logo_path'] ?? null;
        $title    = (string) ($cfg['title']    ?? '');
        $subtitle = (string) ($cfg['subtitle'] ?? '');
        $hAlign   = (string) ($cfg['align']    ?? 'right');
        $logoH    = (int) max(24, min(200, $cfg['logo_height'] ?? 60));

        $usable    = self::HEADER_WIDTH_TWIPS;
        $logoW     = (int) round($usable * 0.25);
        $titleW    = $usable - $logoW;

        $header = $section->addHeader();
        $table = $header->addTable([
            'borderSize' => 0, 'cellMargin' => 0,
            'unit'   => TblWidth::TWIP,
            'width'  => $usable,
            'layout' => Table::LAYOUT_FIXED,
        ]);
        $row1 = $table->addRow();
        $logoCell  = $row1->addCell($logoW,  ['valign' => 'center', 'noWrap' => false]);
        $titleCell = $row1->addCell($titleW, ['valign' => 'center', 'noWrap' => false]);

        $absLogo = self::resolveDocxLogo($logoPath) ?: self::logoFromUrl($cfg['logo_url'] ?? null);
        if ($absLogo) {
            try { $logoCell->addImage($absLogo, self::logoFitStyle($absLogo, $logoH, $logoW)); }
            catch (Throwable $e) { $logoCell->addText('[Logo]', ['italic' => true, 'color' => '808080']); }
        } elseif ($logoPath || !empty($cfg['logo_url'])) {
            Log::warning('DOCX header logo unresolved', ['logo_path' => $logoPath, 'logo_url' => $cfg['logo_url'] ?? null]);
            $logoCell->addText('[Logo]', ['italic' => true, 'color' => '808080']);
        }
        $align = $hAlign === 'left' ? 'left' : ($hAlign === 'center' ? 'center' : 'right');
        if ($title !== '')    $titleCell->addText($title,    ['bold' => true, 'size' => 14], ['alignment' => $align]);
        if ($subtitle !== '') $titleCell->addText($subtitle, ['size' => 10, 'color' => '6B7280'], ['alignment' => $align]);
    }

    private static function writeFooter($section, array $cfg): void
    {
        $footerText = (string) ($cfg['text']  ?? '');
        $fAlign     = (string) ($cfg['align'] ?? 'center');
        $showPage   = !empty($cfg['show_page_number']);
        $pnAlign    = (string) ($cfg['page_number_align']  ?? 'right');
        $pnFormat   = (string) ($cfg['page_number_format'] ?? 'Page N of M');

        $footer = $section->addFooter();
        $fTable = $footer->addTable([
            'borderSize' => 0, 'cellMargin' => 0,
            'unit'   => TblWidth::TWIP,
            'width'  => self::HEADER_WIDTH_TWIPS,
            'layout' => Table::LAYOUT_FIXED,
        ]);
        $fCellW = (int) floor(self::HEADER_WIDTH_TWIPS / 3);
        $fRow = $fTable->addRow();
        $cells = [
            'left'   => $fRow->addCell($fCellW, ['valign' => 'center', 'noWrap' => false]),
            'center' => $fRow->addCell($fCellW, ['valign' => 'center', 'noWrap' => false]),
            'right'  => $fRow->addCell(self::HEADER_WIDTH_TWIPS - (2 * $fCellW), ['valign' => 'center', 'noWrap' => false]),
        ];
        if ($footerText !== '' && isset($cells[$fAlign])) {
            $cells[$fAlign]->addText($footerText, ['size' => 9, 'color' => '6B7280'], ['alignment' => $fAlign]);
        }
        if ($showPage && isset($cells[$pnAlign])) {
            $run = $cells[$pnAlign]->addTextRun(['alignment' => $pnAlign]);
            $style = ['size' => 9, 'color' => '6B7280'];
            switch ($pnFormat) {
                case 'N':            $run->addField('PAGE', [], [], '', false); break;
                case 'Page N':       $run->addText('Page ', $style); $run->addField('PAGE', [], [], '', false); break;
                case 'N / M':        $run->addField('PAGE', [], [], '', false); $run->addText(' / ', $style); $run->addField('NUMPAGES', [], [], '', false); break;
                case 'Page N of M':
                default:             $run->addText('Page ', $style); $run->addField('PAGE', [], [], '', false); $run->addText(' of ', $style); $run->addField('NUMPAGES', [], [], '', false);
            }
        }
    }
}
