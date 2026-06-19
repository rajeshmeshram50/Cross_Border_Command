<?php

namespace App\Console\Commands;

use App\Models\Branch;
use App\Models\Client;
use App\Services\LogoDarkVariantGenerator;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Backfill the dark-mode "-dark.png" logo variant for every client + branch
 * logo. These variants are normally generated at upload time, so tenants whose
 * logos predate that feature fall back to a white pill behind the logo in dark
 * mode (looks like a glaring white box). This regenerates them in bulk.
 *
 *   php artisan logos:backfill-dark           # only logos missing a variant
 *   php artisan logos:backfill-dark --force   # regenerate all (e.g. after a
 *                                             # generator tweak)
 */
class BackfillLogoDarkVariants extends Command
{
    protected $signature = 'logos:backfill-dark {--force : Regenerate even when a -dark variant already exists}';

    protected $description = 'Generate the dark-mode -dark.png logo variant for every client and branch logo that lacks one';

    public function handle(): int
    {
        $disk = Storage::disk('public');
        $generated = 0;
        $skipped = 0;
        $failed = 0;

        $process = function (?string $stored, string $label) use (&$generated, &$skipped, &$failed, $disk) {
            if (!$stored) return;
            $rel = $this->relativePath($stored);
            $ext = strtolower(pathinfo($rel, PATHINFO_EXTENSION));
            if (!in_array($ext, ['png', 'jpg', 'jpeg', 'webp'], true)) {
                return; // svg/gif have no raster dark variant
            }
            $darkPath = preg_replace('/\.(png|jpe?g|webp)$/i', '-dark.png', $rel);
            if (!$this->option('force') && $disk->exists($darkPath)) {
                $skipped++;
                return;
            }
            LogoDarkVariantGenerator::generate($rel);
            if ($disk->exists($darkPath)) {
                $generated++;
                $this->line("  <info>✓</info> {$label} → {$darkPath}");
            } else {
                $failed++;
                $this->line("  <comment>✗</comment> {$label}: could not generate from {$rel} (missing file / GD unavailable / unsupported)");
            }
        };

        $this->info('Clients…');
        Client::whereNotNull('logo')->get(['id', 'logo'])
            ->each(fn (Client $c) => $process($c->logo, "client #{$c->id}"));

        $this->info('Branches…');
        Branch::whereNotNull('logo')->get(['id', 'logo'])
            ->each(fn (Branch $b) => $process($b->logo, "branch #{$b->id}"));

        $this->newLine();
        $this->info("Done. Generated {$generated}, skipped {$skipped} (already had a variant), failed {$failed}.");

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
