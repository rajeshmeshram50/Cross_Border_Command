<?php

namespace App\Console\Commands;

use App\Models\Branch;
use App\Models\Client;
use App\Services\LogoWebVariantGenerator;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Backfill the screen-sized "-w.png" logo variant for every client + branch
 * logo. These are generated at upload time now, so this is for logos uploaded
 * before that — which is all of them, and they are the ones costing the most:
 * the header renders a logo at 52px and the one on live is 9653x3094 / 1.1 MB,
 * which is the page's LCP element at 3.4-3.8 s.
 *
 * Nothing is overwritten. The original is left exactly as it is, because the
 * PDF headers embed it at full resolution.
 *
 *   php artisan logos:backfill-web           # only logos missing a variant
 *   php artisan logos:backfill-web --force   # regenerate all
 *   php artisan logos:backfill-web --dry-run # report what would be written
 */
class BackfillLogoWebVariants extends Command
{
    protected $signature = 'logos:backfill-web
        {--force : Regenerate even when a -w variant already exists}
        {--dry-run : Report sizes without writing anything}';

    protected $description = 'Generate the screen-sized -w.png logo variant for every client and branch logo that lacks one';

    public function handle(): int
    {
        $disk = Storage::disk('public');
        $generated = 0;
        $skipped = 0;
        $failed = 0;
        $savedBytes = 0;

        $process = function (?string $stored, string $label) use (&$generated, &$skipped, &$failed, &$savedBytes, $disk) {
            if (!$stored) return;
            $rel = $this->relativePath($stored);
            $ext = strtolower(pathinfo($rel, PATHINFO_EXTENSION));
            if (!in_array($ext, ['png', 'jpg', 'jpeg', 'webp'], true)) {
                return; // svg is already small; nothing to shrink
            }

            // The dark variant is generated at full resolution too, so dark
            // mode pays its own megabyte — both are reported.
            $sources = [$rel];
            $dark = preg_replace('/\.(png|jpe?g|webp)$/i', '-dark.png', $rel);
            if ($dark !== $rel && $disk->exists($dark)) $sources[] = $dark;

            foreach ($sources as $source) {
                $web = LogoWebVariantGenerator::webPath($source);
                if (!$web) continue;
                if (!$this->option('force') && $disk->exists($web)) {
                    $skipped++;
                    continue;
                }
                if (!$disk->exists($source)) {
                    $failed++;
                    $this->line("  <comment>x</comment> {$label}: missing {$source}");
                    continue;
                }

                $before = $disk->size($source);
                if ($this->option('dry-run')) {
                    $this->line(sprintf('  <comment>-</comment> %s would write %s (source %s KB)',
                        $label, $web, number_format($before / 1024, 1)));
                    continue;
                }

                LogoWebVariantGenerator::generate($source);
                if ($disk->exists($web)) {
                    $after = $disk->size($web);
                    $savedBytes += max(0, $before - $after);
                    $generated++;
                    $this->line(sprintf('  <info>v</info> %s  %s KB -> %s KB  %s',
                        $label, number_format($before / 1024, 1), number_format($after / 1024, 1), $web));
                } else {
                    $failed++;
                    $this->line("  <comment>x</comment> {$label}: could not generate from {$source} (GD unavailable / unreadable image)");
                }
            }
        };

        $this->info('Clients...');
        Client::whereNotNull('logo')->get(['id', 'logo'])
            ->each(fn (Client $c) => $process($c->logo, "client #{$c->id}"));

        $this->info('Branches...');
        Branch::whereNotNull('logo')->get(['id', 'logo'])
            ->each(fn (Branch $b) => $process($b->logo, "branch #{$b->id}"));

        $this->newLine();
        $this->info(sprintf('Done. Generated %d, skipped %d (already had one), failed %d. %s KB less to download per first page load.',
            $generated, $skipped, $failed, number_format($savedBytes / 1024, 1)));

        return self::SUCCESS;
    }

    /** Mirror of the controllers' helper: normalise a stored logo value to a
     *  path relative to the public disk (strips host + leading "storage/"). */
    private function relativePath(string $stored): string
    {
        if (preg_match('#^https?://#i', $stored)) {
            $path = parse_url($stored, PHP_URL_PATH) ?: '';
            $stored = ltrim($path, '/');
        }
        $stored = ltrim(str_replace('\\', '/', $stored), '/');
        if (str_starts_with($stored, 'storage/')) {
            $stored = substr($stored, strlen('storage/'));
        }

        return $stored;
    }
}
