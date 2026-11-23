# Blade & PDF Template Comment Cleanup Sheet

| Field | Value |
|---|---|
| Date | 23 November 2026 |
| Branch | `kryptone-dev` |
| Scope | `resources/views/**/*.blade.php` (57 files scanned: PDF, email, invoice, legal, mail vendor templates) |
| Related | [Backend Dead Code Cleanup Sheet](BACKEND_DEAD_CODE_CLEANUP_SHEET.md) |

## 1. Summary

| Item | Count |
|---|---|
| Blade files scanned | 57 |
| Files changed | 38 |
| Files with no comments (unchanged) | 19 |
| Lines removed | 1,550 |
| Outlook conditional comments kept | 62 |

## 2. What was removed

| Comment type | Where | Removed |
|---|---|---|
| `{{-- ... --}}` | Blade comments, everywhere | Yes |
| `<!-- ... -->` | HTML comments | Yes |
| `/* ... */` | CSS inside `<style>` | Yes |
| `//`, `#`, `/* */`, `/** */` | PHP inside `@php ... @endphp` and `<script type="text/php">` (DomPDF page numbers) | Yes (PHP tokenizer) |
| `//`, `/* */` | JS inside `<script>` | Yes (string / URL / regex aware) |

## 3. What was intentionally kept

- **Outlook conditional comments** in emails: `<!--[if mso]>`, `<!--[if !mso]><!-- -->`, `<!--<![endif]-->`, `<![endif]-->`. These are layout code for Outlook, not comments. All 62 are still present.
- Strings, URLs (`'/sw.js'`, `https://...`) and JS regex literals such as `/^\d+\.\s*/`.
- No markup, CSS rule, Blade directive or PHP/JS statement was changed — only comments and the blank lines they left behind.

## 4. Verification

| Check | Result |
|---|---|
| Every edited line = original line minus a trailing comment | 0 suspect edits |
| `php artisan view:cache` + `php -l` on all compiled views | 101 compiled, 0 errors |
| `node --check` on every `<script>` block, before vs after | No change in result |
| Render test: same data rendered with the old (git) and new templates, comments then stripped from the old output | Quotation x2, PI x2, PO x2 — output **identical** |
| Outlook conditional comments before / after | 62 / 62 |

Not render-tested with data (compile + line checks only): email templates, debit note, payslip, SPI box sticker, inventory label, CLM signature document, signed document. Open one of each once to confirm.

## 5. Lines removed by folder

| Folder | Files | Lines removed |
|---|---|---|
| `resources/views/pdf` | 13 | 1166 |
| `resources/views/emails` | 18 | 335 |
| `resources/views/invoices` | 1 | 14 |
| `resources/views (root)` | 1 | 13 |
| `resources/views/vendor/mail` | 3 | 10 |
| `resources/views/legal` | 1 | 7 |
| `resources/views/pdf/partials` | 1 | 5 |

## 6. Lines removed per file

| # | File | Lines removed |
|---|---|---|
| 1 | `resources/views/pdf/clm-signature-document.blade.php` | 352 |
| 2 | `resources/views/pdf/proforma-invoice.blade.php` | 311 |
| 3 | `resources/views/pdf/spi-box-sticker.blade.php` | 123 |
| 4 | `resources/views/pdf/inventory-label.blade.php` | 64 |
| 5 | `resources/views/pdf/purchase-order.blade.php` | 58 |
| 6 | `resources/views/emails/employee-email-changed.blade.php` | 49 |
| 7 | `resources/views/pdf/proforma-invoice-static.blade.php` | 47 |
| 8 | `resources/views/pdf/signed-document.blade.php` | 44 |
| 9 | `resources/views/pdf/debit-note.blade.php` | 42 |
| 10 | `resources/views/pdf/payslip.blade.php` | 33 |
| 11 | `resources/views/emails/payment-invoice.blade.php` | 31 |
| 12 | `resources/views/emails/sales-reminder.blade.php` | 31 |
| 13 | `resources/views/pdf/stamp-paper.blade.php` | 30 |
| 14 | `resources/views/pdf/shared_price_quotation.blade.php` | 29 |
| 15 | `resources/views/emails/announcement-published.blade.php` | 26 |
| 16 | `resources/views/emails/password-changed.blade.php` | 26 |
| 17 | `resources/views/emails/password-reset-otp.blade.php` | 24 |
| 18 | `resources/views/emails/welcome-credentials.blade.php` | 23 |
| 19 | `resources/views/emails/plan-reminder.blade.php` | 21 |
| 20 | `resources/views/pdf/vendor-credit.blade.php` | 20 |
| 21 | `resources/views/emails/hiring-request-created.blade.php` | 19 |
| 22 | `resources/views/emails/sales-document.blade.php` | 19 |
| 23 | `resources/views/emails/onboarding-invite.blade.php` | 17 |
| 24 | `resources/views/invoices/payment-invoice.blade.php` | 14 |
| 25 | `resources/views/pdf/expense-export.blade.php` | 13 |
| 26 | `resources/views/welcome.blade.php` | 13 |
| 27 | `resources/views/emails/signed-document.blade.php` | 12 |
| 28 | `resources/views/emails/exit-farewell.blade.php` | 10 |
| 29 | `resources/views/emails/probation-completed.blade.php` | 8 |
| 30 | `resources/views/emails/subscription-expiry-reminder.blade.php` | 7 |
| 31 | `resources/views/legal/layout.blade.php` | 7 |
| 32 | `resources/views/emails/composed.blade.php` | 6 |
| 33 | `resources/views/pdf/partials/sales-doc-tnc-header.blade.php` | 5 |
| 34 | `resources/views/vendor/mail/html/message.blade.php` | 4 |
| 35 | `resources/views/vendor/mail/text/message.blade.php` | 4 |
| 36 | `resources/views/emails/credvault-share.blade.php` | 3 |
| 37 | `resources/views/emails/payslip.blade.php` | 3 |
| 38 | `resources/views/vendor/mail/html/layout.blade.php` | 2 |
