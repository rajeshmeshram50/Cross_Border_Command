<?php

namespace App\Models\CredVault;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * CredVault · the record of one import, export or backup. The file itself is
 * never stored — it goes straight to the person who asked for it.
 */
class Transfer extends Model
{
    protected $table = 'credvault_transfers';

    public const UPDATED_AT = null;

    public const KINDS    = ['import', 'export', 'backup'];
    public const PREFIXES = ['import' => 'IM', 'export' => 'EX', 'backup' => 'BK'];

    /** As the history tables print them. */
    public const FORMAT_LABELS = ['xlsx' => 'Excel', 'xml' => 'Excel 2003', 'csv' => 'CSV', 'tsv' => 'TSV', 'txt' => 'TSV', 'json' => 'JSON', 'sample' => 'Sample'];
    public const SCOPE_LABELS  = ['mine' => 'My Vault', 'team' => 'Team Vault', 'all' => 'All vaults'];

    /** Eloquent does not read the column default back after an insert; say it here too. */
    protected $attributes = ['status' => 'done'];

    protected $fillable = [
        'client_id', 'kind', 'code', 'user_id', 'scope', 'format', 'file_name', 'source',
        'items', 'skipped', 'weak', 'duplicates', 'size_bytes', 'include_passwords', 'locked',
        'status', 'failure_reason', 'created_at',
    ];

    protected $casts = [
        'items'             => 'integer',
        'skipped'           => 'integer',
        'weak'              => 'integer',
        'duplicates'        => 'integer',
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
