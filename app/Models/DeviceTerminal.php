<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A registered biometric terminal (eSSL / ZKTeco). See the migration for the
 * tenant-safety rationale. Used by EsslDeviceController to resolve an inbound
 * push (identified only by Serial No.) to a client/branch.
 */
class DeviceTerminal extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'serial', 'name',
        'timezone', 'ingest_token', 'allowed_ips', 'is_active', 'last_seen_at',
    ];

    /** Parsed allow-list; empty = accept any source IP. */
    public function allowedIpList(): array
    {
        return array_values(array_filter(array_map('trim', explode(',', (string) $this->allowed_ips))));
    }

    /** True when $ip may push for this terminal (empty list = allow all). */
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
