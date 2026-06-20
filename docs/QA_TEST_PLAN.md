# Cross_Border_Command — QA Test Plan & Project Overview

> Single consolidated document for QA. Top half is a project overview so a new tester can come up to speed. Bottom half is the structured test-case catalog grouped by module.

---

## PART 1 — PROJECT OVERVIEW

### 1.1 What this product is
Cross_Border_Command is a **multi-tenant SaaS HRMS / operations platform**. Each tenant ("Client" / "Organization") gets its own scoped data; under each tenant there are **Branches**; under each branch are **Employees**. A Super Admin operates the SaaS itself and provisions Clients.

### 1.2 Tech stack
- **Backend**: Laravel 11, PHP 8+, PostgreSQL, Sanctum tokens, queue driver = `database`
- **Frontend**: React 19 + TypeScript SPA (Velzon theme), Vite build
- **Payments**: Razorpay (test + live mode)
- **PDF**: barryvdh/dompdf for invoice generation
- **Mail**: SMTP via Gmail Workspace (`smtp.gmail.com:587`)

### 1.3 Tenant model (data hierarchy)
```
Super Admin
   └── Client (tenant)
         └── Branch  (every branch is an equal, isolated peer)
               └── User (branch_user, employee, etc.)
                     └── Permissions (per-module RBAC)
```
- **client_admin** sees everything inside their client
- **branch_user** sees only their own branch (every branch is an isolated peer)
- **super_admin** has no tenant attachment; sees every client

### 1.4 User types (User.user_type)
| Value | Description |
|---|---|
| `super_admin` | Operates the SaaS itself |
| `client_admin` | Owns a tenant org (the Client) |
| `client_user` | Standard user inside a tenant (legacy / minimal) |
| `branch_user` | Belongs to a branch; scoped to that branch only (equal, isolated peers) |
| `employee` | HR-managed; may or may not have user-login enabled |

### 1.5 Plans & subscription
- Plans: **Starter** (1 branch, free), **Basic** (5 branches), **Pro** (25), **Business** (50), **Enterprise** (unlimited / `max_branches=0`).
- Free plan auto-activates on signup. Paid plans go through Razorpay.
- Plan affects: max_branches, modules included, max_users.
- On plan downgrade: branches and permissions are pruned to fit new cap.

### 1.6 Mail triggers (six mailables, one Blade each)
| Mailable | Trigger | Delivers |
|---|---|---|
| `WelcomeCredentialsMail` | New user provisioned (client_admin / branch_user / employee) | Email + plaintext password |
| `OnboardingInviteMail` | Admin issues self-service onboarding invite | Token link to public form |
| `PasswordResetOtpMail` | "Forgot Password" → Send OTP | 6-digit OTP, 10 min expiry |
| `PasswordChangedMail` | Password actually changed (forgot, self, admin-rotated) | Confirmation + plaintext new password |
| `PaymentInvoiceMail` | Payment status flips to `success` | Invoice details + PDF attachment |
| `PlanReminderMail` | Manual "Send Reminder" button on Payments page | Plan-expiry reminder |

### 1.7 High-level feature areas
1. Auth (login, Google login, OTP forgot password, change password, profile, branding)
2. Clients (super-admin CRUD, soft delete, status, stats)
3. Branches (client-admin CRUD, branch user provisioning)
4. Employees / HRMS (CRUD, ancillary roles, documents, exit, previous employment, onboarding invites)
5. Permissions (module list, manageable users, get/save user permissions, cascade-clear on plan downgrade or admin-revoke)
6. Plans + Subscriptions (plans CRUD, subscription create-order/verify/cancel, Razorpay webhook)
7. Payments (manual entry, view/download invoice with token-auth, send reminder)
8. Recruitment (recruitments + hiring requests + candidates with import/export, status pipeline)
9. Expense Claims (manager → HR two-step approval workflow)
10. Announcements (draft/scheduled/active states, ack mode, audience targeting)
11. Master Data (50+ master tables under one generic `/master/{slug}` router)
12. Dashboards (admin stats vs client stats)

### 1.8 Status enums to remember
| Field | Allowed values |
|---|---|
| `clients.status` | active, inactive, suspended |
| `branches.status` | active, inactive |
| `users.status` | active, inactive, pending |
| `payments.status` | pending, success, failed, refunded |
| `plans.status` | active, inactive |
| `employees.status` | Active, Inactive, On Leave, Probation, Notice Period, Resigned, Terminated |
| `candidates.status` | Applied, Shortlisted, In Interview, Final Interview, Selected, Offered, Rejected, On Hold |

---

## PART 2 — TEST PLAN

### 2.1 Test environment prerequisites
- DB seeded with: 1 super_admin, ≥2 active clients (each with ≥2 branches), ≥1 employee per branch, ≥3 plans (Starter free, Basic paid, Enterprise paid).
- SMTP working (gmail.com:587, app password set in `.env`).
- Razorpay keys set in `.env` (test mode).
- Browser DevTools open during UI tests to capture XHRs.
- Mailinator addresses for all test logins (e.g., `cbc-qa-{role}@mailinator.com`).
- **Note**: Mailinator drops mails > ~100 KB. Invoice mails (1.6 MB PDF) must be tested with real Gmail addresses or Mailtrap.

### 2.2 Test user matrix (suggest seeding)
| Role | Email | Password | Notes |
|---|---|---|---|
| Super Admin | super@cbc.test | Test@123 | Platform-wide |
| Client Admin (Client A) | admin-a@cbc.test | Test@123 | Tenant A |
| Branch User A1 (Client A) | branch-a1@cbc.test | Test@123 | Branch A1 |
| Branch User A2 (Client A) | branch-a2@cbc.test | Test@123 | Branch A2 |
| Employee (Client A) | emp-a@cbc.test | Test@123 | Linked to a branch in A |
| Client Admin (Client B) | admin-b@cbc.test | Test@123 | Tenant B (data-isolation reference) |

