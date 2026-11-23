<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Countries extends Model
{
    protected $table = 'master_countries';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'iso_code',
        'status',
        'created_by',
    ];

    public static function isoFor(?string $value): ?string
    {
        $value = $value !== null ? trim($value) : '';
        if ($value === '') {
            return null;
        }
        static $map = null;
        if ($map === null) {
            $map = [];
            foreach (static::query()->get(['name', 'iso_code']) as $row) {
                $iso = $row->iso_code ? strtoupper(trim((string) $row->iso_code)) : '';
                if ($iso === '') {
                    continue;
                }
                if ($row->name) {
                    $map[mb_strtolower(trim((string) $row->name))] = $iso;
                }
                $map[strtolower($iso)] = $iso;
            }
        }
        return $map[mb_strtolower($value)] ?? null;
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
