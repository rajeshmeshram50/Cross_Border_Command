<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrDocumentSignature extends Model
{
    protected $table = 'hr_document_signatures';

    protected $fillable = [
        'client_id', 'branch_id',
        'template_id', 'template_version', 'employee_id', 'code',
        'content_html', 'header_config', 'footer_config',
        'signers', 'current_index',
        'status', 'audit_log',
        'signed_pdf_path', 'signed_pdf_at',
        'created_by',
    ];

    protected $casts = [
        'header_config' => 'array',
        'footer_config' => 'array',
        'signers'       => 'array',
        'audit_log'     => 'array',
        'current_index' => 'integer',
        'signed_pdf_at' => 'datetime',
    ];

    public function getHeaderConfigAttribute($value): array
    {
        $cfg = $this->castAttribute('header_config', $value);
        $cfg = is_array($cfg) ? $cfg : [];

        if (!empty($cfg['logo_url']) || !empty($cfg['logo_path'])) {
            return $cfg;
        }

        $fallback = $this->branch?->logo_url ?: $this->client?->logo_url;
        if ($fallback) {
            $cfg['logo_url'] = $fallback;
            if (!array_key_exists('show_logo', $cfg)) {
                $cfg['show_logo'] = true;
            }
        }
        return $cfg;
    }

    public function template(): BelongsTo  { return $this->belongsTo(HrDocumentTemplate::class, 'template_id'); }
    public function employee(): BelongsTo  { return $this->belongsTo(Employee::class, 'employee_id'); }
    public function client(): BelongsTo    { return $this->belongsTo(Client::class); }
    public function branch(): BelongsTo    { return $this->belongsTo(Branch::class); }
    public function creator(): BelongsTo   { return $this->belongsTo(User::class, 'created_by'); }
}