### 2.3 Test case format
Each case below uses: `ID | Title | Preconditions | Steps | Expected | Severity`. Default severity = **Major** unless flagged otherwise.

---

## MODULE 1 — AUTHENTICATION & AUTHORIZATION

### 1.A Email/password login
| ID | Title | Preconditions | Steps | Expected |
|---|---|---|---|---|
| AUTH-001 | Login with valid super_admin credentials | super_admin user exists, status=active | POST /api/login with correct email+password | 200, `token` and `user` returned, `user.user_type=super_admin` |
| AUTH-002 | Login with valid client_admin | client_admin status=active, client.status=active | Login | 200, user.client_id set, plan info populated |
| AUTH-003 | Login with valid branch_user | branch_user, branch.status=active | Login | 200, user.branch_id set, scoped to own branch |
| AUTH-004 | Login with second branch_user | a different branch's user | Login | 200, sees only their own branch's data |
| AUTH-005 | Login with valid employee user | employee user_type | Login | 200, `employee_id` and `employee_code` populated |
| AUTH-006 | Login with wrong password | Any user | POST with bad password | 422, error: "Invalid email or password" |
| AUTH-007 | Login with non-existent email | — | POST /api/login | 422, same generic error (no user enumeration) |
| AUTH-008 | Login when user.status=inactive | Set user.status=inactive | Login | 422, "Your account is not active. Contact administrator." |
| AUTH-009 | Login when user.status=pending | Set user.status=pending | Login | 422, same as AUTH-008 |
| AUTH-010 | Login when client.status=inactive (branch_user) | Set client.status=inactive | Login as branch_user under that client | 422, "Your organization is inactive. Contact administrator." |
| AUTH-011 | Login when client.status=suspended | Set client.status=suspended | Login | 422, "Your organization is suspended..." |
| AUTH-012 | Login when branch.status=inactive | Set branch.status=inactive | Login as user attached to that branch | 422, "Your branch is not active." |
| AUTH-013 | Empty email validation | — | POST /api/login with empty email | 422, validation error on `email` |
| AUTH-014 | Malformed email validation | — | POST with email="abc" | 422, email format error |
| AUTH-015 | Login increments login_count and updates last_login_at | Snapshot login_count | Login → fetch user | login_count incremented, last_login_at = now, last_login_ip = client IP |
| AUTH-016 | New token issued + previous tokens revoked | Login twice in a row | First login → use token T1; second login → token T2; call /me with T1 | T1 returns 401, T2 works |

### 1.B Google login
| ID | Title | Preconditions | Steps | Expected |
|---|---|---|---|---|
| AUTH-020 | Google login with valid id_token (existing user, email_verified) | User with that email exists | POST /api/google-login | 200, token issued; google_id stored if previously empty |
| AUTH-021 | Google login with invalid id_token | — | POST with bad token | 401, "Invalid Google token" |
| AUTH-022 | Google login with email_verified=false | Mock token without verification | POST | 401, "Google email is not verified" |
| AUTH-023 | Google login email not registered | Email never seen | POST | 404, "Account not found. Please contact your administrator." |
| AUTH-024 | Google login when user inactive | user.status=inactive | POST | 403, "Your account is not active." |
| AUTH-025 | Google login when client inactive | client.status=inactive | POST | 403, organization inactive |

### 1.C Forgot password (3-step OTP)
| ID | Title | Preconditions | Steps | Expected |
|---|---|---|---|---|
| AUTH-030 | Send OTP to valid email | Active user | POST /api/forgot-password/send-otp | 200, OTP mail sent (PasswordResetOtpMail), `password_reset_otps` row created |
| AUTH-031 | Send OTP to non-existent email | — | POST | 422, "No account found with this email address" |
| AUTH-032 | Send OTP when account inactive | user.status=inactive | POST | 422, "Your account is not active" |
| AUTH-033 | Send OTP twice within cooldown (120s) | OTP already sent | POST again | 429, "Please wait X seconds...", `retry_after` in body |
| AUTH-034 | Verify OTP with correct 6-digit code | OTP active, not yet verified | POST /api/forgot-password/verify-otp | 200, OTP row marked `verified=true` |
| AUTH-035 | Verify OTP with wrong code | OTP active | POST with wrong OTP | 422, "Invalid code. X attempt(s) remaining", attempts incremented |
| AUTH-036 | Verify OTP after 5 failed attempts | attempts=5 | Verify with any code | 422, "Too many failed attempts", OTP row deleted |
| AUTH-037 | Verify expired OTP | expires_at in past | Verify | 422, expired=true, OTP row deleted |
| AUTH-038 | Reset password without verified OTP | OTP not verified yet | POST /api/forgot-password/reset | 422, "Please verify your OTP first" |
| AUTH-039 | Reset password successful | OTP verified | POST with new password | 200, password updated, all tokens revoked, OTP cleared, **PasswordChangedMail sent** with new plaintext password |
| AUTH-040 | Reset password with reused last-3 password | Recent password matches one of last 3 | POST | 422, password reuse rejected (PasswordHistory trait) |
| AUTH-041 | Reset password with weak (<8 chars) | — | POST password=`abc` | 422, min:8 validation |
| AUTH-042 | Reset password without confirmation match | password ≠ password_confirmation | POST | 422, confirmed validation fails |

