<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PlatformSetting extends Model
{
    protected $table = 'platform_settings';

    protected $fillable = ['section', 'value', 'updated_by'];

    protected $casts = [
        'value' => 'array',
    ];

    public static function getSection(string $section): array
    {
        return static::where('section', $section)->value('value') ?? [];
    }

    public static function setSection(string $section, array $value, ?int $userId = null): self
    {
        $row = static::firstOrNew(['section' => $section]);
        $row->value      = $value;
        $row->updated_by = $userId;
        $row->save();
        return $row;
    }
}
