<?php

namespace App\Models\Masters;

use App\Models\Concerns\BelongsToTenant;
use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Segments extends Model
{
    use BelongsToTenant;
    protected $table = 'clm_segments';

    protected $fillable = [
        'client_id',
        'branch_id',
        'code',
        'name',
        'title',
        'regulatory_status',
        'buyer_consignee',
        'status',
        'created_by',
        'updated_by',
    ];

    protected $appends = ['title'];

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

    public function getTitleAttribute(): ?string
    {
        return $this->attributes['name'] ?? null;
    }

    public function setTitleAttribute(?string $value): void
    {
        $this->attributes['name'] = $value;
    }

    protected static function booted(): void
    {
        static::creating(function (Segments $row) {
            if (empty($row->code)) {
                $row->code = self::nextCode($row->client_id);
            }
            if (empty($row->regulatory_status)) {
                $row->regulatory_status = 'less';
            }
            if (empty($row->buyer_consignee)) {
                $row->buyer_consignee = 'allowed';
            }
            if (!empty($row->status)) {
                $row->status = strtolower((string) $row->status);
                if (!in_array($row->status, ['active', 'inactive'], true)) {
                    $row->status = 'active';
                }
            } else {
                $row->status = 'active';
            }
        });
    }

    private static function nextCode(?int $clientId): string
    {
        $count = static::withoutGlobalScope('tenant')
            ->when($clientId, fn ($q) => $q->where('client_id', $clientId))
            ->count();
        return sprintf('S-%03d', $count + 1);
    }
}