### 1.D In-app change password
| ID | Title | Preconditions | Steps | Expected |
|---|---|---|---|---|
| AUTH-050 | Change own password (correct current) | Logged in | POST /api/change-password | 200, password updated, **PasswordChangedMail** sent with new plaintext |
| AUTH-051 | Change with wrong current password | Logged in | POST with bad current_password | 422, "Current password is incorrect" |
| AUTH-052 | Change to one of last 3 passwords | History exists | POST | 422, password reuse rejected |
| AUTH-053 | Change with mismatched confirmation | — | POST | 422, confirmed validation |

### 1.E Sanctum / EnsureUserActive middleware
| ID | Title | Preconditions | Steps | Expected |
|---|---|---|---|---|
| AUTH-060 | Live token on inactive user | Login → flip user.status=inactive in DB | Use existing token to GET /me | 401, token revoked, "Account is no longer active. Please sign in again." |
| AUTH-061 | Live token when client deactivated | branch_user logged in → flip client.status=inactive | GET /me | 401, "Account is no longer active" (effectiveClient walk catches it) |
| AUTH-062 | Live token when branch deactivated | branch_user logged in → flip branch.status=inactive | GET /me | 401 |
| AUTH-063 | Token revocation on logout | Login → POST /api/logout | Use same token after | 401 |

### 1.F Profile & branding
| ID | Title | Preconditions | Steps | Expected |
|---|---|---|---|---|
| AUTH-070 | Update profile name + phone | Logged in | POST /api/me/profile | 200, fields updated; email NOT editable |
| AUTH-071 | Update profile with malformed phone | — | POST phone="abc" | 422, regex error |
| AUTH-072 | Update profile attempts to change email | — | POST email="x@y.com" | 200, email unchanged (silently dropped) |
| AUTH-073 | Update branding as client_admin | client_admin logged in | POST /api/me/branding with logo + primary_color | 200, client.logo, primary_color, secondary_color updated |
| AUTH-074 | Update branding as branch_user | branch_user logged in | POST | 200, branch row updated, not client row |
| AUTH-075 | Update branding as super_admin | super_admin (no tenant) | POST | 403, "No tenant branding to update for this account" |
| AUTH-076 | Branding rejects non-image file | — | POST logo=PDF file | 422, mimes validation |
| AUTH-077 | Branding rejects malformed hex color | primary_color="#GGG" | POST | 200 saved (validator only checks max:7); but `pickHexColor()` drops it server-side on next /me load |

---

## MODULE 2 — CLIENT MANAGEMENT (Super Admin only)

| ID | Title | Preconditions | Steps | Expected |
|---|---|---|---|---|
| CL-001 | List clients as super_admin | Logged in | GET /api/clients | 200, paginated list with plan + branches_count + users_count |
| CL-002 | List clients as non-super_admin | client_admin logged in | GET /api/clients | Restricted (403 or scoped to own client) |
| CL-003 | Create client with required fields | — | POST /api/clients with org_name, org_type, email, status, admin_name, admin_email, admin_password | 201, client row + admin user created, **WelcomeCredentialsMail** sent to admin |
| CL-004 | Create client with duplicate GSTIN | Existing client has same GST | POST | 422, "This GSTIN is already registered with another client" |
| CL-005 | Create client with malformed GSTIN | gst_number="ABC" | POST | 422, regex error with example "27AADCI6120M1ZH" |
| CL-006 | Create client with malformed PAN | pan_number="1234" | POST | 422, regex error |
| CL-007 | GST/PAN auto-uppercased | gst_number lowercase | POST | 201, stored uppercase |
| CL-008 | Create client with org_type not in master | — | POST org_type="random" | 422, exists:organization_types,name fails |
| CL-009 | Get client stats | — | GET /api/clients/stats | 200, total/active/inactive counts |
| CL-010 | View single client | — | GET /api/clients/{id} | 200, full client + plan + admin + branches/users counts |
| CL-011 | Update client (no status change) | — | PUT /api/clients/{id} with new org_name | 200, updated; existing tokens NOT revoked |
| CL-012 | Update client status active → inactive | — | PUT with status=inactive | 200, **all user tokens for that client revoked** (sanctum kill-switch) |
| CL-013 | Update client status active → suspended | — | PUT with status=suspended | 200, same kill-switch |
| CL-014 | Update client admin password (super_admin rotates) | — | PUT with admin_password | 200, password updated, **PasswordChangedMail** sent to client_admin |
| CL-015 | Update client admin email | New email not in users table | PUT with admin_email | 200, admin user email changed |
| CL-016 | Update client admin email to taken email | Conflict | PUT | 422, unique violation |
| CL-017 | Update plan_type free → paid via this form | — | PUT plan_type=paid | 200, but plan_type silently NOT changed (only SubscriptionController::activatePlan can flip free→paid) |
| CL-018 | Replace client logo | hasFile('logo') | PUT with new logo | 200, old file deleted from storage, new path stored |
| CL-019 | Soft-delete client | — | DELETE /api/clients/{id} | 200, client + branches + users soft-deleted, all tokens revoked |
| CL-020 | List excludes soft-deleted clients | Deleted client exists | GET /api/clients | Deleted not present |
| CL-021 | Cross-tenant: client_admin views another client | client_admin A → GET /api/clients/{B} | Logged in as Client A admin | 403 / hidden |

---

## MODULE 3 — BRANCH MANAGEMENT (Client Admin)

