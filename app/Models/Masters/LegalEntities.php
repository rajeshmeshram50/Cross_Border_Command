<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class LegalEntities extends Model
{
    protected $table = 'master_legal_entities';

    protected $fillable = [
        'client_id',
        'branch_id',
        'entity_code',
        'entity_name',
        'legal_name',
        'cin',
        'date_of_incorporation',
        'type_of_business',
        'sector',
        'nature_of_business',
        'country_id',
        'address_line1',
        'address_line2',
        'city',
        'state_id',
        'zip_code',
        'currency_id',
        'financial_year',
        'logo_path',
        'status',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'date_of_incorporation' => 'date',
        ];
    }

    /**
     * Auto-generate the entity code (LE-0001, LE-0002, …) on create when
     * the caller doesn't supply one. Pulls the highest existing LE-NNNN
     * suffix in PHP so codes stay contiguous after deletes.
     */
    protected static function booted(): void
    {
        static::creating(function (self $row) {
            if (empty($row->entity_code)) {
                $maxN = static::query()
                    ->where('entity_code', 'like', 'LE-%')
                    ->pluck('entity_code')
                    ->map(function ($c) {
                        return preg_match('/^LE-(\d+)$/i', (string) $c, $m) ? (int) $m[1] : 0;
                    })
                    ->max() ?? 0;
                $row->entity_code = 'LE-' . str_pad((string) ($maxN + 1), 4, '0', STR_PAD_LEFT);
            }
        });
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

    public function country(): BelongsTo
    {
        return $this->belongsTo(Countries::class, 'country_id');
    }

    public function state(): BelongsTo
    {
        return $this->belongsTo(States::class, 'state_id');
    }

    public function currency(): BelongsTo
    {
        return $this->belongsTo(Currencies::class, 'currency_id');
    }

    public function banks(): HasMany
    {
        return $this->hasMany(LegalEntityBank::class, 'legal_entity_id');
    }
}
