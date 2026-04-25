# Sign in with Google — Implementation & Setup Guide

Complete reference for the Google Sign-In feature in Cross_Border_Command.
Covers architecture, every file changed, every config value, the exact Google Cloud Console steps, the API contract, and a QA test plan.

---

## 1. Overview

**Goal:** Let existing users authenticate via their Google account on the Login page, in addition to email + password.

**Design decision: existing-users-only.**
A Google sign-in only works if the email already exists in the `users` table. If not, the API returns `404 Account not found. Please contact your administrator.` This matches the multi-tenant model (User → Branch → Client) — new users have no `client_id`/`branch_id`/`user_type`, so auto-creating them on first sign-in would produce unusable accounts.

**Auth method:** Google Identity Services (GIS) on the frontend → Google issues an **ID token (JWT)** → frontend posts it to backend → backend verifies it using `google/apiclient` → if valid and email exists, issues a Sanctum personal access token (same as `/login`).

---

## 2. End-to-end flow

```
┌────────────┐       ┌──────────────────────┐      ┌─────────────────────┐
│  Browser   │       │  Laravel API         │      │  Google             │
│  (React)   │       │                      │      │                     │
└─────┬──────┘       └──────────┬───────────┘      └──────────┬──────────┘
      │                         │                             │
  1.  │ Load GIS script         │                             │
      │ accounts.google.com/gsi/client                        │
      │                         │                             │
  2.  │ google.accounts.id.initialize({ client_id })          │
      │ google.accounts.id.renderButton(div, {…})             │
      │                         │                             │
  3.  │ User clicks button → Google account-chooser popup     │
      │─────────────────────────────────────────────────────▶│
      │                         │                             │
  4.  │ User picks account; Google returns ID token (JWT)    │
      │◀─────────────────────────────────────────────────────│
      │                         │                             │
  5.  │ POST /api/google-login  │                             │
      │   { id_token }          │                             │
      │────────────────────────▶│                             │
      │                         │                             │
  6.  │                         │ verifyIdToken(id_token)     │
      │                         │────────────────────────────▶│
      │                         │  payload: email, sub, …     │
      │                         │◀────────────────────────────│
      │                         │                             │
  7.  │                         │ User::where('email')->first()
      │                         │   → if exists & active → issue Sanctum token
      │                         │   → else → 404 / 403         │
      │                         │                             │
  8.  │ { token, user }         │                             │
      │◀────────────────────────│                             │
      │                         │                             │
  9.  │ localStorage 'cbc_token' = token; redirect to dashboard
```

---

## 3. Google Cloud Console setup

You must create an OAuth 2.0 Client ID in Google Cloud and authorize the JavaScript origins where the Login page is served from.

### Steps