| ID | Title | Preconditions | Steps | Expected |
|---|---|---|---|---|
| BR-001 | List branches for client_admin | client_admin logged in | GET /api/branches | 200, branches under their client only; auto "Head Office" hidden |
| BR-002 | List branches with `?include_head_office=true` | — | GET | Auto Head Office included |
| BR-003 | Create branch under plan limit | Starter plan (max=1), 0 existing | POST /api/branches | 201, branch + branch user created, **WelcomeCredentialsMail** sent |
| BR-004 | Create branch when at plan limit | Starter plan, 1 existing | POST | 422, "Branch limit reached. Your plan allows up to 1..." |
| BR-005 | Create branch with duplicate name in same client | Existing branch "X" | POST another "X" | 422, name unique-per-client violation |
| BR-006 | Create branch with same name as branch in different client | — | POST | 201, name uniqueness scoped per client |
| BR-007 | Create branch with malformed phone | phone="abc" | POST | 422, regex error |
| BR-008 | Create branch with malformed website | website="not-a-url" | POST | 422, regex error |
| BR-009 | Create branch with duplicate GSTIN per client | — | POST | 422, "This GSTIN is already registered to another branch" |
| BR-010 | Create branch with duplicate user_email anywhere | Email exists in users | POST | 422, "This email is already registered" |
| BR-011 | Create a second branch under a client | Client already has branch X | POST new branch | 201, both branches exist as equal peers (no privileged "main") |
| BR-012 | View single branch (own client) | client_admin | GET /api/branches/{id} | 200, includes branch_user info |
| BR-013 | View branch across tenant | client_admin A → branch under B | GET | 403, "Unauthorized" |
| BR-014 | Update branch (rename, no name conflict) | — | PUT new name | 200 |
| BR-015 | Update branch keeping same name | name unchanged | PUT same name | 200 (per-client unique check skipped on no-rename) |
| BR-016 | Update branch user password | — | PUT user_password=X | 200, password hashed, **PasswordChangedMail** sent to branch user |
| BR-017 | Update branch user email | — | PUT user_email=Y | 200, branch user's email changed |
| BR-018 | Update branch status to inactive | — | PUT status=inactive | 200, **all branch users' tokens revoked** for that branch |
| BR-019 | Soft-delete branch | — | DELETE /api/branches/{id} | 200, branch and its users soft-deleted; tokens killed |
| BR-020 | Plan downgrade prunes excess branches | Was Pro (25 max), down to Basic (5 max), have 8 branches | Downgrade subscription | After activation, excess branches deactivated down to the cap (any branch may be kept/retired — no privileged "main") |

---

## MODULE 4 — EMPLOYEE MANAGEMENT (HRMS)

### 4.A Listing & creation
| ID | Title | Preconditions | Steps | Expected |
|---|---|---|---|---|
| EMP-001 | List employees as client_admin | — | GET /api/employees | 200, all employees in own client |
| EMP-002 | List employees as client_admin (all branches) | — | GET | 200, all employees across the client's branches |
| EMP-003 | List employees as branch_user | — | GET | 200, only employees in own branch |
| EMP-004 | Get next emp_code | — | GET /api/employees/next-code | 200, format `EMP-NNN` |
| EMP-005 | Get reporting managers list | — | GET /api/employees/managers | 200, names and IDs |
| EMP-006 | Create employee with full payload | — | POST /api/employees | 201, row + linked User created (if login_enabled), **WelcomeCredentialsMail** sent |
| EMP-007 | Create employee with multiple ancillary roles | role IDs [1,2,3] | POST `ancillary_role_ids: [1,2,3]` | 201, JSON column stores array; legacy `ancillary_role_id` mirrors first |
| EMP-008 | Create employee with duplicate emp_code | — | POST | 422, unique violation |
| EMP-009 | Create employee with same asset already booked | other_master_asset_ids overlap | POST | 422, "asset already booked by another employee" |
| EMP-010 | Create employee, mail to gmail address | mail driver=smtp | POST | Welcome mail received within ~30s |

### 4.B Edit & remove
| ID | Title | Preconditions | Steps | Expected |
|---|---|---|---|---|
| EMP-020 | Update employee — remove all ancillary roles | Had 3 roles | PUT `ancillary_role_ids: []` | 200, both `ancillary_role_ids` array AND legacy `ancillary_role_id` cleared |
| EMP-021 | Update employee — wizard progress only ratchets up | wizard_step=2 → PUT wizard_step=1 | 200, persists max(2,1)=2 (high-watermark) |
| EMP-022 | Soft-delete employee | — | DELETE /api/employees/{id} | 200, soft-deleted, hidden from list |
| EMP-023 | Restore soft-deleted employee | — | PATCH /api/employees/{id}/restore | 200, restored |

### 4.C Documents
| ID | Title | Preconditions | Steps | Expected |
|---|---|---|---|---|
| EMP-030 | Upload employee document | Employee exists | POST /api/employees/{id}/documents | 201, document row, file stored |
| EMP-031 | Verify document | Doc exists pending | PATCH /api/documents/{id}/verify | 200, status=verified, verified_by/at set |
| EMP-032 | Reject document | — | PATCH /api/documents/{id}/reject | 200, status=rejected with reason |
| EMP-033 | Delete document | — | DELETE /api/documents/{id} | 200, file removed from disk |

### 4.D Exit / Previous Employment
| ID | Title | Preconditions | Steps | Expected |
|---|---|---|---|---|
| EMP-040 | Upsert exit record | — | PUT /api/employees/{id}/exit | 200, exit row created or updated |
| EMP-041 | Get previous employments | — | GET /api/employees/{id}/previous-employments | 200, list |
| EMP-042 | Add previous employment | — | POST | 201 |
| EMP-043 | Update previous employment | — | PATCH /api/previous-employments/{id} | 200 |
| EMP-044 | Delete previous employment | — | DELETE | 200 |

