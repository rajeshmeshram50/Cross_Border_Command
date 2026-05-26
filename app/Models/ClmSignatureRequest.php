<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Collection;

/**
 * Zoho Sign request — one row per "send for signature" the user fires from
 * a Customer (Consignee/Vendor extensibility is intentional). Bundles up to
 * 10 Trade Document drafts behind a single Zoho request id.
 *
 * Tenant scoping mirrors [[Customer::scopeForUser]] via the shared
 * [[App\Support\MasterVisibility]] read scope so sub-branch users only see
 * the requests their visibility tier permits.
 */
class ClmSignatureRequest extends Model
{
    use SoftDeletes;

    protected $table = 'clm_signature_requests';

    protected $fillable = [
        'client_id', 'branch_id',
        'trade_doc_id', 'trade_doc_ids', 'document_names', 'zoho_document_ids',
        'model_name', 'party_id',
        'zoho_request_id', 'request_name', 'status',
        'signers', 'signing_urls',
        'expiry_date', 'completed_at', 'declined_at', 'decline_reason',
        'recalled_at', 'recall_reason',
        'signed_document_path', 'signed_document_paths', 'certificate_path',
        'metadata',
        'created_by',
        'last_reminder_sent_at', 'reminder_count',
    ];

    protected $casts = [
        'trade_doc_ids'         => 'array',
        'document_names'        => 'array',
        'zoho_document_ids'     => 'array',
        'signers'               => 'array',
        'signing_urls'          => 'array',
        'signed_document_paths' => 'array',
        'metadata'              => 'array',
        'expiry_date'           => 'datetime',
        'completed_at'          => 'datetime',
        'declined_at'           => 'datetime',
        'recalled_at'           => 'datetime',
        'last_reminder_sent_at' => 'datetime',
        'reminder_count'        => 'integer',
    ];

    public function client(): BelongsTo  { return $this->belongsTo(Client::class); }
    public function branch(): BelongsTo  { return $this->belongsTo(Branch::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }

    /**
     * Polymorphic party. Resolves to one of Customer / Consignee / Vendor
     * based on the `model_name` column — these three share identical shapes
     * for the fields the signature flow needs (company_name, primary_email,
     * primaryAddress with cp_name / cp_email / cp_contact, etc.).
     */
    public function party(): BelongsTo
    {
        switch ($this->model_name) {
            case 'Customer':  return $this->belongsTo(Customer::class,  'party_id');
            case 'Consignee': return $this->belongsTo(Consignee::class, 'party_id');
            case 'Vendor':    return $this->belongsTo(Vendor::class,    'party_id');
            default:
                return $this->belongsTo(Customer::class, 'party_id')->whereRaw('1 = 0');
        }
    }

    /** Resolve every draft attached to this request. */
    public function documents(): Collection
    {
        $ids = is_array($this->trade_doc_ids) && !empty($this->trade_doc_ids)
            ? $this->trade_doc_ids
            : [$this->trade_doc_id];

        return ClmTradeDocLibrary::whereIn('id', $ids)->get();
    }

    /**
     * Same visibility rule the Customer/Consignee models use — delegates
     * to the shared MasterVisibility scope so this list page can't ever
     * leak data across the [[project_branch_hierarchy]] boundaries.
     */
    public function scopeForUser(Builder $q, $user): Builder
    {
        \App\Support\MasterVisibility::applyReadScope($q, $user);
        return $q;
    }

    public function scopePending(Builder $q): Builder
    {
        return $q->whereIn('status', ['draft', 'inprogress']);
    }

    public function scopeCompleted(Builder $q): Builder
    {
        return $q->where('status', 'completed');
    }
}
