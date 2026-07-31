# TRADE DOCUMENTS — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Trade Documents**
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: Names tab (in-use lock) → Library tab (signed lock) → DOCX download → DOCX upload → PDF → party filter → code allocation.
File: [ClmTradeDocumentController.php](../../../../app/Http/Controllers/Api/ClmTradeDocumentController.php), trait [HandlesDocxHtmlRoundtrip.php](../../../../app/Http/Controllers/Concerns/HandlesDocxHtmlRoundtrip.php).

---

## 1. NAMES TAB

### `namesIndex()`
```php
if (!$user->client_id) return ['status'=>true,'data'=>[],'count'=>0];

$branchFilter = $request->integer('branch_id') ?: null;
$nameQuery = ClmTradeDocName::query()->orderBy('id','desc');   // newest type at the top
MasterVisibility::applyReadScope($nameQuery, $user, $branchFilter);
$rows = $nameQuery->get();

/* Usage map: how many Library drafts reference each name (by name STRING,
 * case-insensitive — the library links to it by name, not an FK). Drives the
 * "can't edit an in-use type" guard. Scope the count the same way so a branch
 * only counts library rows it can actually see. */
$usageQuery = ClmTradeDocLibrary::query();
MasterVisibility::applyReadScope($usageQuery, $user, $branchFilter);
$usage = $usageQuery->selectRaw('LOWER(TRIM(name)) as t, COUNT(*) as c')
                    ->groupBy(DB::raw('LOWER(TRIM(name))'))
                    ->pluck('c','t');
$rows->each(fn($row) => $row->in_use = (int)($usage[mb_strtolower(trim($row->name))] ?? 0));
```

### `namesStore()` — dedupe **inside** the lock
```php
$data = validate(['name' => 'required|string|max:255']);
$name = trim($data['name']);

// The dedupe + insert BOTH run under the per-client lock so two concurrent
// "Add" requests can't slip a duplicate past the check. Scoped to the caller's
// visibility so a sibling branch that can't see this row may still reuse the name.
$result = DB::transaction(function () use ($user, $name) {
    DB::table('clients')->where('id',$user->client_id)->lockForUpdate()->first();

    $dupe = ClmTradeDocName::query()->whereRaw('LOWER(TRIM(name)) = ?', [mb_strtolower($name)]);
    MasterVisibility::applyReadScope($dupe, $user, $user->branch_id ?: null);
    if ($dupe->exists()) return ['dupe' => true];

    $code = $this->nextCode(ClmTradeDocName::class, $user->client_id, $user->branch_id, 'TDN-');
    return ['row' => ClmTradeDocName::create([... 'branch_id'=>$user->branch_id, 'code'=>$code ...])];
});

if (!empty($result['dupe'])) → 422 "A trade document type named \"{$name}\" already exists…"
→ 201 { data: $result['row'] }
```
This is the only CLM master that puts the duplicate check *inside* the transaction — the others check first, then insert.

### `namesUpdate()` / `namesDestroy()` — the in-use lock
```php
scoped firstOrFail → hierarchicalDenial → 403

// Block edit/delete while library drafts reference this name — the library links
// to it by the name STRING, so renaming would orphan those drafts.
$usedBy = ClmTradeDocLibrary::where('client_id',$user->client_id)
            ->whereRaw('LOWER(TRIM(name)) = ?', [mb_strtolower(trim($row->name))])->count();
if ($usedBy > 0) → 409 "This trade document type is used by {$usedBy} draft(s) …"

// update: also reject a rename that collides with another VISIBLE type → 422
$row->update(['name'=>$name, 'updated_by'=>$user->id]);
```

---

## 2. LIBRARY TAB

### `libraryIndex()`
```php
$libQuery = ClmTradeDocLibrary::query()->orderBy('id','desc');   // newest draft first
MasterVisibility::applyReadScope($libQuery, $user, $branchFilter);
$rows = $libQuery->get();

// Flag rows that have a signed (completed) signature request so the frontend can
// lock Edit / Delete. BATCH lookup avoids an N+1 of per-row existence checks.
$signedIds = ClmSignatureRequest::signedDraftIds($user->client_id, ClmSignatureRequest::DOC_TRADE);
$rows->each(fn($r) => $r->setAttribute('is_signed', in_array((int)$r->id, $signedIds, true)));
```