### 4.E Onboarding (token-link flow)
| ID | Title | Preconditions | Steps | Expected |
|---|---|---|---|---|
| EMP-050 | Admin issues onboarding invite | — | POST /api/employees/onboarding-invite | 201, **OnboardingInviteMail** sent with token link |
| EMP-051 | Public preview onboarding form | Token valid, not expired/used | GET /api/onboarding/{token} | 200, prefilled fields |
| EMP-052 | Submit onboarding form (token used) | — | POST /api/onboarding/{token}/complete | 200, employee created |
| EMP-053 | Reuse expired token | — | GET | 410, "Invite expired" |
| EMP-054 | Reuse already-completed token | — | GET | 410, "Invite already used" |

---

## MODULE 5 — PERMISSIONS & ROLES

| ID | Title | Preconditions | Steps | Expected |
|---|---|---|---|---|
| PERM-001 | List modules | Logged in | GET /api/modules | 200, tree of modules with parent_id, slug, icon |
| PERM-002 | manageableUsers as super_admin | — | GET /api/permissions/users | 200, list of client_admins (active org only) |
| PERM-003 | manageableUsers as client_admin | — | GET | 200, branch_users + employees in own client (excluding self) |
| PERM-004 | manageableUsers as branch_user | — | GET | 200, only employees in own branch (excluding self) |
| PERM-005 | manageableUsers as employee | — | GET | 200, returns empty collection |
| PERM-006 | getUserPermissions for self | — | GET /api/permissions/user/{self} | 200, own perms |
| PERM-007 | getUserPermissions for orphan employee (NULL client_id) by client_admin | — | GET | 200, allowed (per orphan-adoption rule) |
| PERM-008 | getUserPermissions cross-tenant | client_admin A → user under B | GET | 403 |
| PERM-009 | savePermissions to branch_user in same client | — | POST | 200, perms upserted, message includes `saved_count` |
| PERM-010 | savePermissions to orphan employee | client_admin grants to NULL-client employee | POST | 200, **employee adopted into granter's tenant** (client_id + branch_id stamped) |
| PERM-011 | savePermissions to super_admin | — | POST as super_admin to other super_admin | 403, "Cannot assign permissions to super admin" |
| PERM-012 | Grant flag granter doesn't have | client_admin tries to grant `can_delete` they lack | POST | 422, "You cannot grant 'can_delete' permission that you don't have" |
| PERM-013 | Grant on parent-only module | module has children | POST | Skipped (counted in `skipped_parent_modules`) |
| PERM-014 | Grant zero flags is no-op | All booleans false | POST | Row not inserted |
| PERM-015 | Cascade-clear: super_admin revokes flag from client_admin | downstream branch_user has the flag | POST | 200, branch_user flag downgraded to false (`cascade_branch_users_updated > 0`) |
| PERM-016 | Plan downgrade clears branch_user perms | Plan reset wipes admin perms | activatePlan | downstream perms pruned automatically |

---

## MODULE 6 — PLANS & SUBSCRIPTIONS

| ID | Title | Preconditions | Steps | Expected |
|---|---|---|---|---|
| PLAN-001 | List active plans | Logged in | GET /api/subscription/plans | 200, plans with included modules |
| PLAN-002 | Get current subscription status | client_admin | GET /api/subscription/status | 200, plan, expires_at, usage |
| PLAN-003 | Subscribe to free plan (Starter) | — | POST /api/subscription/create-order with free plan | 200, `free=true`, plan auto-activated, no Razorpay order |
| PLAN-004 | Create order for paid plan | — | POST | 200, Razorpay order_id returned, payment row pending |
| PLAN-005 | Verify payment with valid signature | — | POST /api/subscription/verify-payment | 200, payment.status=success, plan activated, **PaymentInvoiceMail** dispatched |
| PLAN-006 | Verify payment with invalid signature | bad signature | POST | 400, payment.status=failed, no invoice mail |
| PLAN-007 | Cancel pending order | — | POST /api/subscription/cancel-order | 200, payment.status=failed |
| PLAN-008 | Subscribe with branches > new plan limit | Have 8 branches, downgrade to Basic (5 max) | Provide `kept_branch_ids` array | 200, only kept branches stay active |
| PLAN-009 | Subscribe without `kept_branch_ids` when over limit | Same as above | POST without selection | 422, "must include kept_branch_ids" |
| PLAN-010 | `kept_branch_ids` honoured on downgrade | Over-limit client picks branches to keep | POST with kept_branch_ids | 200, only the selected branches stay active (any branch may be kept) |
| PLAN-011 | Plan CRUD as super_admin | — | POST/PUT/DELETE /api/plans | 200/201, status changes |
| PLAN-012 | Plan CRUD as non-super_admin | client_admin | DELETE /api/plans/{id} | 403 |
| PLAN-013 | Razorpay webhook valid signature `payment.captured` | — | POST /api/razorpay/webhook | 200, payment.status=success, **PaymentInvoiceMail** dispatched |
| PLAN-014 | Razorpay webhook invalid signature | — | POST with bad header | 400, "Invalid signature" |
| PLAN-015 | Razorpay webhook for unknown order | — | POST | 200 (logged but ignored) |
| PLAN-016 | Razorpay webhook idempotency (already success) | Payment already success | POST | 200, no double-activate, no duplicate invoice mail |
| PLAN-017 | Razorpay webhook `payment.failed` | — | POST | 200, payment.status=failed |

---

## MODULE 7 — PAYMENTS & INVOICING

