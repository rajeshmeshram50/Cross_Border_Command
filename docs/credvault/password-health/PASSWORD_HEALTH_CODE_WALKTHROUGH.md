# CredVault Password Health — Code Walkthrough

> Jira **GT-75**. Line numbers are as of 12 Nov 2026 (branch `saas`); search
> for the method name if they have drifted.

## 1. The file map

### Backend

| File | Lines | Role |
|---|---|---|
| `app/Http/Controllers/Api/CredVault/CredVaultController.php` | 5719 | Everything: the three endpoints (from line 1238, `PASSWORD HEALTH`), the helpers (from line 3839, `HEALTH`), the Fix diff inside `persistCredential()` (3324) |
| `app/Models/CredVault/Credential.php` | 443 | `strengthOf()` (350), `STRENGTH_LABELS` (37), `hashSecret()` (362), `secretIsPassword()`, `hasTwofaSwitch()`, `TYPES` |
| `app/Models/CredVault/Policy.php` | 170 | `DEFAULTS`, `OPTIONS`, `CATALOG` wording, `for()` (memoised merge) |
| `app/Models/CredVault/CredentialShare.php` | 74 | `scopeLive()`, `PERMISSIONS`, `rank()` |
| `app/Models/CredVault/AuditLog.php` | 82 | `ACTIONS['health_fixed'] = ['Health issue resolved', 'info']` |
| `app/Http/Controllers/Api/CredVault/NormalVault/NormalVaultController.php` | 79 | `update()` → `findInVault(RANK_FULL)` → `persistCredential()` |
| `app/Http/Controllers/Api/CredVault/CriticalVault/CriticalVaultController.php` | 123 | the same for `CCRD-` credentials |
| `app/Providers/AppServiceProvider.php` | — | `RateLimiter::for('credvault')` — 240 / min / user |

### Frontend

| File | Lines | Role |
|---|---|---|
| `resources/js/pages/credvault/health/PasswordHealth.tsx` | 355 | The page: `Summary`, `Detail`, the table, Fix, scan |
| `resources/js/pages/credvault/health/health.css` | 1 | One rule: the Over-shared issue icon colour |
| `resources/js/pages/credvault/credvault.css` | — | `phx-*` (score card, cards — around line 8221 and 18927), `ph-*` (issue pill, details — 7990–8085), column alignment (18846) |
| `resources/js/pages/credvault/cvApi.ts` | 419 | `health()` (365), `HealthIssue` (193), `CredentialDetail.health` (162), `CV_ROUTES.health` |
| `resources/js/pages/credvault/form/CredentialFormModal.tsx` | 131 | Loads the credential, refuses without `can.edit`, renders `CredentialForm` |
| `resources/js/pages/credvault/form/CredentialForm.tsx` | 1135 | Save: `cvApi.update(id, payload, inCritical)` (1015) |
| `resources/js/pages/credvault/my-vault/GeneratorModal.tsx` | 229 | Generate Password — local, "Use in New Credential" |
| `resources/js/pages/credvault/my-vault/ViewDrawer.tsx` | 561 | The eye button |
| `resources/js/pages/credvault/my-vault/MyVault.tsx` | 279 | Reads `?tab=sharedby&credential_id=` (84–96) for the Over-shared Fix |
| `resources/js/constants.ts` | — | Menu entry `cv.password_health` under *Vault Analytics* |
| `resources/js/components/App.tsx` | — | Route `/credentials-vault/password-health` → lazy `CvHealth` |

### Routes

`routes/api.php` 821–824, inside `prefix('credvault')->middleware('throttle:credvault')`
(755), inside `['auth:sanctum', 'user.active', 'tenant']` (163).

---

## 2. Request flow — `GET /credvault/health`

```
health(Request)
 1. tenantUser()                  403 "CredVault needs a company account — this login has no tenant."
                                  403 "You do not have access to Credentials Vault. …"
 2. tab=resolved → merge tab=fixed
 3. validate(listRules([...,'fixed']))                 422 on a bad tab / q / page / per_page
 4. Policy::for(client_id)
 5. $creds  = healthScope($u)                          visibleQuery + accessMap, 6 vias
 6. $issues = healthIssues($creds, $pol, $u)           sorted, with can_fix
 7. $matched = search over code/name/type/category/owner/issue
 8. $tabs = counts of $matched per type
 9. $resolved = AuditLog health_fixed query; tabs.fixed = count
10. tab == fixed ? paginate audit rows : slice $matched
11. summary = healthSummary($creds, $issues, $pol)    ← unfiltered $issues
```

The method's own comment on step 8:

```php
// The tab counts follow the search: each badge is what that tab lists for the term typed.
```

`/health/summary` is steps 1, 4, 5, 6, 11. `/health/attention` is 1–6, then
groups by credential id and sorts by worst severity, issue count, code.

---

## 3. Inside `healthIssues()`

