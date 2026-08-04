<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrDocumentSignature extends Model
{
    protected $table = 'hr_document_signatures';

    protected $fillable = [
        'client_id', 'branch_id',
        'template_id', 'employee_id', 'code',
        'content_html', 'header_config', 'footer_config',
        'signers', 'current_index',
        'status', 'audit_log',
        'created_by',
    ];

    protected $casts = [
        'header_config' => 'array',
        'footer_config' => 'array',
        'signers'       => 'array',
        'audit_log'     => 'array',
        'current_index' => 'integer',
    ];

    /**
     * Header config with the branding logo filled in.
     *
     * A run copies `header_config` from its template, and a template that was
     * never given its own logo leaves `logo_url`/`logo_path` empty — so the
     * signing preview rendered the header band with company TEXT and no logo,
     * even though the branch had one configured. The signed-PDF path already
     * had a fallback of its own; the on-screen preview had none.
     *
     * Resolving it here (rather than in each of the ~8 read paths in
     * HrDocumentSignatureController) means index / inbox / show / the action
     * response / the PDF all agree, and no future endpoint can miss it.
     *
     * Precedence — an explicitly configured logo always wins:
     *   1. the template's own header logo
     *   2. the run's BRANCH logo   (the "default branch logo")
     *   3. the client logo         (tenant-wide brand)
     * Nothing is written back to the column; this only affects reads.
     */
    public function getHeaderConfigAttribute($value): array
    {
        $cfg = $this->castAttribute('header_config', $value);
        $cfg = is_array($cfg) ? $cfg : [];

        if (!empty($cfg['logo_url']) || !empty($cfg['logo_path'])) {
            return $cfg;   // template carries its own logo — leave it alone
        }

        $fallback = $this->branch?->logo_url ?: $this->client?->logo_url;
        if ($fallback) {
            $cfg['logo_url'] = $fallback;
            // `show_logo` defaults to true on a fresh header, but a legacy row
            // may have persisted false ALONGSIDE an empty logo simply because
            // there was nothing to show. Only force it on when the key is
            // absent — never override a deliberate "hide the logo".
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