| ID | Title | Preconditions | Steps | Expected |
|---|---|---|---|---|
| PAY-001 | List payments as super_admin | — | GET /api/payments | 200, all payments |
| PAY-002 | List payments as client_admin | — | GET /api/payments | 200, only own client's |
| PAY-003 | List payments as branch_user | — | GET | 200 with empty data (or 403) |
| PAY-004 | Payment stats | — | GET /api/payments/stats | 200, total/successful/pending counts |
| PAY-005 | Manual record successful payment | super_admin | POST /api/payments status=success | 201, **PaymentInvoiceMail** sent (org email + client_admin email) |
| PAY-006 | Manual record pending payment | — | POST status=pending | 201, no mail dispatched |
| PAY-007 | Send invoice reminder | Existing payment | POST /api/payments/{id}/send-reminder | 200, **PlanReminderMail** sent |
| PAY-008 | Send reminder when client has no email | client.email null | POST | 422, "Client email not found" |
| PAY-009 | Download invoice with sanctum auth | — | GET /api/payments/{id}/invoice/download | 200, PDF stream |
| PAY-010 | Download invoice with `?token=` query | — | GET ...?token={sanctumToken} | 200, PDF stream |
| PAY-011 | Download invoice with invalid token | — | GET ...?token=bad | 401 |
| PAY-012 | View invoice inline | — | GET /api/payments/{id}/invoice/view | 200, Content-Type: application/pdf inline |
| PAY-013 | Invoice PDF idempotent generation | First view generates; second hits cache | GET twice | Same file path, no duplicate write |
| PAY-014 | Invoice mail to mailinator | Use mailinator inbox | Trigger payment | Mail body delivered IF < 100KB; PDF too big and dropped by mailinator (real customer inboxes work) |
| PAY-015 | Invoice mail post-fix verification — all 3 paths | super_admin manual + customer self-checkout + Razorpay webhook | Trigger each | All 3 dispatch `PaymentInvoiceMail` |

---

## MODULE 8 — MAIL FUNCTIONALITY (cross-cutting)

> Each mail trigger should be tested in code AND in inbox. Use real Gmail addresses to verify attachments.

### 8.A WelcomeCredentialsMail
| ID | Trigger | Recipient | Expected content |
|---|---|---|---|
| MAIL-W01 | POST /api/clients (super_admin creates client) | New client_admin user email | Subject "Welcome to Cross Border Command — Your Login Credentials"; body shows email + plaintext password |
| MAIL-W02 | POST /api/branches (client_admin creates branch) | New branch_user email | Same subject; org name = client.org_name |
| MAIL-W03 | POST /api/employees (HR creates employee) | Employee's email | Same; user_type="employee" |
| MAIL-W04 | Mail send fails (bad SMTP) | — | Underlying create still succeeds; warning logged; user is still saved |

### 8.B OnboardingInviteMail
| ID | Trigger | Recipient | Expected |
|---|---|---|---|
| MAIL-O01 | POST /api/employees/onboarding-invite | Candidate's email | Token link arrives; clicking GET /api/onboarding/{token} returns 200 |
| MAIL-O02 | Reissue invite for same email | Same email | New token; old token now invalid |

### 8.C PasswordResetOtpMail
| ID | Trigger | Recipient | Expected |
|---|---|---|---|
| MAIL-P01 | POST /api/forgot-password/send-otp | User's email | Subject "Your Password Reset Code — Cross Border Command"; body shows 6-digit OTP |
| MAIL-P02 | Resend within 120s cooldown | — | API returns 429, NO duplicate mail |
| MAIL-P03 | OTP expires 10 min after send | Wait 10:05 then verify | Verify returns expired:true |

### 8.D PasswordChangedMail (4 trigger paths)
| ID | Trigger | Recipient | Expected |
|---|---|---|---|
| MAIL-C01 | Forgot Password completes (resetPassword) | Self | Subject "Your Password Was Changed Successfully — Cross Border Command"; new plaintext password in green box |
| MAIL-C02 | Self-change via /api/change-password | Self | Same |
| MAIL-C03 | Client admin updates branch user with `user_password` | Branch user | Same |
| MAIL-C04 | Super admin updates client with `admin_password` | Client admin | Same |
| MAIL-C05 | No password in payload (just rename branch) | — | NO mail (only sends when password actually changes) |

### 8.E PaymentInvoiceMail (3 trigger paths)
| ID | Trigger | Recipient | Expected |
|---|---|---|---|
| MAIL-I01 | PaymentController::store with status=success | client.email + client_admin.email | Subject "Payment Invoice #INV-... — Cross Border Command"; PDF attached |
| MAIL-I02 | SubscriptionController::activatePlan (Razorpay verify-payment) | Same | Same |
| MAIL-I03 | RazorpayWebhookController async webhook | Same | Same |
| MAIL-I04 | client.email = client_admin.email | Single recipient | Mail sent only once (deduped) |
| MAIL-I05 | client.email is NULL | — | Mail SKIPPED with warning logged; payment still succeeds |
| MAIL-I06 | PDF generation fails | — | Mail still sent without attachment; payment still succeeds; error logged |
| MAIL-I07 | Idempotency on Razorpay webhook | Same payment hits twice | Second call returns 200 with no double-mail |

### 8.F PlanReminderMail
| ID | Trigger | Recipient | Expected |
|---|---|---|---|
| MAIL-R01 | POST /api/payments/{id}/send-reminder | client.email + client_admin.email | Subject mentions plan/expiry; body shows valid_until date |

### 8.G Mail driver / SMTP failure handling
| ID | Title | Steps | Expected |
|---|---|---|---|
| MAIL-X01 | SMTP unavailable | Stop SMTP server, trigger any mail | All triggers caught in try/catch + Log::warning; underlying action (user create / payment activate) still succeeds |
| MAIL-X02 | SMTP slow (>30s) | Real Gmail send | Currently sync — may hit web-server timeout. If observed, consider queuing PaymentInvoiceMail (`implements ShouldQueue`) and running `php artisan queue:work` |
| MAIL-X03 | Mailinator size limit | Send 1.6 MB invoice to mailinator | Plain body arrives; PDF-attached version dropped by mailinator. Real Gmail/Outlook inboxes accept fine |

---

## MODULE 9 — MASTER DATA (Generic /master/{slug})

