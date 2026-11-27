<?php

namespace App\Models\CredVault;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Transfer extends Model
{
    protected $table = 'credvault_transfers';

    public const UPDATED_AT = null;

    public const KINDS    = ['import', 'export', 'backup'];
    public const PREFIXES = ['import' => 'IM', 'export' => 'EX', 'backup' => 'BK'];

    public const FORMAT_LABELS = ['xlsx' => 'Excel', 'xml' => 'Excel 2003', 'csv' => 'CSV', 'tsv' => 'TSV', 'txt' => 'TSV', 'json' => 'JSON', 'sample' => 'Sample'];
    public const SCOPE_LABELS  = ['mine' => 'My Vault', 'team' => 'Team Vault', 'all' => 'All vaults'];

    protected $attributes = ['status' => 'done'];

    protected $fillable = [
        'client_id', 'kind', 'code', 'user_id', 'scope', 'format', 'file_name', 'source', 'credential_type',
        'items', 'skipped', 'weak', 'duplicates', 'failed', 'failed_rows', 'size_bytes', 'include_passwords', 'locked',
        'status', 'failure_reason', 'created_at',
    ];

    protected $casts = [
        'items'             => 'integer',
        'skipped'           => 'integer',
        'weak'              => 'integer',
        'duplicates'        => 'integer',
        'failed'            => 'integer',
        'failed_rows'       => 'array',
        'size_bytes'        => 'integer',
        'include_passwords' => 'boolean',
        'locked'            => 'boolean',
        'created_at'        => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
