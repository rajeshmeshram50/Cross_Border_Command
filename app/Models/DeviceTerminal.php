<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class DeviceTerminal extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'serial', 'name',
        'timezone', 'ingest_token', 'allowed_ips', 'is_active', 'last_seen_at',
    ];

    public function allowedIpList(): array
    {
        return array_values(array_filter(array_map('trim', explode(',', (string) $this->allowed_ips))));
    }

    public function permitsIp(?string $ip): bool
    {
        $list = $this->allowedIpList();
        return empty($list) || ($ip !== null && in_array($ip, $list, true));
    }

    protected $casts = [
        'is_active'    => 'boolean',
        'last_seen_at' => 'datetime',
    ];

    public function client()
    {
        return $this->belongsTo(Client::class);
    }

    public function branch()
    {
        return $this->belongsTo(Branch::class);
    }
}