### `libraryStore()`
```php
$data = validate([
    'name'=>'required|max:255',      // the TYPE name, picked from the Names catalogue
    'title'=>'required|max:255', 'doc_type'=>'required|max:64',
    'purpose'=>'required|max:500', 'party'=>'required|max:255',
    'regulatory'=>'nullable|in:highly,less',
    'segment'=>'required|max:500',   // MANDATORY — at least one; the frontend mirrors this
    'file_path'=>'nullable|max:500', 'content'=>'nullable|string',
    // Stage 2 page-shell config — same JSON shape as hr_document_templates.
    // The frontend layers it on top of DEFAULT_HEADER / DEFAULT_FOOTER so missing keys stay safe.
    'header_config'=>'nullable|array', 'footer_config'=>'nullable|array',
]);

DB::transaction(function () use ($user,$data) {
    DB::table('clients')->where('id',$user->client_id)->lockForUpdate()->first();
    // Library codes use TDL-. Legacy TD- rows were renamed by migration so the
    // sequence stays continuous.
    $code = $this->nextCode(ClmTradeDocLibrary::class, $user->client_id, $user->branch_id, 'TDL-');
    return ClmTradeDocLibrary::create($data + ['client_id'=>…, 'branch_id'=>…, 'code'=>$code, …]);
});
→ 201
```

### `libraryUpdate()` — the signed lock + docx invalidation
```php
scoped firstOrFail → hierarchicalDenial('edit') → 403   // branch users may VIEW shared
                                                        // client-level drafts, not edit them

// Lock once the draft has been sent AND signed. A trade document that has come
// back signed via Zoho is a LEGAL RECORD — editing it would silently diverge the
// master from the copy the customer/consignee actually signed.
if (ClmSignatureRequest::hasSignedDraft($user->client_id, (int)$row->id, DOC_TRADE))
    → 422 'This trade document has already been signed by the customer/consignee
           and can no longer be edited.'

$data = validate([...same fields, all `sometimes`...]);
$data['updated_by'] = $user->id;

// If the editor content was edited and saved, the previously-uploaded Word file no
// longer matches it. downloadDocx() PREFERS that stored file, so it would keep
// serving the OLD document. Drop docx_path here (only when the content actually
// changed) so the download regenerates from the edited HTML.
if (array_key_exists('content',$data) && $data['content'] !== null && $data['content'] !== $row->content) {
    if ($row->docx_path) try { Storage::disk('public')->delete($row->docx_path); } catch (…) {}
    $data['docx_path'] = null; $data['docx_original_name'] = null;
}
$row->update($data);
```

`libraryDestroy()` applies the **same** signed lock, then deletes.

---

## 3. DOCX DOWNLOAD (`downloadDocx`)

```php
scoped firstOrFail;

// DOCX generation is memory- and time-heavy for table-rich documents. The web SAPI's
// defaults can be lower than CLI, producing intermittent OOM 500s that surface as a
// generic "Download failed". Raise both defensively for THIS request only.
@ini_set('memory_limit','1024M'); @set_time_limit(300);

// (1) Prefer the user-uploaded DOCX — it's the source of truth after a Word round-trip
//     (preserves header/footer/styling we can't fully reproduce from HTML alone).
if ($row->docx_path && Storage::disk('public')->exists($row->docx_path)) {
    try {
        // Stream via the Storage disk — works for local AND cloud disks (Azure Blob).
        // response()->download() needs a real local path and 500s with "The file does
        // not exist" (leaking the path) when the file lives on a cloud disk.
        return Storage::disk('public')->download($row->docx_path, $name);
    } catch (\Throwable $e) { /* fall through and regenerate */ }
}

// (2) Guard oversized content — past this PhpWord crashes the request (500).
if (mb_strlen($row->content) > self::RENDER_MAX_CHARS)     // 1,000,000 chars ≈ 1 MB
    → 422 'too large to generate as a Word file — X MB (N characters). The limit is …'

// (3) Generate from HTML
$phpWord = new PhpWord(); setDefaultFontName('Calibri'); setDefaultFontSize(11);
$section = $phpWord->addSection();

// page-shell header/footer; the logo is resolved from header.logo_path →
// the /storage/ path inside header.logo_url → client->logo, first hit wins
$this->applyDocxHeaderFooter($section, $headerCfg, $footerCfg, $logoAbs);
// NB: the document TITLE is deliberately NOT prepended to the body — the page-shell
// header already identifies the document, and prepending duplicated the heading.

$html = $this->normaliseEditorHtml($html);   // <font>, span-bold, div-align →
                                             // the inline-tag + CSS shapes PhpWord knows
$html = $this->toWellFormedHtml($html);      // contentEditable emits HTML, not XHTML;
                                             // PhpWord parses with strict loadXML and
                                             // silently mangled tables into run-on text
$wrapped = '<!DOCTYPE html><html><body>'.$html.'</body></html>';   // full doc, not a fragment

try { Html::addHtml($section, $wrapped, true, false); }
catch (\Throwable $e) { $section->addText(strip_tags($html)); }    // last-resort fallback

IOFactory::createWriter($phpWord,'Word2007')->save($tmp);
return response()->download($tmp, $filename, [...])->deleteFileAfterSend(true);
```

