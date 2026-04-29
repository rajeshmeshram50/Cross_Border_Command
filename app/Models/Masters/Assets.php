<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Assets extends Model
{
    protected $table = 'master_assets';

    /**
     * Auto-generate the asset code (AST-0001, AST-0002, …) on create when
     * the caller doesn't supply one. We pull the highest existing AST-NNNN
     * suffix in PHP so the value matches the preview the frontend computes
     * from the record list (db-agnostic — works on PG / MySQL / SQLite).
     */
    protected static function booted(): void
    {
        static::creating(function (self $row) {
            if (empty($row->code)) {
                $maxN = static::query()
                    ->where('code', 'like', 'AST-%')
                    ->pluck('code')
                    ->map(function ($c) {
                        return preg_match('/^AST-(\d+)$/i', (string) $c, $m) ? (int) $m[1] : 0;
                    })
                    ->max() ?? 0;
                $row->code = 'AST-' . str_pad((string) ($maxN + 1), 4, '0', STR_PAD_LEFT);
            }
        });
    }

    protected $fillable = [
        'client_id',
        'branch_id',
        'asset_name',
        'code',
        'asset_number',
        'asset_type_id',
        'description',
        'vendor_id',
        'purchase_date',
        'warranty_expiry_date',
        'invoice_file_path',
        'warranty_card_file_path',
        'assign_date',
        'status',
        'created_by',
    ];

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

    public function vendor(): BelongsTo
    {
        return $this->belongsTo(\App\Models\Masters\VendorDirectory::class, 'vendor_id');
    }
}
