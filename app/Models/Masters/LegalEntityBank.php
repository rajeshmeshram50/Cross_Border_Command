<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LegalEntityBank extends Model
{
    protected $table = 'master_legal_entity_banks';

    protected $fillable = [
        'legal_entity_id',
        'bank_name',
        'branch_name',
        'account_number',
        'ifsc_code',
        'account_type',
        'is_primary',
    ];

    protected function casts(): array
    {
        return [
            'is_primary' => 'boolean',
        ];
    }

    public function legalEntity(): BelongsTo
    {
        return $this->belongsTo(LegalEntities::class, 'legal_entity_id');
    }
}
