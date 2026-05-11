<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Platform-wide settings — one row per UI section. Each section's `value`
 * is stored as JSON so the shape can evolve without migrations.
 */
class PlatformSetting extends Model
{
    protected $table = 'platform_settings';

    protected $fillable = ['section', 'value', 'updated_by'];

    protected $casts = [
        'value' => 'array',
    ];

    /** Convenience: fetch a single section's value (or default empty array). */
    public static function getSection(string $section): array
    {
        return static::where('section', $section)->value('value') ?? [];
    }

    /** Convenience: upsert a section atomically. */
    public static function setSection(string $section, array $value, ?int $userId = null): self
    {
        $row = static::firstOrNew(['section' => $section]);
        $row->value      = $value;
        $row->updated_by = $userId;
        $row->save();
        return $row;
    }
}