> Master CRUD has the same pattern across all 50+ tables. Test 1 representative per category. Slugs include: `roles`, `departments`, `designations`, `assets`, `vendor-types`, `payment-terms`, `incoterms`, `gst-percentage`, `hsn-codes`, etc.

| ID | Title | Steps | Expected |
|---|---|---|---|
| MAS-001 | List master records | GET /api/master/{slug} | 200, paginated |
| MAS-002 | Create master record | POST /api/master/{slug} | 201 |
| MAS-003 | Get next code | GET /api/master/{slug}/next-code | 200, sequential code |
| MAS-004 | Show single | GET /api/master/{slug}/{id} | 200 |
| MAS-005 | Update | PUT /api/master/{slug}/{id} | 200 |
| MAS-006 | Soft-delete | DELETE | 200 |
| MAS-007 | Invalid slug | GET /api/master/foobar | 404 / 422 |
| MAS-008 | Tenant isolation | client A user → master under B | If master is client-scoped, 403 |

---

## MODULE 10 — RECRUITMENT

### 10.A Recruitments
| ID | Title | Steps | Expected |
|---|---|---|---|
| REC-001 | Get next recruitment code | GET /api/recruitments/next-code | 200 |
| REC-002 | Create recruitment | POST | 201 |
| REC-003 | Update recruitment status | PUT status="In Progress" → "Completed" | 200 |
| REC-004 | Delete recruitment | DELETE | 200 |

### 10.B Hiring Requests
| ID | Title | Steps | Expected |
|---|---|---|---|
| HR-001 | Create hiring request | POST /api/hiring-requests | 201 |
| HR-002 | Update hiring request | PUT | 200 |

### 10.C Candidates
| ID | Title | Steps | Expected |
|---|---|---|---|
| CAN-001 | Create candidate | POST /api/candidates | 201 |
| CAN-002 | Bulk import candidates from CSV | POST /api/candidates/import | 201, count of imported rows |
| CAN-003 | Export candidates | GET /api/candidates/export | 200, CSV download |
| CAN-004 | Sample CSV download | GET /api/candidates/sample | 200, template CSV |
| CAN-005 | Update candidate status (Applied → Shortlisted) | PATCH /api/candidates/{id}/status | 200, status updated |
| CAN-006 | Status pipeline | All transitions: Applied→Shortlisted→Interview→Final→Selected→Offered | Each PATCH succeeds |
| CAN-007 | Reject status with reason | PATCH status=Rejected | 200 |
| CAN-008 | Recruitment summary | GET /api/recruitments/{id}/candidates/summary | 200, counts by status |
| CAN-009 | Candidate stats | GET /api/candidates/stats | 200 |
| CAN-010 | Download CV | GET /api/candidates/{id}/cv?token=... | 200, file streamed |

---

## MODULE 11 — EXPENSE CLAIMS (two-step approval)

| ID | Title | Steps | Expected |
|---|---|---|---|
| EXP-001 | Employee creates draft claim | POST /api/expense-claims | 201, status=draft |
| EXP-002 | Submit claim | PUT to submit | manager_status=pending |
| EXP-003 | Manager approves | POST /api/expense-claims/{id}/manager-approve | manager_status=approved, hr_status=pending |
| EXP-004 | Manager rejects | POST .../manager-reject with reason | manager_status=rejected; flow stops |
| EXP-005 | HR approves after manager | manager-approved already | POST .../hr-approve | hr_status=approved, overall=approved |
| EXP-006 | HR rejects after manager approve | — | POST .../hr-reject | hr_status=rejected |
| EXP-007 | Manager rejects after HR approves | Test ordering | Should not be allowed (pipeline order enforced) |
| EXP-008 | Download claim attachment | GET /api/expense-claims/{id}/attachments/{index}?token=... | 200, file streamed |
| EXP-009 | List expense claims | GET | scoped: employee sees own, manager sees direct reports, HR sees all in client |

---

## MODULE 12 — ANNOUNCEMENTS

| ID | Title | Steps | Expected |
|---|---|---|---|
| ANN-001 | Create draft announcement | POST /api/announcements status=Draft | 201 |
| ANN-002 | Schedule announcement | publish_type=scheduled, future date | 201, status=Scheduled |
| ANN-003 | Publish immediately | publish_type=immediate | status=Active |
| ANN-004 | Audience all_employees | audience_type=all_employees | All visible |
| ANN-005 | Audience specific roles | audience_type=roles, role_ids=[1,2] | Only those roles see it |
| ANN-006 | Audience specific designations | audience_type=designations | Only those designations |
| ANN-007 | Mandatory ack | Mandatory + reminder Daily | Reminders fire |
| ANN-008 | Optional ack | Optional | No reminder enforcement |
| ANN-009 | Announcement expires | valid_until in past | status auto-Expired (if scheduler runs) |
| ANN-010 | Stats endpoint | GET /api/announcements/stats | 200, counts by status |

---

## MODULE 13 — DASHBOARD

| ID | Title | Steps | Expected |
|---|---|---|---|
| DASH-001 | Admin stats (super_admin) | GET /api/dashboard/admin-stats | 200, total clients/branches/users/payments |
| DASH-002 | Admin stats (non-super_admin) | client_admin | GET | 403 |
| DASH-003 | Client stats (client_admin) | — | GET /api/dashboard/client-stats | 200, scoped to own client |
| DASH-004 | Client stats includes plan info | — | GET | Returns plan_name, plan_expires_at, usage |
| DASH-005 | Stats include `success_payments` count | — | GET | Includes payments with status=success |

---

## MODULE 14 — MULTI-TENANCY / DATA ISOLATION (cross-cutting)

