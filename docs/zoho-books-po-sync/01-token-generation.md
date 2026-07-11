# 01 · Zoho Books Token Generation (OAuth)

How the Zoho Books credentials are produced. Zoho uses the **OAuth 2.0
refresh-token grant**: you generate a short-lived *grant code* once, exchange it
for a long-lived *refresh token*, and the app uses that refresh token to mint
*access tokens* (valid ~1 hour) on demand.

```
Self Client ──(scopes)──► grant code ──(exchange)──► refresh token ──(app)──► access token
   one time                ~10 min                    permanent*              1 hour
```
\* until revoked.

---

## Step 1 — Create / open a Self Client

1. Go to **https://api-console.zoho.in** (`.in` = India DC — match your Zoho Books URL).
2. If none exists: **Add Client → Self Client → Create**.
3. Open the **Client Secret** tab → copy:
   - **Client ID** → `ZOHO_BOOKS_CLIENT_ID`
   - **Client Secret** → `ZOHO_BOOKS_CLIENT_SECRET`

## Step 2 — Generate a grant code

In the **Generate Code** tab:

| Field | Value |
|---|---|
| **Scope** | `ZohoBooks.fullaccess.all` |
| **Code expiry** | `10 minutes` |
| **Description** | `PO sync` |

Click **Create** → choose the org (**Inorbvict Agrotech**) → copy the **code**
(`1000.xxxx…`). It expires fast — use it immediately.

> **Why `fullaccess.all`?** Zoho returns `HTTP 401 code 57 (not authorized)` for
> **item creation** and **chart-of-accounts** reads under granular scopes
> (`ZohoBooks.items.CREATE` etc.), even though the token carries them. Item
> creation is required (a PO line must reference a purchasable item), so full
> access is the reliable scope. Contacts/PO/settings *do* work granularly, but
> full access avoids the trap.

## Step 3 — Exchange the code for a refresh token

Run within the code's lifetime (replace the 3 values):

```bash
curl -X POST "https://accounts.zoho.in/oauth/v2/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=YOUR_GRANT_CODE"
```

Response:

```json
{
  "access_token": "1000.aaaa....",
  "refresh_token": "1000.bbbb....",   ←— save this
  "scope": "ZohoBooks.fullaccess.all",
  "api_domain": "https://www.zohoapis.in",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

Put `refresh_token` into `.env` as `ZOHO_BOOKS_REFRESH_TOKEN`.

## Step 4 — `.env`

```env
ZOHO_BOOKS_CLIENT_ID=1000.7C0W4U5BDJIARXMCYJTCXNPLQ07LDU
ZOHO_BOOKS_CLIENT_SECRET=**** (from Self Client)
ZOHO_BOOKS_REFRESH_TOKEN=1000.**** (from step 3)
ZOHO_BOOKS_ORG_ID=60077655856
ZOHO_BOOKS_BASE_URL=https://www.zohoapis.in/books/v3
ZOHO_BOOKS_ACCOUNTS_URL=https://accounts.zoho.in
```

Then: `php artisan config:clear`.

## Step 5 — How the app uses it (automatic)

`ZohoBooksService::refreshAccessToken()` mints an access token from the refresh
token and caches it (`zoho_books_access_token`) for `expires_in − 600s`
(≈55 min). Every API call sends header:

```
Authorization: Zoho-oauthtoken <access_token>
```

Refresh call the app makes internally:

```
POST https://accounts.zoho.in/oauth/v2/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&client_id=...&client_secret=...&refresh_token=...
```

---

## Data-centre cheat sheet

| DC | Accounts URL | Books API base |
|---|---|---|
| **India** (`.in`) | `https://accounts.zoho.in` | `https://www.zohoapis.in/books/v3` |
| US (`.com`) | `https://accounts.zoho.com` | `https://www.zohoapis.com/books/v3` |
| EU | `https://accounts.zoho.eu` | `https://www.zohoapis.eu/books/v3` |

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `invalid_code` | Grant code expired (>10 min) or reused → generate a new one |
| `401 code 57` on items | Scope too narrow → regenerate with `ZohoBooks.fullaccess.all` |
| `invalid_client` | Wrong DC (using `.com` creds on `.in`) or bad secret |
| App says "not connected" (503) | Missing `.env` keys → fill + `php artisan config:clear` |
