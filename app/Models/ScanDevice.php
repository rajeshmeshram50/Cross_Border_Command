<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class ScanDevice extends Model
{
    protected $fillable = [
        'client_id', 'serial', 'label', 'model', 'location', 'status',
        'token_hash', 'last_seen_at', 'created_by', 'enrolled_by', 'enrolled_at',
    ];

    protected $hidden = ['token_hash'];

    protected $casts = [
        'last_seen_at' => 'datetime',
        'enrolled_at'  => 'datetime',
    ];

    public function actorId(): ?int
    {
        return $this->enrolled_by ?: $this->created_by;
    }

    public function isActive(): bool
    {
        return $this->status === 'active';
    }

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