| ID | Title | Steps | Expected |
|---|---|---|---|
| TEN-001 | client_admin A list employees | GET /api/employees | Only employees in tenant A returned |
| TEN-002 | client_admin A view employee in B | GET /api/employees/{B-id} | 403 / 404 |
| TEN-003 | client_admin A update branch in B | PUT /api/branches/{B-id} | 403, "Unauthorized" |
| TEN-004 | client_admin A list clients | GET /api/clients | 403 (super_admin only) |
| TEN-005 | employee list permissions users | GET /api/permissions/users | Empty collection (employees can't manage) |
| TEN-006 | client_admin sees all branches | branches A1/A2/A3 under client A | GET /api/employees | All employees across A1+A2+A3 |
| TEN-007 | branch_user sees only own branch | branch=A2 | GET /api/employees | Only A2 employees (sibling branches hidden) |
| TEN-008 | Plan limits scoped to client | Client A on Pro (25), Client B on Starter (1) | A creates branch | B's limit unaffected |

---

## MODULE 15 — UI / FRONTEND-SPECIFIC

> Run during exploratory testing of the React SPA.

| ID | Area | Test |
|---|---|---|
| UI-001 | Profile dropdown | Login as super_admin → "My Plan" should NOT appear (only client_admin sees it) |
| UI-002 | Profile dropdown | Login as branch_user → "My Plan" not visible |
| UI-003 | Profile dropdown | Login as client_admin → "My Plan" visible |
| UI-004 | HR mega-menu | Browser at narrow width / branch_user (fewer top items) — mega menu doesn't clip off-screen |
| UI-005 | HrEmployees table | Multi-ancillary roles render as "Role A +2"; clicking +N opens popover with all roles |
| UI-006 | Employee profile | Multi-ancillary chips show in 3 places: hero, Job Title (Secondary), Role & Positioning |
| UI-007 | Employee profile direct URL | `/hr/employees/{id}/profile` opened directly without state — should still load (currently has bug E2 — see TENANT_BUGS list) |
| UI-008 | Branch switcher | Client admin can switch between branches; branch users + employees have no switcher (locked to own branch) |
| UI-009 | Forgot password UI | Form: send-otp → verify-otp → set-password → see success toast → redirect to login |
| UI-010 | Plan upgrade | Razorpay modal opens, payment flow completes, plan activates within ~5s |

---

## APPENDIX A — KNOWN BUGS / TECH DEBT (logged during this audit)

| Bug | Severity | Location |
|---|---|---|
| Employee profile drops chips on direct URL load (no state) | **Bug** | resources/js/pages/employee/EmployeeProfile.tsx |
| Hardcoded mock data on profile (Joining Date "29-Apr-2026", Legal Entity, Probation, etc.) | **Bug** | EmployeeProfile.tsx lines 1440, 1487, 1489, 1557-1560 |
| branch_user revoking own permission does NOT cascade-clear downstream | **Bug** | PermissionController.php:254 (cascade only fires for super_admin → client_admin) |
| Orphan employees not visible in /permissions/users picker (but reachable via HR) | UX gap | PermissionController.php manageableUsers() |
| HR mega-menu `useLayoutEffect` has no dep array — runs on every render | Perf/Minor | HorizontalLayout/index.tsx |
| HR mega-menu only handles overflowLeft, ignores overflowRight | Mobile | HorizontalLayout/index.tsx clamp logic |
| AncillaryRolesChip popover repeats first chip in "All" list | UX | HrEmployees.tsx AncillaryRolesChip |
| `revokeAllUserTokensForClient` misses users with NULL client_id linked via branch | Defense gap | ClientController.php:423 |
| PaymentInvoiceMail is synchronous; ~20s SMTP latency may hit web-request timeout under load | Risk | Make queueable + run `php artisan queue:work` |

---

## APPENDIX B — TEST DATA SEEDING SNIPPET

To bootstrap a fresh QA environment:

```php
// php artisan tinker
$plan = App\Models\Plan::where('name','Basic')->first();
$client = App\Models\Client::create([
  'org_name'=>'QA Tenant','org_type'=>'Private Limited Company','email'=>'qa-tenant@cbc.test',
  'status'=>'active','plan_id'=>$plan->id,'plan_type'=>'paid',
  'plan_expires_at'=>now()->addYear(),'country'=>'India',
]);
$admin = App\Models\User::create([
  'name'=>'QA Admin','email'=>'qa-admin@cbc.test','user_type'=>'client_admin',
  'password'=>Hash::make('Test@123'),'client_id'=>$client->id,'status'=>'active',
]);
foreach (['East','North','South'] as $i => $b) {
  $branch = App\Models\Branch::create([
    'client_id'=>$client->id,'name'=>"QA $b Branch",
    'status'=>'active','country'=>'India','created_by'=>$admin->id,
  ]);
  App\Models\User::create([
    'name'=>"QA $b User",'email'=>strtolower($b)."-qa@cbc.test",
    'password'=>Hash::make('Test@123'),'user_type'=>'branch_user',
    'client_id'=>$client->id,'branch_id'=>$branch->id,'status'=>'active',
  ]);
}
```

---

## APPENDIX C — DEFECT REPORT TEMPLATE

When filing a bug found by these tests:
```
Title:        [Module] Concise summary
Severity:     Critical / Major / Minor / Trivial
Test Case ID: e.g. AUTH-008
Environment:  Browser, OS, role, tenant
Steps:        1, 2, 3...
Expected:     What the test case says
Actual:       What you observed
Evidence:     Screenshot / network HAR / log excerpt
Notes:        Reproducible? Frequency? Workaround?
```

---

**End of QA Test Plan.** File location: `docs/QA_TEST_PLAN.md`. Maintain alongside the codebase — every new module or mailable should add a section here.
