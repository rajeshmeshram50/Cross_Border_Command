<?php

namespace App\Services;

use App\Models\ClmSegment;
use App\Models\ClmTncLibrary;
use App\Models\Product;

/**
 * Resolves the master Terms & Conditions that apply to a Purchase Order — matched
 * from the T&C Library by document type (domestic/international), document kind
 * (purchase order), supplier party (material/ffd/service) and each line product's
 * segment + regulatory tier. This is the SAME source the PO PDF renders as its
 * "Terms And Conditions" block, extracted here so the Zoho sync sends identical
 * T&C instead of only the PO's free-text `terms` field.
 */
class PoTncResolver
{
    /**
     * @return array<int, array{code:mixed, category:mixed, segment:string, content:mixed}>
     */
    public function forPurchaseOrder($po): array
    {
        $clientId = $po->client_id ?? null;
        if (!$clientId) return [];

        // Domestic vs International from the PO doc type ("Domestics" → domestic).
        $docTypeLc = mb_strtolower(trim((string) ($po->document_type ?? 'Domestic')));
        $docType   = str_contains($docTypeLc, 'international') ? 'international' : 'domestic';
        $docKind   = 'purchase order';

        // Supplier party the T&C must apply to, from po_type (Material / FFD / Services).
        $poTypeLc  = mb_strtolower((string) ($po->po_type ?? ''));
        $partyKey  = (str_contains($poTypeLc, 'ffd') || str_contains($poTypeLc, 'transport')) ? 'ffd'
                   : (str_contains($poTypeLc, 'service') ? 'service' : 'material');

        // PO items in sequence → their products → segments (name + tier).
        $items = collect($po->items ?? [])
            ->sortBy(fn ($it) => [(int) ($it->line_no ?? 0), (int) ($it->id ?? 0)])
            ->values();
        $productIds = $items->pluck('product_id')->filter()->unique()->values();
        if ($productIds->isEmpty()) return [];

        $prodToSeg = Product::whereIn('id', $productIds)->pluck('segment_id', 'id');
        $segById = ClmSegment::where('client_id', $clientId)
            ->whereIn('id', $prodToSeg->filter()->unique()->values())
            ->get(['id', 'name', 'regulatory_status'])
            ->keyBy('id');
        if ($segById->isEmpty()) return [];

        // Candidates: category matches doc type + "purchase order", AND the T&C
        // applies to this supplier type (party contains the keyword, or is All/blank).
        $candidates = ClmTncLibrary::where('client_id', $clientId)
            ->where(fn ($w) => $w->whereNull('status')->orWhere('status', 'active'))
            ->orderBy('id')
            ->get()
            ->filter(function ($row) use ($docType, $docKind, $partyKey) {
                $cat = mb_strtolower((string) $row->category);
                if (!str_contains($cat, $docType) || !str_contains($cat, $docKind)) return false;
                $party = mb_strtolower(trim((string) $row->party));
                return $party === '' || str_contains($party, 'all') || str_contains($party, $partyKey);
            });

        // Segment + tier match, product sequence, dedup by id.
        $matched = [];
        foreach ($items as $it) {
            $segId = $it->product_id ? ($prodToSeg[$it->product_id] ?? null) : null;
            if (!$segId) continue;
            $seg = $segById->get($segId);
            if (!$seg) continue;

            $segNameLc = mb_strtolower((string) $seg->name);
            $segReg    = (string) $seg->regulatory_status;

            foreach ($candidates as $row) {
                if (isset($matched[$row->id])) continue;
                if ((string) $row->regulatory !== $segReg) continue;
                $tncSegs = array_filter(array_map(
                    fn ($s) => mb_strtolower(trim($s)),
                    explode(',', (string) $row->segment)
                ));
                if (!in_array($segNameLc, $tncSegs, true)) continue;
                $matched[$row->id] = [
                    'code'     => $row->code,
                    'category' => $row->category,
                    'segment'  => $seg->name,
                    'content'  => $row->content,
                ];
            }
        }

        return array_values($matched);
    }

    /**
     * Flatten the matched T&C into a single plain-text block for a text field
     * (e.g. the Zoho PO `terms`): each segment's clauses, HTML stripped. The
     * caller caps the length; here we only build the text.
     */
    public function plainTextForPurchaseOrder($po): string
    {
        $parts = [];
        foreach ($this->forPurchaseOrder($po) as $tnc) {
            $body = trim($this->htmlToText((string) ($tnc['content'] ?? '')));
            if ($body === '') continue;
            $head = trim((string) ($tnc['segment'] ?? ''));
            $parts[] = ($head !== '' ? $head . "\n" : '') . $body;
        }
        return trim(implode("\n\n", $parts));
    }

    /** Rich-text (TipTap HTML) → readable plain text, keeping line breaks. */
    private function htmlToText(string $html): string
    {
        $s = preg_replace('/<\s*(br|\/p|\/li|\/div|\/h[1-6])\s*\/?\s*>/i', "\n", $html);
        $s = html_entity_decode(strip_tags((string) $s), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        // Collapse 3+ blank lines and trailing spaces.
        $s = preg_replace("/[ \t]+\n/", "\n", (string) $s);
        $s = preg_replace("/\n{3,}/", "\n\n", (string) $s);
        return (string) $s;
    }
}
