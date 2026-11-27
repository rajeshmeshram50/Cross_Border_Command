<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Collection;

class ClmSignatureRequest extends Model
{
    use SoftDeletes;

    protected $table = 'clm_signature_requests';

    public const DOC_TRADE             = 'trade_doc';
    public const DOC_AGREEMENT         = 'agreement';
    public const DOC_QUOTATION         = 'quotation';
    public const DOC_PROFORMA_INVOICE  = 'proforma_invoice';
    public const DOC_PURCHASE_ORDER    = 'purchase_order';
    public const DOC_P2P_PO_DOCUMENT   = 'p2p_po_document';

    protected $fillable = [
        'client_id', 'branch_id',
        'document_type', 'lead_id',
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

    public function documents(): Collection
    {
        $ids = is_array($this->trade_doc_ids) && !empty($this->trade_doc_ids)
            ? $this->trade_doc_ids
            : [$this->trade_doc_id];

        if (in_array($this->document_type, [self::DOC_QUOTATION, self::DOC_PROFORMA_INVOICE, self::DOC_PURCHASE_ORDER, self::DOC_P2P_PO_DOCUMENT], true)) {
            return new Collection();
        }
        if ($this->document_type === self::DOC_AGREEMENT) {
            return ClmAgreementLibrary::whereIn('id', $ids)->get();
        }
        return ClmTradeDocLibrary::whereIn('id', $ids)->get();
    }

    public const STATUS_SUPERSEDED = 'superseded';

    public static function hasSignedForDoc(int $clientId, string $documentType, int $docId): bool
    {
        return static::where('client_id', $clientId)
            ->where('document_type', $documentType)
            ->where('trade_doc_id', $docId)
            ->where('status', 'completed')
            ->exists();
    }

    public static function hasSentForDoc(int $clientId, string $documentType, int $docId): bool
    {
        return static::where('client_id', $clientId)
            ->where('document_type', $documentType)
            ->where('trade_doc_id', $docId)
            ->whereIn('status', ['inprogress', 'completed'])
            ->exists();
    }

    public static function awaitingSignatureForDoc(int $clientId, string $documentType, int $docId): ?self
    {
        return static::where('client_id', $clientId)
            ->where('document_type', $documentType)
            ->where('trade_doc_id', $docId)
            ->where('status', 'inprogress')
            ->orderByDesc('id')
            ->first();
    }

    public static function supersedeForDoc(int $clientId, string $documentType, int $docId): int
    {
        return static::where('client_id', $clientId)
            ->where('document_type', $documentType)
            ->where('trade_doc_id', $docId)
            ->whereIn('status', ['draft', 'inprogress'])
            ->update([
                'status'        => self::STATUS_SUPERSEDED,
                'recalled_at'   => now(),
                'recall_reason' => 'Document edited while signature was pending — superseded; re-send required.',
            ]);
    }

    public function scopeForUser(Builder $q, $user, ?int $branchFilter = null): Builder
    {
        \App\Support\MasterVisibility::applyReadScope($q, $user, $branchFilter);
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

    public static function hasSignedDraft(?int $clientId, int $docId, string $docType): bool
    {
        return static::hasDraftByStatus($clientId, $docId, $docType, ['completed']);
    }

    public static function hasUsedDraft(?int $clientId, int $docId, string $docType): bool
    {
        return static::hasDraftByStatus($clientId, $docId, $docType, ['inprogress', 'completed']);
    }

    public static function hasReferencingDraft(?int $clientId, int $docId, string $docType): bool
    {
        return static::hasDraftByStatus($clientId, $docId, $docType, ['draft', 'inprogress', 'completed']);
    }

    private static function hasDraftByStatus(?int $clientId, int $docId, string $docType, array $statuses): bool
    {
        if (!$clientId) return false;

        $libModel = $docType === self::DOC_AGREEMENT ? ClmAgreementLibrary::class : ClmTradeDocLibrary::class;
        $docCreatedAt = $libModel::where('client_id', $clientId)->where('id', $docId)->value('created_at');
        if (!$docCreatedAt) return false;

        return static::where('client_id', $clientId)
            ->where('document_type', $docType)
            ->whereIn('status', $statuses)
            ->where('created_at', '>=', $docCreatedAt)
            ->where(function (Builder $q) use ($docId) {
                $q->where('trade_doc_id', $docId)
                  ->orWhereJsonContains('trade_doc_ids', $docId);
            })
            ->exists();
    }

    public static function usedDraftIds(?int $clientId, string $docType): array
    {
        return static::draftIdsByStatus($clientId, $docType, ['inprogress', 'completed']);
    }

    public static function signedDraftIds(?int $clientId, string $docType): array
    {
        return static::draftIdsByStatus($clientId, $docType, ['completed'], true);
    }

    private static function draftIdsByStatus(?int $clientId, string $docType, array $statuses, bool $orEverCompleted = false): array
    {
        if (!$clientId) return [];

        $rows = static::where('client_id', $clientId)
            ->where('document_type', $docType)
            ->where(function ($q) use ($statuses, $orEverCompleted) {
                $q->whereIn('status', $statuses);
                if ($orEverCompleted) $q->orWhereNotNull('completed_at');
            })
            ->get(['trade_doc_id', 'trade_doc_ids', 'created_at']);

        $candidates = [];
        foreach ($rows as $r) {
            $refIds = is_array($r->trade_doc_ids) && !empty($r->trade_doc_ids)
                ? $r->trade_doc_ids
                : [$r->trade_doc_id];
            foreach ((array) $refIds as $id) {
                $id = (int) $id;
                if ($id) $candidates[$id][] = $r->created_at;
            }
        }
        if (empty($candidates)) return [];

        $libModel = $docType === self::DOC_AGREEMENT ? ClmAgreementLibrary::class : ClmTradeDocLibrary::class;
        $docCreated = $libModel::where('client_id', $clientId)
            ->whereIn('id', array_keys($candidates))
            ->pluck('created_at', 'id');

        $signed = [];
        foreach ($candidates as $id => $reqDates) {
            $docDate = $docCreated[$id] ?? null;
            if (!$docDate) continue;
            foreach ($reqDates as $rd) {
                if ($rd && \Illuminate\Support\Carbon::parse($rd)->gte(\Illuminate\Support\Carbon::parse($docDate))) {
                    $signed[] = $id;
                    break;
                }
            }
        }
        return array_values(array_unique($signed));
    }
}