---

## 4. DOCX UPLOAD (`uploadDocx`)

```php
scoped firstOrFail → hierarchicalDenial('edit') → 403
$this->validateDocxUpload($request);
@ini_set('memory_limit','1024M'); @set_time_limit(300);

$path = $file->storeAs("trade_doc_library/c{$clientId}/t{$row->id}", Str::random(16).'.'.$ext, 'public');

// Read the stored BYTES into a temp LOCAL file before converting: on a cloud disk
// (Azure Blob, used on the server) Storage::path() returns an unreadable path, so
// ZipArchive/PhpWord silently fail and the editor goes blank. ->get() works on both.
$tmpDocx = tempnam(sys_get_temp_dir(),'docxconv_').'.docx';
file_put_contents($tmpDocx, Storage::disk('public')->get($path));
$html = $this->docxToHtml($tmpDocx);
@unlink($tmpDocx);

// If nothing readable came out, DON'T silently keep the old content — tell the user.
// The usual cause is an older .doc (binary) file the converter can't read.
if ($convFailed || trim(strip_tags($html)) === '') {
    Storage::disk('public')->delete($path);
    → 422  $ext === 'doc'
           ? 'This looks like an older .doc file… Save As → Word Document (.docx), then upload.'
           : 'We couldn\'t read any content from this Word file…'
}

// Reject a document over the render cap — it could never be downloaded afterwards.
if (mb_strlen($html) > self::RENDER_MAX_CHARS) { delete file; → 422 'too large — X MB…' }

$row->update(['docx_path'=>$path, 'docx_original_name'=>$file->getClientOriginalName(),
              'content'=>$html, 'updated_by'=>$user->id]);
```

### `validateDocxUpload()` — why not `mimes:docx`
```php
$request->validate(['docx' => ['required','file','max:'.self::DOCX_MAX_KB]]);   // 20 MB
$ext = strtolower($request->file('docx')->getClientOriginalExtension());
if (!in_array($ext, ['doc','docx'], true)) throw ValidationException…

/* We deliberately do NOT use `mimes:doc,docx`: a .docx is a ZIP container, and
 * php-fileinfo on many servers reports it as application/zip (or octet-stream), so
 * `mimes:docx` rejects perfectly valid Word files with a 422 ("Import failed").
 * Instead we check file + size + the client extension. Genuinely broken content
 * still fails safely later, when PhpWord tries to read it (caught → friendly 422). */
```

### `docxToHtmlPreview()`
Standalone conversion with **no library row and no persistence** — used by editors that aren't backed by a saved record (notably the CTC agreement draft editor's "Upload Doc"). Reads the uploaded file's temp path directly.

---

## 5. PDF DOWNLOAD (`downloadPdf`)

```php
scoped firstOrFail; raise memory/time; RENDER_MAX_CHARS guard → 422

// Resolve the header logo to base64 — dompdf CAN'T fetch /storage URLs at render time.
// Prefer header.logo_path → the path inside header.logo_url → client brand logo.
$headerLogoBase64 = $this->resolveLogoBase64($headerConfig['logo_path'] ?? null,
                                             $logoUrlPath, $client?->logo);
// RAW base64 only — the blade wraps it in `data:image/png;base64,{{ … }}` itself,
// so a data-URI prefix here would double up and break the <img>.

$pdf = Pdf::loadView('pdf.clm-signature-document', [
    'document'=>$row, 'modelName'=>'Trade Document', 'processedHtml'=>$html,
    'generatedDate'=>now()->format('d/m/Y'), 'requestId'=>$row->code,
    'signers'=>[],                       // ← no signature block on a master download
    'client'=>$client, 'headerConfig'=>…, 'footerConfig'=>…, 'headerLogoBase64'=>…,
])->setPaper('a4')->setOption('isPhpEnabled', true);   // isPhpEnabled → footer page numbers

return $pdf->download($row->code.'.pdf');
```
Placeholders are left **as-is** — they only auto-fill at send time, when a party is bound.

---

## 6. PARTY FILTER (`libraryForParty`)

```php
/* Returns library rows whose `party` CSV mentions the given party key. Three logical buckets:
 *   buyer / customer → matches "Buyer"
 *   consignee        → matches "Consignee"
 *   supplier         → matches ANY "Supplier-*" sub-type
 * Anything else falls through to a literal substring match so a caller can request
 * a specific Supplier-* sub-type if needed. */

$q = ClmTradeDocLibrary::where('client_id', $user->client_id);   // ← CLIENT-scoped only,
                                                                 //   NOT branch-scoped
$key = strtolower(trim($party));
if ($key === 'buyer' || $key === 'customer') $q->where('party','like','%Buyer%');
elseif ($key === 'consignee')                $q->where('party','like','%Consignee%');
elseif ($key === 'supplier')                 $q->where('party','like','%Supplier-%');
else                                          $q->where('party','like','%'.$party.'%');

return ['data' => $q->orderBy('id')->get()];
```