```php
/** Every open issue across $creds, sorted by severity then credential ID. */
protected function healthIssues(Collection $creds, array $pol, ?User $u = null): array
{
    if ($creds->isEmpty()) return [];

    $byHash = $creds->filter(fn ($c) => $c->has_password && $c->secret_hash)->groupBy('secret_hash');
    $shares = $this->shareBreakdown($creds->pluck('id')->all());
    …
    foreach ($this->issuesOf($c, $pol, $others, $shares[$c->id] ?? []) as $i) {
        $out[] = $i + [
            'credential' => $this->issueCredential($c),
            // Fixing means editing; a team member's copy access cannot.
            'can_fix'    => ($c->_rank ?? self::RANK_FULL) >= self::RANK_FULL,
        ];
    }
```

- `$u` is accepted and **unused** — `policyInsights()` and `dashboard()` call
  it without one.
- `_rank` is only set by `healthScope()`. A caller that passes another
  collection (the dashboard does) gets `can_fix = true` by default; the
  dashboard does not read it.
- Two queries for the whole pass: the scope load and `shareBreakdown()`.

---

## 4. Inside `issuesOf()` — the five checks

The order of the `if`s is the order rows appear for one credential at equal
severity.

```php
if ($c->has_password && $c->strength < $pol['min_strength']) {
    // D34: Fair counts as weak. The level is named, never scored (D5).
    $label = Credential::STRENGTH_LABELS[$c->strength] ?? '';
    $out[] = ['type' => 'weak', 'severity' => ($crit || $c->strength <= 2) ? 'critical' : 'high',
        'issue' => $c->strength <= 2 ? 'Weak password' : 'Password below the policy minimum', …
```

```php
if ($c->twofa === 'no' && in_array($c->risk, $pol['twofa_risks'], true)) {
    $out[] = ['type' => 'twofa', 'severity' => ($crit || $c->risk === 'high') ? 'critical' : 'high', …
```

```php
$live = array_sum($shares);
if ($live >= $pol['overshare_limit'] || ($crit && ($shares['full'] ?? 0) > 0)) {
```

Note `>=`: the limit itself already counts as over-shared, matching the
policy text *"A credential shared with this many people or teams is flagged as
shared too widely."*

---

## 5. Inside `healthSummary()`

Quoted docblock, because it explains why the cards do not add up:

```php
/**
 * The score card and the five cards. Passed = a credential with no open
 * issue, failed = one with at least one ("need attention"). Each type is
 * counted per credential and out of the credentials that check applies to:
 * …
 * A credential can fail several checks, so the five add up to more than
 * `failed`; `attention.multiple` is how many fail more than one.
 */
```

The `twofa` denominator:

```php
'twofa' => $creds->filter(fn ($c) => $c->twofa !== 'na' && in_array($c->risk, $pol['twofa_risks'], true))->count(),
```

---

## 6. Request flow — Fix → save

```
PasswordHealth.fix(x)
  ├─ x.type === 'shared'
  │     navigate('/credentials-vault/my-vault?tab=sharedby&credential_id=ID')
  │     toast.info('Showing who has access to {name}', 'Revoke what is no longer needed.')
  │     MyVault reads the params, sets shareCred, deletes them from the URL,
  │     calls GET /credvault/shares?credential_id=ID
  └─ otherwise setEditId(id)
        CredentialFormModal → GET /credvault/credentials/{id}
           can.edit false → "Only the owner, a Vault Admin or someone with Full Access can edit this credential."
        CredentialForm save → cvApi.update(id, payload, inCritical)
           PUT (or POST for multipart) /credvault/{normal|critical}-vault/credentials/{id}
             findInVault(RANK_FULL) → persistCredential()
                singleIssues before
                validate → strength gate → transaction { save, audit edit,
                    singleIssues after, audit health_fixed per resolved }
                data.health = {resolved, still_open}
           toast.success('{code} · {name} updated', r.message)
        onSaved(c) in PasswordHealth:
           gone = c.health.resolved.length
           gone ? toast.success('N health issue(s) resolved')
                : toast.warning('Saved — the issue is still open')
           load(true)
```

`inCritical` in `CredentialForm` is `!!init.critical || detail?.risk ===
'critical'`. Password Health never passes `critical`, so a Critical Vault
credential is routed by its risk — every Critical Vault credential is
`risk = critical`, so this holds. A **My Vault** credential cannot be
critical-risk (`"Critical credentials are added in the Critical Vault, …"`),
so the two cannot be confused.

---

## 7. Frontend flow — `PasswordHealth.tsx`

```
mount → load()                    shimmer → rows, tabs, summary, meta
card click → pickCard(k)          tab = (tab === k ? 'all' : k); page 1; toast; scrollIntoView
tab click                         setTab, page 1          (no toast)
search                            q → useDebounced(350ms) → page 1
pager                             setPage / setPerPage(page 1)
Run Health Check → scan()         toast.info → load() → toast.success | toast.error
Generate Password → GeneratorModal → onUse(pw) → CredentialFormModal(prefillPassword)
row Fix → fix(x)                  §6
row View → ViewDrawer             onEdit → setEditId; onChanged → load(true)
```