1. Go to https://console.cloud.google.com/apis/credentials
2. Make sure the right project is selected (top-left dropdown). Create one if needed.
3. Click **+ CREATE CREDENTIALS** → **OAuth client ID** (if you don't already have one).
4. **Application type:** **Web application**
5. **Name:** anything memorable (e.g., `Cross_Border_Command Web`)
6. **Authorized JavaScript origins** — **CRITICAL.** Must exactly match the origin where the React app is loaded, including protocol and port. `localhost` and `127.0.0.1` are different origins to Google. Add **all** the origins you'll actually use:
   - `http://localhost:8000`
   - `http://127.0.0.1:8000`
   - (production) `https://your-domain.com`
7. **Authorized redirect URIs** — leave empty. Our implementation uses ID tokens, **not** the redirect/code flow. Any value here is unused.
8. Click **CREATE** (or **SAVE** if editing existing).
9. Copy the **Client ID** (looks like `1234567890-xxxxx.apps.googleusercontent.com`).

> **Propagation:** Google says "It may take five minutes to a few hours for settings to take effect." Usually it's a couple of minutes; occasionally longer.

### OAuth consent screen

If you haven't configured the consent screen for this project, Google will prompt you. For internal/testing use:
- **User type:** Internal (if you have a Google Workspace org) or External (testing mode allows up to 100 test users).
- **Test users:** add the Gmail addresses of users you'll test with while the app is in testing mode.

---

## 4. Environment variables

Add to your `.env` (and `.env.example` already documents them):

```env
GOOGLE_CLIENT_ID=1234567890-xxxxx.apps.googleusercontent.com
VITE_GOOGLE_CLIENT_ID=1234567890-xxxxx.apps.googleusercontent.com
```

| Variable | Used by | Notes |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | Laravel (server) | Read in `config/services.php` → `services.google.client_id`; used by `Google_Client` to verify ID tokens |
| `VITE_GOOGLE_CLIENT_ID` | React (browser) | Vite exposes only `VITE_*` vars to the frontend bundle; used to initialize Google Identity Services |

> **Set both to the same value.** They serve different sides of the flow but must match.
> **Restart `npm run dev` / `vite`** after changing `VITE_*` vars — Vite reads them only at startup.

---

## 5. Database

### Migration

`database/migrations/2026_04_25_000001_add_google_id_to_users_table.php`

Adds a single nullable, unique column to `users`:

```php
$table->string('google_id', 64)->nullable()->unique()->after('employee_code');
```

Stored on first successful Google sign-in (`$payload['sub']` from Google's JWT). Lets us link the Google identity to the user without changing email.

Run: `php artisan migrate`

### Model

`app/Models/User.php` — added `'google_id'` to the `$fillable` array so mass-assignment works.

---

## 6. Backend API

### New public route

`routes/api.php`:

```php
Route::post('/google-login', [AuthController::class, 'googleLogin']);
```

(Public — outside `auth:sanctum` middleware. Same as `/login`.)

### Controller method

`app/Http/Controllers/Api/AuthController.php` → `googleLogin(Request $request)`

#### Endpoint

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/google-login` | Public |

#### Request body

```json
{ "id_token": "<Google ID token JWT>" }
```

| Field | Type | Required | Source |
| --- | --- | --- | --- |
| `id_token` | string | yes | The `credential` field returned by Google Identity Services in the browser |

#### Response — 200 OK (success)

```json
{
  "token": "1|abcd...",
  "user": {
    "id": 7,
    "name": "Jane Doe",
    "email": "jane@acme.com",
    "user_type": "client_admin",
    "initials": "JD",
    "client_id": 3,
    "branch_id": 5,
    "client_name": "Acme Logistics",
    "branch_name": "Mumbai HQ",
    "status": "active",
    "designation": "Operations Lead",
    "phone": "+91...",
    "avatar": null,
    "permissions": { ... },
    "plan": { ... }
  }
}
```

Same shape as `POST /api/login` — frontend treats both responses identically.

#### Error responses

| Status | When | Body |
| --- | --- | --- |
| `401` | ID token invalid, expired, or not for this Client ID | `{ "message": "Invalid Google token." }` |
| `401` | Google's `email_verified` flag is false | `{ "message": "Google email is not verified." }` |
| `403` | User exists but `status !== 'active'` | `{ "message": "Your account is not active. Contact administrator." }` |
| `404` | No user with this email | `{ "message": "Account not found. Please contact your administrator." }` |
| `422` | `id_token` missing from request | Laravel validation error shape |
| `500` | `GOOGLE_CLIENT_ID` not configured on server | `{ "message": "Google sign-in is not configured." }` |

#### Server-side logic (in order)

1. Validate `id_token` is present (string).
2. Read `services.google.client_id` from config; if empty → 500.
3. `(new \Google_Client(['client_id' => $clientId]))->verifyIdToken($idToken)` — verifies signature, expiry, audience (`aud`), issuer.
4. Reject if payload is missing or `email_verified` is false.
5. Lookup `User::where('email', $email)->first()`.
6. Reject if not found (404) or not active (403).
7. Update `last_login_at`, `last_login_ip`, `login_count`, `login_source = 'web'`. Set `google_id` if not already set.
8. Delete existing tokens (single-session enforcement, same as `/login`).
9. Return `{ token, user }` via the existing `formatUser()` helper.

### Composer dependency

```
composer require google/apiclient:^2.15
```

Brings in `google/auth`, `firebase/php-jwt`, etc. The verify call is fully offline after first key fetch (Google's public keys are cached).

### Config

`config/services.php`:

```php
'google' => [
    'client_id' => env('GOOGLE_CLIENT_ID'),
],
```

---

## 7. Frontend

### `resources/js/contexts/AuthContext.tsx`

Added a `googleLogin(idToken)` method to the auth context, parallel to the existing `login(email, password)`:

- Posts to `/google-login` with `{ id_token }`.
- On success, stores the Sanctum token in `localStorage.cbc_token`, caches the user, sets context state.
- On error, returns `{ success: false, error }` for the UI to toast.

Also added `googleLogin` to the context type so consumers can call it.

### `resources/js/pages/Login.tsx`

- Loads the Google Identity Services script (`https://accounts.google.com/gsi/client`) on mount.
- Initializes GIS with `client_id: VITE_GOOGLE_CLIENT_ID` and a callback that invokes `googleLogin()`.
- Renders Google's **official** sign-in button via `google.accounts.id.renderButton()` into a `<div ref={googleBtnRef}>`. The button is sized to its container (clamped to Google's max width of 400px) and re-renders via `ResizeObserver` when the container width changes.
- Uses `ux_mode: 'popup'` and `use_fedcm_for_prompt: false` to avoid FedCM/One-Tap edge cases that produce "Not signed in with the identity provider" errors.

> **Why `renderButton()` instead of `prompt()` (One Tap)?** `prompt()` silently fails in many normal situations: user hasn't signed into Google in that browser, has dismissed One Tap before, third-party cookies are blocked, FedCM rejection. `renderButton()` is the rock-solid path Google recommends for production.

---

## 8. Files changed — checklist

Everything touched by this feature, in dependency order:

| # | File | Change |
| --- | --- | --- |
| 1 | `composer.json` / `composer.lock` | `google/apiclient ^2.15` added |
| 2 | `database/migrations/2026_04_25_000001_add_google_id_to_users_table.php` | **NEW** — `google_id` column |
| 3 | `app/Models/User.php` | `google_id` added to `$fillable` |
| 4 | `config/services.php` | `'google' => ['client_id' => env('GOOGLE_CLIENT_ID')]` |
| 5 | `app/Http/Controllers/Api/AuthController.php` | `googleLogin()` method |
| 6 | `routes/api.php` | `POST /google-login` (public) |
| 7 | `.env.example` | Documents `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` |
| 8 | `.env` (local) | **You** set `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` to your real Client ID |
| 9 | `resources/js/contexts/AuthContext.tsx` | `googleLogin(idToken)` added |
| 10 | `resources/js/pages/Login.tsx` | GIS script load + `renderButton()` integration |

---

## 9. Setup checklist (fresh machine)

1. `git pull` (or apply the changes above).
2. `composer install` — pulls `google/apiclient`.
3. `php artisan migrate` — adds `google_id` column.
4. Create OAuth Client ID in Google Cloud Console (see §3). Copy the Client ID.
5. Add to `.env`:
   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   VITE_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   ```
6. `php artisan config:clear`
7. Restart Vite: stop `npm run dev`, then start it again.
8. Open `http://localhost:8000/login` (or whichever origin you authorized) and verify the Google button renders.

---

## 10. QA test plan

| # | Scenario | Steps | Expected |
| --- | --- | --- | --- |
| TC-01 | Happy path — existing active user | Sign in with a Google account whose email matches a `users` row with `status='active'` | Logged in; toast "Welcome back!"; redirected to dashboard; `users.google_id` populated; `users.last_login_*` updated |
| TC-02 | Happy path — second sign-in | TC-01 already done; sign in again | Logged in; `google_id` unchanged; `login_count` incremented |
| TC-03 | Email not in DB | Sign in with a Gmail not present in `users` | Toast "Account not found. Please contact your administrator."; HTTP 404; **no row created** |
| TC-04 | User exists but inactive | Set a user's `status` to `inactive`; sign in with that Google email | Toast "Your account is not active. Contact administrator."; HTTP 403 |
| TC-05 | Email case-insensitive lookup | User row has `Jane@Acme.com`; Google sends `jane@acme.com` | Logs in successfully (controller lower-cases the email from Google) — **verify on your dataset whether DB email is stored lower-case**; if not, log a bug |
| TC-06 | Tampered ID token | `curl -X POST /api/google-login -d '{"id_token":"junk"}'` | HTTP 401 `Invalid Google token.` |
| TC-07 | Missing id_token | `curl -X POST /api/google-login -d '{}'` | HTTP 422 validation error |
| TC-08 | Backend not configured | Unset `GOOGLE_CLIENT_ID` in `.env`, restart, hit endpoint | HTTP 500 `Google sign-in is not configured.` |
| TC-09 | Frontend not configured | Unset `VITE_GOOGLE_CLIENT_ID`, restart Vite | Login page loads without errors; Google button area is empty (no JS errors) |
| TC-10 | Origin not authorized | Open the page from a URL not in Google Cloud's allowlist | Popup shows "Access blocked: Authorization Error — Error 400: origin_mismatch" |
| TC-11 | Single-session enforcement | Log in via password; then log in via Google with same user | Old Sanctum tokens are revoked (consistent with `/login` behavior); old browser session 401s on next API call |
| TC-12 | Plan/permission preservation | Sign in via Google as a client_admin with a paid plan | `user.plan`, `user.permissions`, `user.client_name`, `user.branch_name` all populated correctly (same as password login) |

### Edge cases worth filing as bugs (or confirming intentional)

- Email case mismatch in DB (TC-05 above).
- Two `users` rows with the same email but different `client_id` (shouldn't happen if you have a unique index, but worth confirming).
- A user whose Google account has a different display name than their `users.name` — currently we **don't** sync name from Google. Confirm that's intended.

---

## 11. Troubleshooting

### `Error 400: origin_mismatch` (popup)

The exact origin in the browser address bar (protocol + host + port) is not in **Authorized JavaScript origins** in Google Cloud Console.
- `localhost` ≠ `127.0.0.1`
- `localhost:8000` ≠ `localhost`
- Click "error details" in the popup to see the exact origin Google checked.
- Add it, **Save**, wait 5+ minutes for propagation.

### Google button doesn't render at all

- `VITE_GOOGLE_CLIENT_ID` not set, or set after Vite started — restart `npm run dev`.
- Network tab: confirm `accounts.google.com/gsi/client` loaded (200).
- Console: any errors from `[GSI_LOGGER]`?

### `[GSI_LOGGER] FedCM get() rejects with…` errors

Old version using `prompt()` (One Tap). The current code uses `renderButton()` which doesn't trigger FedCM. If you still see these, you have stale JS — hard reload (Ctrl+F5).

### Backend returns `Invalid Google token` for a real-looking token

- The `client_id` configured on the **backend** (`GOOGLE_CLIENT_ID` in `.env`) doesn't match the one used on the **frontend** (`VITE_GOOGLE_CLIENT_ID`). The token's `aud` claim must match the server's expected client ID.
- Confirm both values are identical and from the **same** OAuth client in Google Cloud.

### "Account not found" for a user that does exist

- DB email may be stored with different casing than the Google email. The controller lowercases the Google email before lookup (`strtolower($payload['email'])`) but compares against `users.email` as-is. If your DB has mixed-case emails, normalize them or change the query to `whereRaw('LOWER(email) = ?', [$email])`.

### Popup opens then immediately closes with no result

Pop-up blocker on the browser. Allow popups for `accounts.google.com` and your origin.

---

## 12. Security notes

- ID tokens are verified server-side (`Google_Client::verifyIdToken`) — signature, expiry, audience, issuer all checked. We never trust the frontend's claim of "I'm logged in."
- We require `email_verified === true` from Google before lookup — prevents takeover via spoofed unverified emails.
- `google_id` is stored on first sign-in but **not** used for subsequent matching (we still match by email). If a user's Google account email changes, that's a real edge case worth logging.
- The OAuth Client ID is **public** by design (it's in the frontend bundle) — it's not a secret. The Client *Secret* (which we don't use because we're doing ID-token flow, not code flow) would be a secret.
- `Sanctum` token replaces the Google session; the Google ID token is never stored.

---

## 13. Reference links

- Google Identity Services — Display the Sign-In button: https://developers.google.com/identity/gsi/web/guides/display-button
- ID token verification (server-side): https://developers.google.com/identity/sign-in/web/backend-auth
- `google/apiclient` PHP package: https://github.com/googleapis/google-api-php-client
- Laravel Sanctum: https://laravel.com/docs/sanctum
