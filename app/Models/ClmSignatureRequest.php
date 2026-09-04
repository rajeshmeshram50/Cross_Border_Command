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

    public const DOC_TRADE             = 'trade_doc';
    public const DOC_AGREEMENT         = 'agreement';
    // Sales-matrix documents (Stage 5). These don't live in a CLM library
    // table — the signed source is the rendered Quotation / PI PDF — so
    // `documents()` short-circuits for them (see below). `trade_doc_id`
    // holds the quotation / proforma_invoice id.
    public const DOC_QUOTATION         = 'quotation';
    public const DOC_PROFORMA_INVOICE  = 'proforma_invoice';
    // Purchase Order (P2P). Like Quotation / PI it has no CLM library row — the
    // signed source is the rendered PO PDF — so `documents()` short-circuits for
    // it too. `trade_doc_id` holds the purchase_order id.
    public const DOC_PURCHASE_ORDER    = 'purchase_order';

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

    /** Resolve every draft attached to this request — picks the right
     *  library table based on `document_type` so both trade-doc and
     *  agreement requests round-trip cleanly. */
    public function documents(): Collection
    {
        $ids = is_array($this->trade_doc_ids) && !empty($this->trade_doc_ids)
            ? $this->trade_doc_ids
            : [$this->trade_doc_id];

        // Sales-matrix docs (Quotation / PI) have no CLM library row — the
        // signed source is a rendered PDF — so there's nothing to resolve
        // here. Return empty so the trade-doc/agreement lock-check helpers
        // never mis-query the wrong library table for these types.
        if (in_array($this->document_type, [self::DOC_QUOTATION, self::DOC_PROFORMA_INVOICE, self::DOC_PURCHASE_ORDER], true)) {
            return new Collection();
        }
        if ($this->document_type === self::DOC_AGREEMENT) {
            return ClmAgreementLibrary::whereIn('id', $ids)->get();
        }
        return ClmTradeDocLibrary::whereIn('id', $ids)->get();
    }

    public const STATUS_SUPERSEDED = 'superseded';

    /**
     * True when the sales document (Quotation / Proforma Invoice) already has
     * a COMPLETED e-signature — used to lock the document against edits.
     */
    public static function hasSignedForDoc(int $clientId, string $documentType, int $docId): bool
    {
        return static::where('client_id', $clientId)
            ->where('document_type', $documentType)
            ->where('trade_doc_id', $docId)
            ->where('status', 'completed')
            ->exists();
    }

    /**
     * True when the sales document has been SENT for signature at least once
     * (still in progress, or already completed). Used to gate Stage 6: once
     * the PI is out for the customer's signature the deal may advance to
     * Victory — we no longer wait for the signing to finish.
     */
    public static function hasSentForDoc(int $clientId, string $documentType, int $docId): bool
    {
        return static::where('client_id', $clientId)
            ->where('document_type', $documentType)
            ->where('trade_doc_id', $docId)
            ->whereIn('status', ['inprogress', 'completed'])
            ->exists();
    }

    /**
     * Mark any still-pending (draft / inprogress) signature request for a
     * sales document as superseded — called when that document is EDITED
     * while a signature is in flight, so the stale request no longer counts
     * and the updated document must be re-sent. COMPLETED (signed) requests
     * are NOT touched: a signed document is locked against editing instead
     * (see hasSignedForDoc). Returns the number of rows affected.
     */
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

    /**
     * Same visibility rule the Customer/Consignee models use — delegates
     * to the shared MasterVisibility scope so this list page can't ever
     * leak data across the [[project_branch_hierarchy]] boundaries.
     */
    public function scopeForUser(Builder $q, $user, ?int $branchFilter = null): Builder
    {
        // $branchFilter = BranchSwitcher narrowing; see Customer::scopeForUser.
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

    /**
     * Has a draft of the given doc type ever come back signed?
     *
     * A "signed" draft is one whose Zoho request reached `completed`. The
     * doc id can live either in the legacy single `trade_doc_id` column or
     * inside the `trade_doc_ids` JSON array (multi-doc sends), so we check
     * both. Used by the Trade Document + Agreement library controllers to
     * lock a draft against edit/delete once its signed copy exists.
     */
    public static function hasSignedDraft(?int $clientId, int $docId, string $docType): bool
    {
        return static::hasDraftByStatus($clientId, $docId, $docType, ['completed']);
    }

    /**
     * True when a single draft has been SENT for signature at least once
     * (in-progress OR completed) — the draft is "in use" and must not be
     * edited/deleted. Single-row mirror of usedDraftIds(); superset of
     * hasSignedDraft().
     */
    public static function hasUsedDraft(?int $clientId, int $docId, string $docType): bool
    {
        return static::hasDraftByStatus($clientId, $docId, $docType, ['inprogress', 'completed']);
    }

    /**
     * True when a draft is referenced by ANY signature request that isn't void —
     * a send that is still 'draft' (created but Zoho not yet confirmed),
     * 'inprogress' (out for signature) or 'completed' (signed). Used by the
     * library DELETE guard: once a signature request exists for a draft the
     * document is in use and must not be deleted, even before Zoho flips it to
     * in-progress. (hasUsedDraft — edit lock — stays inprogress/completed only.)
     */
    public static function hasReferencingDraft(?int $clientId, int $docId, string $docType): bool
    {
        return static::hasDraftByStatus($clientId, $docId, $docType, ['draft', 'inprogress', 'completed']);
    }

    private static function hasDraftByStatus(?int $clientId, int $docId, string $docType, array $statuses): bool
    {
        if (!$clientId) return false;

        // Guard against draft-id REUSE. A matching request only locks a draft
        // if it was created at/after the draft's own creation. Otherwise an
        // orphaned request left behind by a since-DELETED draft — whose id was
        // later reused by a brand-new draft — would wrongly mark the new draft
        // as locked. (Happens when the library is wiped and re-seeded: ids
        // restart and collide with stale signature requests.)
        $libModel = $docType === self::DOC_AGREEMENT ? ClmAgreementLibrary::class : ClmTradeDocLibrary::class;
        $docCreatedAt = $libModel::where('client_id', $clientId)->where('id', $docId)->value('created_at');
        if (!$docCreatedAt) return false;   // draft gone → nothing to lock

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

    /**
     * All draft ids (of the given doc type) that have a signed/completed
     * signature request, for one tenant. Batch version of hasSignedDraft —
     * lets a list endpoint flag every locked row without an N+1 of
     * existence checks. Pulls ids from both the legacy single `trade_doc_id`
     * column and the `trade_doc_ids` JSON array.
     *
     * @return int[]
     */
    /**
     * Draft ids that have been SENT for signature at least once (still
     * in-progress OR completed) — i.e. the draft is "in use" and must not be
     * edited/deleted from the library. Superset of signedDraftIds().
     */
    public static function usedDraftIds(?int $clientId, string $docType): array
    {
        return static::draftIdsByStatus($clientId, $docType, ['inprogress', 'completed']);
    }

    /**
     * Drafts that must never be edited again because SOMEBODY has signed them.
     *
     * "status = completed" alone is not that question. A request's status is a
     * single field describing where it is NOW, so when a second party declines,
     * the row moves to 'declined' and the first party's completed signature
     * stops counting — the Edit button comes back on a document that has
     * already been signed. That is the reported bug: two customers on one
     * document, A signs, B rejects, and A's signed copy becomes editable.
     *
     * completed_at is the durable fact. It is stamped when a signature actually
     * completes and is not cleared by a later decline, so it still answers
     * "was this ever signed?" after the status has moved on.
     *
     * Signing is one-way: once a document is signed it stays locked, whatever
     * anyone else does afterwards.
     */
    public static function signedDraftIds(?int $clientId, string $docType): array
    {
        return static::draftIdsByStatus($clientId, $docType, ['completed'], true);
    }

    /**
     * Shared resolver behind signedDraftIds() / usedDraftIds(): draft ids
     * referenced by a signature request whose status is in $statuses AND that
     * was created at/after the draft's own creation (the id-reuse guard).
     */
    /**
     * @param bool $orEverCompleted  Also match rows that carry a completed_at,
     *        whatever their current status. Only the signed-lock uses this; the
     *        other callers ask about the CURRENT state and must not.
     */
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

        // Candidate draft id => the matching-request timestamps referencing it.
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

        // Pull each candidate draft's creation time from the right library
        // table so we can apply the same id-reuse guard as hasSignedDraft():
        // a draft counts only when a matching request both references it AND
        // was created at/after the draft's own creation.
        $libModel = $docType === self::DOC_AGREEMENT ? ClmAgreementLibrary::class : ClmTradeDocLibrary::class;
        $docCreated = $libModel::where('client_id', $clientId)
            ->whereIn('id', array_keys($candidates))
            ->pluck('created_at', 'id');

        $signed = [];
        foreach ($candidates as $id => $reqDates) {
            $docDate = $docCreated[$id] ?? null;
            if (!$docDate) continue;   // draft no longer exists → not signed
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