Key lines:

```tsx
/** Fixed severity per issue type — not raised or lowered by the credential's risk level. */
const SEV_BY_TYPE = { weak: 'critical', reused: 'high', twofa: 'medium', rotation: 'critical', shared: 'medium' };
…
// Severity is fixed per issue type, whatever the credential (Weak / Rotation critical, Reused high, 2FA / Over-shared medium).
const sev = SEV_BY_TYPE[x.type] ?? x.severity;
```

`x.severity` is only the fall-back for an unknown type — in practice the
server's severity is never displayed.

```tsx
if (r.meta.current_page > r.meta.last_page && r.meta.last_page >= 1) setPage(r.meta.last_page);
```

— why the page jumps back after the last row of a page is fixed.

---

## 8. Patterns you will see in this code

| Pattern | Why |
|---|---|
| Compute on read, store nothing | An issue can never be stale; a policy change applies on the next load |
| `LIGHT_COLUMNS` select | The health pass never decrypts a secret; strength and hash were derived at save |
| HMAC hash for equality | Reuse without decrypting every secret, and without a reversible digest |
| One `shareBreakdown()` query keyed by credential | Avoids N+1 over the scope |
| Search and tab counts in PHP, summary from the unfiltered set | The cards describe the vault; the badges describe the list |
| `issue` / `detail` / `details` / `action` | `detail` is the one-line prototype text, `details` the parts the Details column draws |
| Diff by type, inside the save transaction | "a save resolves exactly what the list showed" — and the audit row commits with the edit |
| `seq` ref in `load()` | A slow response cannot overwrite a newer one |
| Fall-backs in `Summary` ("for an older API") | Cards still render if `cards[]` is missing |

---

## 9. Things that look wrong but are intentional (or known)

| Looks like | Is |
|---|---|
| Severity badge disagrees with the sort | `SEV_BY_TYPE` on screen vs `issuesOf()` severity on the server — documented mismatch |
| `tabs.fixed` in the response | Kept by the API; the Resolved tab was removed from the screen |
| Critical Vault credentials on the list | `healthScope()` does not filter `vault` |
| A credential flagged "reused" for an admin but not for its owner | Reuse only within the viewer's scope |
| `?type=` on `/health/attention` does nothing | The docblock is wrong; the parameter is `tab` |
| "six checks" in the `issuesOf` docblock | There are five |

---

## 10. Symptom → file

| Symptom | Look at |
|---|---|
| A credential is missing from the list | `healthScope()` (3842) — is the via `share` or `branch_critical`? Is it binned? Is it someone's personal credential? |
| A credential appears that "should not" (a `CCRD-`) | `healthScope()` — no `vault` filter |
| Weak never shows | Policies → Minimum strength is **Fair** (`min_strength = 2`); `strengthOf()` never returns below 2 |
| A Good password flagged | `min_strength = 4`; message "Password below the policy minimum" |
| Reuse not detected between two credentials | Both need `has_password`; both in the viewer's scope; not binned; `APP_KEY` unchanged since they were saved (`hashSecret`) |
| Rotation age looks reset | `rotationState()` — `password_changed_at` null, falling back to `updated_at` |
| "Due soon" on the due day, not "overdue" | `$age > rotation_days` — overdue starts the day after |
| Over-shared at exactly the limit | `>=` in `issuesOf()` |
| Over-shared with one share | critical risk + a live Full Access share |
| Severity badge seems wrong | `SEV_BY_TYPE` in `PasswordHealth.tsx` (41); the server value is `issuesOf()` |
| Order does not match the badges | `healthIssues()` sort (3874) uses server severity |
| Tab badges change with search but cards do not | By design — `health()` line 1262 vs `healthSummary($creds, $issues, …)` |
| Fix button greyed | `can_fix` — `_rank < RANK_FULL`, i.e. `team` via (HOD over someone at/above level) |
| Fix opens "Could not open the form" | `CredentialFormModal` — `can.edit` false from `GET /credentials/{id}` |
| Saved, but "Saved — the issue is still open" | `persistCredential()` diff by type (3493–3500): password not changed, or rotation moved from soon to over |
| No health toast after saving a new credential | Create never returns `health` (3508) |
| Over-shared Fix shows no shares | `sharedByMe()` (866) lists shares on credentials you own or shares you made only |
| "Health check failed" though data loaded | `scan()` — `load()` returned `null` because a newer request superseded it |
| Alignment of a column off | `credvault.css` 18846–18877 (`ph-th-N` / `nth-child`) |
| 422 "The selected tab is invalid." | `listRules()` — `/attention` has no `fixed`; `/health` accepts `fixed` and `resolved` |
| 403 module message | `tenantUser()` (5583) — Permissions → Credentials Vault → view |
| Card "of" for Missing 2FA looks small | denominator counts only risk levels in `twofa_risks` and `twofa ≠ na` |