---

## 7. HEADER LOGO UPLOAD (`uploadHeaderLogo`)

```php
validate(['logo'=>'required|file|mimes:png,jpg,jpeg,svg,webp|max:5120']);
$path = $file->storeAs("trade_doc_library/c{$clientId}/logos", Str::random(16).'.'.$ext, 'public');
return ['path'=>$path, 'url'=>file_url($path)];   // exactly the shape HeaderFooterPanel expects
```
The path isn't attached to a row here — that happens when the user saves the form and it lands inside `header_config`. This keeps the endpoint usable for brand-new, not-yet-saved drafts.

---

## 8. CODE ALLOCATION (`nextCode`)

```php
// Branch-scoped so each branch restarts its own sequence from 001 (TDL-001 / TDN-001)
// rather than continuing another branch's tally. A client-level creator ($branchId
// null) sequences the shared rows. Caller already holds the client row lock;
// UNIQUE(client_id, branch_id, code) is the final guard.
$query = $modelClass::where('client_id',$clientId);
$branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id',$branchId);
$maxN = max over /^{prefix}(\d+)$/;
do { $n++; $code = sprintf('%s%03d', $prefix, $n); } while (isset($taken[$code]));
```

---

## 9. DOWNSTREAM CONSUMPTION

```php
// Zoho send — ClmSignatureController::send()
'trade_doc_ids' => [12,15]        // max 10
foreach ($orderedDocs as $doc) renderPdf($doc, $party, …, $headerOverride, $footerOverride,
                                         $contentOverride, $lead) → temp PDF
// per-doc overrides are keyed by trade_doc_id and NEVER mutate the saved row
document_type = 'trade_doc'; trade_doc_id = first; trade_doc_ids = all

// Sales Matrix — ClmAgreementController::applicableForLead()
$latestPerTradeDoc[$tradeDocId] = most recent DOC_TRADE signature request for this lead
segmentTradeDocs($seg, $cid, $partyOwners, $latestPerTradeDoc)
    → per-segment trade documents with live Sent/Signed badges, Remind count and download links

// Evidence Vault — SegmentDocUploadController
overlaySupplierDocs($libDocs, $reqs, DOC_TRADE)   // signature status per row
```

---

## 10. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Dedupe **inside** the transaction + client lock | `namesStore` | Two concurrent adds can't both pass |
| In-use count by `LOWER(TRIM(name))`, scoped | `namesIndex/Update/Destroy` | The library links by string, not FK |
| Batched `signedDraftIds()` | `libraryIndex` | Avoids N+1 existence checks |
| Signed lock on update **and** delete | library | A signed document is a legal record |
| Drop `docx_path` when content changes | `libraryUpdate` | Downloads must not serve a stale Word file |
| Prefer stored DOCX over regeneration | `downloadDocx` | Word round-trips preserve styling HTML can't |
| Stream through the Storage disk | `downloadDocx` | Azure Blob has no local path |
| Bytes → local temp file before conversion | `uploadDocx` | `Storage::path()` is unusable on cloud disks |
| Extension check, not MIME | `validateDocxUpload` | `.docx` is a ZIP; fileinfo misreports it |
| `RENDER_MAX_CHARS` + raised memory/time | all render paths | Clean 422 instead of a worker OOM |
| Raw base64 logo (no data-URI prefix) | `downloadPdf` | The blade adds the prefix itself |
| `whereNumber('id')` on `{id}` routes | routes | Keeps `/for-party/{party}` from being swallowed |

---

## 11. NOTES & CAVEATS

- `libraryForParty()` is **client-scoped only**, unlike every other list on this controller.
- The signed lock fires on `completed`, so a draft stays editable while a signature is in flight.
- `hasSignedDraft` / `signedDraftIds` include an **id-reuse guard**: a request only locks a draft created at or before it, so re-seeding the library doesn't re-lock fresh rows.
- Legacy `TD-` codes were renamed to `TDL-` by migration; the allocator's regex matches only the current prefix.
- There is no version history — editing a draft overwrites it.
- DB is PostgreSQL.

---

*Related documents: TRADE_DOCUMENTS_FUNCTIONAL_DOCUMENTATION.md · TRADE_DOCUMENTS_TECHNICAL_DOCUMENTATION.md · TRADE_DOCUMENTS_API_DOCUMENTATION.md*
