# Zoho Sign Integration — Functional Documentation

> Cross_Border_Command • electronic signatures for CLM agreements, trade documents and
> Purchase Orders. A complete, beginner-friendly guide.

## Document Control

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-30 | System | Initial Zoho Sign functional reference |
| 2.0 | 2026-07-30 | System | Expanded, fresher-friendly edition |

---

## 0. Read this first — what is e-signature, and why?

Traditionally, to get a contract signed you would print it, courier it, wait for the other
party to sign, and courier it back — days of delay and a paper trail nobody can find later.

**Electronic signature (e-sign)** replaces all that. You send the document electronically;
the other party clicks to sign inside their browser; the signed PDF and a tamper-proof
**certificate of completion** come back instantly and are stored digitally. It's legally
valid and auditable.

**Zoho Sign** is the e-signature service our app uses. Think of it as the trusted
middleman: we hand Zoho the document and the list of signers; Zoho emails them, collects
the signatures, and hands us back the signed result.

> **Important:** Zoho **Sign** and Zoho **Books** are two *different* Zoho products. Sign is
> about signatures; Books is about accounting. They use different apps, different tokens, and
> different servers. Don't confuse them.

---

## 1. What this integration does

From our app a user can:
1. **Preview** a document (see exactly what will be signed).
2. **Place a signature box** on the page (where the signer signs).
3. **Add signers** (name + email, optionally in a signing order).
4. **Send** it out for signature via Zoho.
5. **Track** progress, **remind** a slow signer, or **recall** (withdraw) the request.
6. **Download** the signed PDF and the completion **certificate** once done.

All of this happens inside the app — the user never logs in to Zoho directly.

---

## 2. What can be sent for signature

| Document | Where you start it |
|---|---|
| **CLM Agreements** (supplier / customer / consignee) | the Send-for-Signature modal |
| **CLM Trade Documents** | the Send-for-Signature modal |
| **Purchase Order** PDF | Procure to Pay → Purchase Order → **Stage 4** → "Send for Sign" |
| **CTC** (case-to-case contracts) | CLM CTC |
| **Sales documents** (quotation / PI style) | the sales-doc send flow |

A single request can carry up to **10 documents** and up to **5 signers**.

---

## 3. The flow, step by step (what the user experiences)

```
 1. PREVIEW ──► 2. PLACE BOX ──► 3. ADD SIGNERS ──► 4. SEND ──► 5. TRACK ──► 6. DOWNLOAD
    (see PDF)     (drag where       (name+email)      (to Zoho)   (status)     (signed PDF +
                   they sign)                                                    certificate)
```

1. **Preview.** The document renders as a PDF in the popup (using an in-browser PDF viewer
   called pdf.js). You can tweak the header/footer/body inline and the preview updates —
   without changing the saved template.
2. **Place the signature box.** You drag a box onto the page where the signer should sign.
   The app tries to auto-detect a `{{signature}}`-style marker in the document to position
   the box for you.
3. **Add signers.** Enter each signer's name and email. You can set a signing **order** (so
   signer 2 only gets it after signer 1 finishes).
4. **Send.** The app renders the final PDF(s), creates the request in Zoho Sign, uploads the
   documents, and submits the signer field positions. Zoho then emails the signers.
5. **Track / Remind / Recall.** From the list you can see live status, send a reminder, or
   withdraw the request (with a reason).
6. **Download.** Once signed, pull the signed PDF, an individual document, or the
   **certificate of completion** (which records who signed, when, and from where). A
   *declined* document can also be downloaded.

---

## 4. Status lifecycle — what the states mean

```
 draft ──► sent (in progress) ──► signed        ✅ everyone signed
                              ├──► declined      ❌ a signer refused
                              ├──► recalled      ↩️ we withdrew it
                              └──► expired        ⏰ nobody signed in time (default 30 days)
```

**How does the app know the status changed?** It **polls** Zoho — it periodically asks Zoho
"what's the status now?" and updates our copy. (This is different from a *webhook*, where
Zoho would push us the update; we don't use webhooks here — see the Technical tab.) So an
in-progress request flips to *Signed* on its own within the polling window, without anyone
clicking anything.

---

## 5. Testing mode

In non-production environments a **testing mode** flag (`ZOHO_TESTING_MODE`) lets testers
exercise the whole flow **without** sending real emails or consuming Zoho credits. The
modal shows when a send was simulated, so testers aren't confused about "why didn't the
email arrive?".

---

## 6. Error messages — clean, never raw

When Zoho rejects something, the app deliberately **hides the raw technical error** and
shows a friendly message instead. This matters because raw third-party errors are scary and
meaningless to end users.

| Situation | What you'll see |
|---|---|
| The document is already out for signature / already signed / being processed elsewhere | "This document has already been signed or is being processed in another tab or session. Refresh the page to see its current status." |
| Any other Zoho failure | "The e-signature service could not process this request right now. Please try again in a moment." |
| The preview can't render | "Preview failed — could not render the document. Check the draft content." |

> **Common gotcha:** if you open the same document in two tabs and send from both, the
> second send hits the "already being processed" message — that's expected, not a bug.

---

## 7. Why a preview might look empty

The document that gets signed is built from the agreement/trade-doc's saved **content**. If
that content is empty (nobody authored the body yet), the preview renders only the header
and footer — i.e. it looks "blank". That's a **content** issue (author the body in the
Agreement/Trade-Doc library), not a bug in the signing flow.

---

## 8. Related modules

- **CLM** — Agreements, Trade Documents, Clauses, T&C: the content that gets signed.
- **Procure to Pay → Purchase Order → Stage 4** — send the PO to the supplier for signature.
- **Signing Tracker** — a shared status/timeline view for any signature request.

---

## 9. Glossary (plain English)

| Term | Meaning |
|---|---|
| **E-signature** | A legally valid signature captured electronically. |
| **Signature request** | One "envelope" sent to Zoho containing document(s) + signer(s). |
| **Signer** | A person who must sign (name + email). |
| **Signature box / field** | The spot on the page where a signer signs. |
| **Recall** | Withdraw a request that's still out for signing. |
| **Remind** | Nudge a signer who hasn't signed yet. |
| **Certificate of completion** | Zoho's audit record: who signed, when, from where. |
| **Polling** | Periodically asking Zoho for the latest status (vs. Zoho pushing it to us). |
| **Testing mode** | A non-prod flag that simulates sends without real emails/credits. |

---

## 10. Where to go next

- **Technical** tab — architecture, config, PDF rendering, status reconciliation, security.
- **API** tab — the exact endpoints and example requests.
- **Code Walkthrough** tab — a step-by-step story of preview, send, and status handling.
