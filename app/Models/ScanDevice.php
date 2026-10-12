<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * An enrolled sticker-scanning handheld. The plaintext credential exists only
 * on the device; this row keeps its hash. See the create_scan_devices migration.
 */
class ScanDevice extends Model
{
    protected $fillable = [
        'client_id', 'serial', 'label', 'model', 'location', 'status',
        'token_hash', 'last_seen_at', 'created_by',
    ];

    protected $hidden = ['token_hash'];

    protected $casts = [
        'last_seen_at' => 'datetime',
    ];

    /** Fresh credential: plaintext for the device, hash for the row. */
    public static function issueToken(): array
    {
        $plain = 'CBCD-' . Str::upper(Str::random(40));
        return [$plain, hash('sha256', $plain)];
    }

    public static function findByToken(?string $plain): ?self
    {
        if (!$plain || strlen($plain) > 100) {
            return null;
        }
        return static::where('token_hash', hash('sha256', trim($plain)))->first();
    }

    /** Shape the SPA consumes (`branch` is the free-text location). */
    public function toClient(): array
    {
        return [
            'id'           => $this->id,
            'serial'       => $this->serial,
            'label'        => $this->label,
            'model'        => $this->model,
            'branch'       => $this->location,
            'status'       => $this->status,
            'enrolled_at'  => optional($this->created_at)->toIso8601String(),
            'last_seen_at' => optional($this->last_seen_at)->toIso8601String(),
        ];
    }
}
