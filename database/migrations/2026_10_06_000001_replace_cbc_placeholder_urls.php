<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    private array $map = [
        'general' => [
            'website_url' => ['https://cbc.com' => 'https://kryptone.ai'],
        ],
        'privacy' => [
            'privacy_policy_url' => ['https://cbc.com/privacy' => 'https://kryptone.ai/privacy'],
        ],
        'contact' => [
            'website' => ['https://cbc.com' => 'https://kryptone.ai'],
        ],
    ];

    public function up(): void
    {
        $this->rewrite(fn ($pairs) => $pairs);
    }

    public function down(): void
    {
        $this->rewrite(fn ($pairs) => array_flip($pairs));
    }

    private function rewrite(callable $direction): void
    {
        foreach ($this->map as $section => $keys) {
            $row = DB::table('platform_settings')->where('section', $section)->first();
            if (! $row) {
                continue;
            }

            $value = json_decode($row->value ?? '{}', true);
            if (! is_array($value)) {
                continue;
            }

            $changed = false;
            foreach ($keys as $key => $pairs) {
                $pairs = $direction($pairs);
                $current = $value[$key] ?? null;
                if ($current !== null && isset($pairs[$current])) {
                    $value[$key] = $pairs[$current];
                    $changed = true;
                }
            }

            if ($changed) {
                DB::table('platform_settings')
                    ->where('section', $section)
                    ->update(['value' => json_encode($value), 'updated_at' => now()]);
            }
        }
    }
};
