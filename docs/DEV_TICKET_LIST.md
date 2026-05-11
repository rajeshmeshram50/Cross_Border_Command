# Cross_Border_Command — Development Ticket List

> **Total tickets**: 1518  
> Generated 2026-05-11T07:00:35+00:00

Sequential development tasks grouped from real code paths, models, and feature areas
across the platform. Each item is an actionable engineering task (one developer-day or less).

---

1. Setup Laravel Sanctum API authentication in Cross_Border_Command
2. Configure SANCTUM_EXPIRATION env variable for token lifetime
3. Implement /api/login endpoint in AuthController with email and password validation
4. Add ValidationException handling for invalid login credentials
5. Add user.status active check to login flow
6. Add effective_client status check via branch traversal for branch_user login
7. Add branch.status active check in login validation
8. Implement Sanctum personal access token issuance after successful login
9. Revoke all prior tokens on new login via $user->tokens()->delete()
10. Update users.last_login_at and last_login_ip on successful login
11. Increment users.login_count after successful login
12. Store login_source = web on each Sanctum login event
13. Implement /api/me endpoint for fetching current user with relations
14. Cache user data in localStorage as cbc_user on frontend
15. Add token attached via axios request interceptor from localStorage cbc_token
16. Implement EnsureUserActive middleware to revalidate user/client/branch status on every request
17. Revoke tokens automatically when EnsureUserActive detects inactive state
18. Implement /api/logout endpoint that deletes the current access token
19. Implement /api/google-login endpoint with Google ID token verification
20. Validate Google ID token via Google_Client class
21. Verify email_verified flag in Google payload before accepting login
22. Store google_id on user record after first Google login
23. Reject Google login when user account is not active
24. Reject Google login when tenant is inactive
25. Implement brute-force lockout after 5 failed login attempts
26. Store login_attempts counter in cache keyed by lowercased email
27. Set 15-minute lockout window for brute-force protection
28. Clear login_attempts counter on successful login
29. Skip brute-force counter when security.bruteForce setting is OFF
30. Add rate-limit middleware on /api/login endpoint
31. Implement 401 response interceptor in api.ts that reloads on session loss
32. Skip /me URL in 401 interceptor to avoid jarring reloads
33. Persist last 401 source to localStorage cbc_last_auth_error for debugging
34. Throttle window.focus-triggered /me refresh to once per 60 seconds
35. Implement idle-timeout component for auto-logout after configurable hours
36. Wire IdleTimeout to security.sessTimeout setting toggle
37. Listen for mouse/keyboard/touch/scroll events to reset idle timer
38. Display toast notification before auto-logout fires
39. Update password via /api/change-password endpoint with current-password check
40. Block password reuse against last 3 historical passwords via PasswordHistory trait
41. Hash new password with bcrypt before saving
42. Record old password hash to password_histories before overwriting
43. Send PasswordChangedMail after successful in-app password change
44. Implement /api/forgot-password/send-otp endpoint with 6-digit OTP generation
45. Hash OTP at rest in password_reset_otps table
46. Set 10-minute expiry on generated OTPs
47. Enforce 120-second cooldown between OTP resend requests
48. Send PasswordResetOtpMail with CC to internal monitoring inbox
49. Implement /api/forgot-password/verify-otp endpoint
50. Track attempts count and invalidate OTP after 5 failed verifies
51. Auto-delete expired OTP rows on verify check
52. Implement /api/forgot-password/reset endpoint with password reset
53. Require verified OTP row before allowing password reset
54. Send PasswordChangedMail after successful forgot-password reset
55. Revoke all user tokens after forgot-password completes
56. Add CSRF protection audit on auth-related endpoints
57. Add session timeout countdown UI before auto-logout fires
58. Implement re-auth prompt for sensitive admin actions
59. Add login audit log table for forensic trail
60. Add password strength meter to all password input fields
61. Enforce password complexity (uppercase, digit, symbol)
62. Update /api/me/profile endpoint for self profile edit (name, phone, designation)
63. Block email change via /api/me/profile (email is login identifier)
64. Validate phone via regex on /api/me/profile updates
65. Implement /api/me/branding endpoint for tenant logo and color updates
66. Allow client_admin to update client.logo and colors via /me/branding
67. Allow branch_user to update branch.logo and colors via /me/branding
68. Reject super_admin from /me/branding (no tenant attachment)
69. Validate uploaded logo file type and size on /me/branding
70. Strip path traversal characters from filenames before storage
71. Add device-fingerprint tracking for new-device login notifications
72. Implement two-factor authentication via TOTP for admin users
73. Add QR code enrollment screen for TOTP setup
74. Add backup-code generation for TOTP-locked-out users
75. Implement IP allowlist middleware per tenant
76. Add password rotation enforcement every 90 days
77. Block login when password is stale beyond rotation window
78. Send PasswordChangedMail recipients include CC to admin
79. Create clients table migration with org details and plan info
80. Add unique index on clients.email for tenant identifiers
81. Add gst_number and pan_number regex validation in ClientController
82. Canonicalize GSTIN/PAN to uppercase before validation
83. Add unique-per-tenant rule on GSTIN excluding soft-deleted rows
84. Add unique-per-tenant rule on PAN excluding soft-deleted rows
85. Implement /api/clients index endpoint with pagination and search
86. Implement /api/clients/stats endpoint with active/inactive counts
87. Implement /api/clients/{id} show endpoint with plan and admin relations
88. Implement /api/clients store endpoint with validation and admin user creation
89. Hash admin_password via Hash::make on client creation
90. Send WelcomeCredentialsMail to new client_admin on creation
91. Gate WelcomeCredentialsMail by notifications.newUser setting
92. Default new client status to inactive when status not provided
93. Default new client plan_type to free regardless of form input
94. Block plan_type=paid via admin client form (only verifyPayment path)
95. Implement /api/clients/{id} update endpoint
96. Detect status transition active→non-active in client update
97. Revoke all user tokens for client on status transition to non-active
98. Replace client logo file and delete old asset on logo upload
99. Replace client favicon file and delete old asset on favicon upload
100. Update linked client_admin user when admin_* fields are provided
101. Hash admin_password on client update only when password field provided
102. Send PasswordChangedMail to client_admin when super_admin rotates password
103. Implement /api/clients/{id} destroy endpoint with cascading soft-delete
104. Soft-delete users and branches when client is destroyed
105. Revoke all client tokens before soft-deleting users
106. Add helper revokeAllUserTokensForClient to ClientController
107. Extend revokeAllUserTokensForClient to cover branch-linked users with null client_id
108. Add ClientController stats counts for total/active/inactive clients
109. Add tenant scoping so non-super_admin cannot list other clients
110. Add 403 response when non-super_admin attempts client modification
111. Add client.org_type validation against organization_types master
112. Add organization_types CRUD via /api/organization-types endpoints
113. Add inline-edit support for client status from list view
114. Add CSV import for bulk client creation
115. Add CSV export for client list
116. Add client activity timeline endpoint
117. Add client suspension reason field and persist to clients table
118. Email client_admin when client status changes to suspended
119. Add Indian state dropdown sourced from masters.states
120. Validate website URL with HEAD request before saving
121. Normalize phone numbers to E.164 format on client save
122. Add client age (created_at) display in list view
123. Auto-mirror admin_status to client.status to prevent stale-admin lockout
124. Sanitize org_name and description for XSS in list rendering
125. Add ClientForm in React with sections for org info, billing, admin user
126. Add validateClientForm function with field-level errors
127. Display server errors inline on client edit form
128. Show plan and plan_expires_at info on ClientView page
129. Add client logo preview component with upload-on-change
130. Add color picker for primary_color and secondary_color on ClientForm
131. Persist tenant theme on /me payload as primary_color and secondary_color
132. Apply tenant theme via CSS root vars in AuthContext useEffect
133. Fall back to platform settings.appearance colors when tenant has none
134. Show client status pill with green/yellow/red mapping
135. Show plan name and expiry chip on ClientView header
136. Add client onboarding wizard replacing single-page form
137. Add Clients page search debounce of 400ms
138. Add Clients page status filter dropdown
139. Add Clients page org_type filter dropdown
140. Add Clients page paginated table with sortable columns
141. Add ClientView page with tabs for Profile, Branches, Permissions, Payments, Settings
142. Add Clients.tsx ActionBtn icon-pill component for row actions
143. Add ClientBranches sub-page listing branches for a single client
144. Add ClientPermissions sub-page showing permission grants per client_admin
145. Add ClientPayments sub-page filtering payments by client_id
146. Add ClientSettings sub-page (currently placeholder)
147. Add bulk-actions toolbar on Clients list page
148. Add bulk-suspend action with confirmation modal
149. Add bulk-export to CSV action with selected rows
150. Add client logo upload size limit of 2MB and format validation
151. Add client favicon upload size limit of 512KB
152. Add client-form input mask for GST and PAN fields
153. Add client industry dropdown sourced from masters
154. Add notes field to clients table for super_admin context
155. Add client.created_by_email column for audit
156. Add client.last_status_change_at column for audit
157. Add client.last_status_change_by column for audit
158. Add validation: at most one client_admin user per client
159. Create branches table migration with client_id FK and is_main flag
160. Add unique-per-client constraint on branches.name excluding soft-deleted
161. Add unique-per-client constraint on branches.gst_number
162. Add unique-per-client constraint on branches.pan_number
163. Implement /api/branches index endpoint with client scoping
164. Implement /api/branches/{id} show endpoint with users/departments counts
165. Implement /api/branches store endpoint with branch_user creation
166. Hash user_password via Hash::make on branch user creation
167. Send WelcomeCredentialsMail to new branch_user on branch creation
168. Gate branch welcome mail by notifications.newUser setting
169. Enforce plan limit (plans.max_branches) before allowing new branch creation
170. Return 422 with branch-limit message when over plan cap
171. Skip branch limit check when plans.max_branches is 0 (unlimited)
172. Auto-demote existing main branch when new branch sets is_main=true
173. Add auto-stamped Head Office branch on client creation
174. Hide auto Head Office branch in branches index when include_head_office is false
175. Filter Head Office by code=HO and name pattern in index query
176. Implement /api/branches/{id} update endpoint
177. Skip name-uniqueness check on update when name unchanged (legacy duplicates)
178. Detect branch.status transition to inactive in update
179. Revoke all branch user tokens on status transition to inactive
180. Update linked branch_user when user_* fields are provided
181. Hash user_password on branch update only when password field provided
182. Send PasswordChangedMail to branch_user when client_admin rotates password
183. Implement /api/branches/{id} destroy with branch user soft-delete
184. Revoke branch user tokens before soft-deleting
185. Apply tenant scoping so client_admin sees only own branches
186. Allow main-branch user to see and manage sibling branches
187. Restrict sub-branch user to own branch in all endpoints
188. Add branch_id auto-injection via axios request interceptor
189. Read selected branch id from cbc_selected_branch_id_<userId> in localStorage
190. Skip /branches URL in branch_id interceptor (avoid dropdown self-narrow)
191. Apply branch filter only on GET requests via interceptor
192. Allow pages to opt-out by passing branch_id="" explicitly
193. Build BranchSwitcher component in topbar with dropdown
194. Build BranchSwitcherContext with per-user-id persistence
195. Lock sub-branch users in BranchSwitcher (no dropdown shown)
196. Allow main-branch user and client_admin to switch branches via dropdown
197. Include All Branches option in switcher dropdown
198. Recompute initial selection after /branches loads
199. Apply ?branch_id=N filter inside applyScope helper in EmployeeController
200. Apply ?branch_id=N filter in MasterController applyScope
201. Apply ?branch_id=N filter in RecruitmentController applyScope
202. Apply ?branch_id=N filter in HiringRequestController applyScope
203. Apply ?branch_id=N filter in CandidateController applyScope
204. Apply ?branch_id=N filter in AnnouncementController applyScope
205. Apply ?branch_id=N filter in PermissionController manageableUsers
206. Apply ?branch_id=N filter in BranchController index for direct queries
207. Validate branch_id belongs to user.client_id before applying filter
208. Silently ignore cross-tenant branch_id to avoid 403 on stale localStorage
209. Add helper applySwitcherBranchFilter to share narrowing logic
210. Add Branches list page with status filter and search
211. Add BranchForm in React with sections for branch info, user, branding
212. Add validation: branch_type dropdown sourced from masters
213. Add max_users field per branch with plan-driven default
214. Add established_at date field for branch incorporation date
215. Show branch user info on BranchView page
216. Add branch logo and color override in BranchForm
217. Add Branches list ActionBtn with edit, view, delete actions
218. Auto-redirect post-create to BranchView page
219. Show branch active/inactive pill with color
220. Display employee count per branch in list view
221. Implement branch transfer (move employees between branches)
222. Add branch performance dashboard per main branch
223. Add branch deactivation reason field on update
224. Show plan-limit warning when 80%+ of branch quota used
225. Add branch creation tutorial inline help
226. Build BranchView with breadcrumbs and back navigation
227. Add bulk branch export to CSV
228. Create employees table migration with tenant + personal + employment fields
229. Add employees.user_id FK to users for paired login account
230. Add employees.reporting_manager_id FK self-reference
231. Add employees.emp_code unique-per-tenant constraint
232. Add employees.ancillary_role_ids JSON column for multi-roles
233. Add migration to backfill ancillary_role_ids from legacy ancillary_role_id
234. Cast employees.ancillary_role_ids as array in Employee model
235. Cast employees.assets and other_master_asset_ids as array
236. Add ancillary_roles_resolved accessor in Employee model
237. Sort ancillary_roles_resolved by user-pick order via array_search
238. Add other_assets_resolved accessor for short-circuit empty list
239. Implement /api/employees index endpoint with eager-loaded relations
240. Implement /api/employees/{id} show endpoint
241. Implement /api/employees/next-code endpoint returning next EMP-### code
242. Implement /api/employees/managers endpoint returning eligible managers
243. Implement /api/employees/available-assets endpoint
244. Implement /api/employees store endpoint with payload validation
245. Validate ancillary_role_ids array of integers in store
246. Run mirrorAncillaryRoles to keep legacy ancillary_role_id in sync
247. Empty ancillary_role_ids array clears legacy column to null
248. Hash employee user password via Hash::make on create
249. Send WelcomeCredentialsMail to new employee with credentials
250. Gate employee welcome mail by notifications.newUser setting
251. Assert no double-booked assets across employees on create
252. Implement /api/employees/{id} update endpoint
253. Ratchet wizard_step as high-watermark on update
254. Skip dangling asset references on update via stripDanglingAssetRefs
255. Implement /api/employees/{id} destroy with soft-delete + user disable
256. Revoke employee user tokens on soft-delete
257. Implement /api/employees/{id}/restore endpoint
258. Re-enable linked user when restoring soft-deleted employee
259. Apply applyScope tenant rules in employee list endpoint
260. Branch user sees own branch + main-branch shared employees
261. Main-branch user sees all sibling branches employees
262. Client_admin sees all employees across own client
263. Super_admin sees all employees globally
264. Add applyBranchFilter narrowing within applyScope
265. Build HrEmployees React page with table and action chips
266. Build AncillaryRolesChip component for multi-role pill + popover
267. Render +N badge when employee has multiple ancillary roles
268. Open floating popover on +N click via React Portal
269. Close popover on outside-click, Esc, scroll, resize
270. Use position: fixed + getBoundingClientRect to align popover
271. Show roles in pick-order inside popover
272. Build Employee form wizard with multi-step navigation
273. Wire employee form to /api/employees/next-code on first mount
274. Persist draft wizard state to localStorage on each step
275. Restore wizard draft on page reload
276. Validate required fields per step before allowing next
277. Submit final wizard form to /api/employees on last step
278. Show success toast and redirect to HrEmployees on save
279. Build EmployeeProfile page with hero, sections, tabs
280. Wire EmployeeProfile to read employee from router state OR fetch by id
281. Render multi-ancillary chips in hero section
282. Render multi-ancillary chips in Job Title (Secondary) section
283. Render multi-ancillary chips in Role & Positioning section
284. Replace hardcoded mock data (Joining Date, Legal Entity) with real fields
285. Replace hardcoded Probation/Notice/Contract with DB-backed fields
286. Replace mock email fallback with employee email or user email
287. Show profile completion percentage badge
288. Build profile timeline tab with hire/promotion/exit events
289. Build profile payroll tab with summary view
290. Build profile vault tab for documents
291. Build profile expense filter with all/approved/rejected views
292. Build apply-leave wizard inline within profile
293. Build attendance regularization modal
294. Show timelog history with last-7-month month picker
295. Build employee export-timelogs button with toast
296. Wire EmployeeProfile to AuthContext for self-profile detection
297. Add EmployeeProfile fallback when accessed via /profile route
298. Build EmployeeProfileRouter that picks profile vs admin Profile by user_type
299. Index employees(client_id, branch_id) for faster list queries
300. Index employees.emp_code for lookup performance
301. Index employees.reporting_manager_id for manager queries
302. Validate date_of_joining cannot be in the past for new employees
303. Default employee status to Active on create
304. Add employee_status enum: Active, Inactive, On Leave, Probation, Notice Period, Resigned, Terminated
305. Add employee_biometric_status enum and tracking
306. Add employee_id_card_status enum and tracking
307. Add Employee→User relation with belongsTo
308. Add Employee→Department relation with belongsTo
309. Add Employee→Designation relation with belongsTo
310. Add Employee→Branch relation with belongsTo
311. Add Employee→Client relation with belongsTo
312. Add Employee→reportingManager relation self-belongsTo
313. Build employee directory with search filters
314. Build employee org chart visualisation
315. Add employee birthday and anniversary reminders cron job
316. Add employee skill matrix table and CRUD
317. Add employee 360-review module
318. Add employee leave balance tracker
319. Add employee social profile links field
320. Add employee photo upload with crop
321. Save employee photo via employee_documents table with document_key=photo
322. Read employee photo via photo_url accessor on Employee model
323. Display employee photo in HrEmployees table and profile
324. Add bulk employee import via CSV
325. Add bulk employee export to CSV
326. Add employee search by name, code, email, mobile
327. Add employee filter by department, designation, status, branch
328. Add disabled-employees tab on HrEmployees page using withTrashed
329. Create employee_documents table migration
330. Add employee_documents.document_key column for typed docs (aadhar, pan, photo)
331. Add employee_documents.verified_at timestamp and verified_by FK
332. Implement /api/employees/{employee}/documents index endpoint
333. Implement /api/employees/{employee}/documents store with file upload
334. Validate file types (pdf, jpg, png) and size limits
335. Store uploaded files under storage/app/public/employee-documents/{employee}
336. Implement /api/documents/{document}/verify endpoint
337. Implement /api/documents/{document}/reject endpoint with reason
338. Implement /api/documents/{document} destroy endpoint
339. Delete physical file from storage on document destroy
340. Add document_type dropdown sourced from masters.document_type
341. Add document expiry_date for documents with renewal cycles
342. Add document_number field for KYC documents
343. Build employee documents tab in EmployeeProfile vault section
344. Build document upload card with drag-and-drop
345. Build document preview modal for PDFs and images
346. Add document verification status pill (verified/pending/rejected)
347. Show document expiry warning when within 30 days of expire
348. Send email notification when document is rejected
349. Add bulk document verification action for HR
350. Add document download with token-query auth for direct browser opens
351. Add audit log entry when document is verified or rejected
352. Add document version history when same key is re-uploaded
353. Compress images on upload to reduce storage footprint
354. Strip EXIF metadata from uploaded photos for privacy
355. Add magic-byte validation on upload (not just extension)
356. Add virus scan integration for uploaded files
357. Implement document expiry reminder cron with email to employee
358. Add document watermark on view (employee name + date)
359. Show document upload progress bar in UI
360. Build documents export to ZIP for offboarding
361. Add OCR auto-extract for Aadhaar and PAN documents
362. Validate Aadhaar number Verhoeff checksum
363. Add document tags for free-form categorisation
364. Add document upload by employee themselves (self-service)
365. Add document HR review queue with bulk actions
366. Add document acceptance terms checkbox before upload
367. Add document expiry export to CSV
368. Add legal hold flag preventing document deletion
369. Add document audit trail with view/download events
370. Add document templates for required document set per role
371. Add bulk document tagging by HR
372. Build document review SLA timer
373. Add document verification by reporting manager (delegated)
374. Add document review escalation when SLA missed
375. Add document watermark with viewer email for traceability
376. Add per-document permission gate (some docs visible only to HR)
377. Add documents count badge on employee profile
378. Add documents status filter on HrEmployees list
379. Create employee_exit table migration
380. Add exit_type enum (resignation, termination, retirement)
381. Add notice_period_start and last_working_day fields
382. Implement /api/employees/{employee}/exit show endpoint
383. Implement /api/employees/{employee}/exit upsert endpoint
384. Add exit reason free-text field
385. Add exit clearance checklist (IT, Finance, HR, Admin)
386. Add full_and_final_amount calculation field
387. Trigger employee.status update on exit save
388. Send exit acknowledgement email to employee
389. Send exit alert email to manager and HR
390. Build HrExitManagement React page with active-exit cards
391. Build exit-process timeline visualisation
392. Add exit-interview form integration
393. Block expense submission after exit_date
394. Generate experience letter on completion of clearance
395. Generate relieving letter PDF download
396. Auto-revoke user tokens on last_working_day
397. Auto-soft-delete employee row on last_working_day
398. Add exit reports to dashboard
399. Add bulk exit processing for layoffs
400. Add exit reason categories master
401. Add exit feedback survey link in acknowledgement email
402. Add exit checklist items as configurable master
403. Track clearance completion timestamps per item
404. Block clearance close when items pending
405. Add HR override to force-close pending clearance
406. Add exit summary export to CSV for analytics
407. Add monthly exit-rate KPI to dashboard
408. Create previous_employments table migration
409. Add company_name, role, start_date, end_date fields
410. Add reason_for_leaving and gross_salary fields
411. Implement /api/employees/{employee}/previous-employments index
412. Implement POST /api/employees/{employee}/previous-employments
413. Implement PATCH /api/previous-employments/{prev} update
414. Implement DELETE /api/previous-employments/{prev}
415. Validate end_date is after start_date
416. Allow current role flag (no end_date) for one row per employee
417. Build previous employment section in EmployeeProfile
418. Sort previous employments by start_date desc
419. Compute total work experience from previous employments
420. Auto-fill previous employment from LinkedIn parser
421. Validate gross salary against currency master
422. Add document upload per previous employment (offer letter, relieving)
423. Add reference contact name and phone per previous employment
424. Build previous employment timeline visualisation
425. Add filter by industry on previous employment
426. Export previous employment to CV PDF
427. Add verification status per previous employment
428. Create employee_onboarding_invites table migration
429. Add invite token column with cryptographically secure generation
430. Add expires_at and used_at columns
431. Add invite status enum (pending, completed, expired, cancelled)
432. Implement /api/employees/onboarding-invite endpoint to issue invite
433. Build OnboardingInviteMail with token link
434. Gate onboarding invite mail by notifications.newUser setting
435. Embed app_origin in invite URL so link opens current SPA
436. Implement GET /api/onboarding/{token} public endpoint
437. Return 410 for expired/used/cancelled tokens
438. Auto-mark token as expired when expires_at passes
439. Return master dropdowns scoped to inviting tenant on show
440. Implement POST /api/onboarding/{token}/complete endpoint
441. Validate full onboarding payload on completion
442. Create paired User account on onboarding completion
443. Hash generated password and stamp on User
444. Send WelcomeCredentialsMail with new password on completion
445. Mark invite status=completed and stamp employee_id
446. Build PublicOnboarding React page with multi-step form
447. Show inviting tenant name and department on form header
448. Support photo upload during onboarding
449. Support document upload during onboarding (Aadhaar, PAN, photo, etc.)
450. Persist onboarding-form draft in localStorage by token
451. Build HrEmployeeOnboarding admin page to issue and track invites
452. Show invite status badges (pending/completed/expired)
453. Add resend-invite action (revokes old, creates new token)
454. Add cancel-invite action with reason
455. Add bulk invite via CSV upload
456. Add expected_join_date field on invite
457. Add expiry_days options (3/7/15/30) on invite issue
458. Filter manageable invites by client and branch on admin page
459. Show invite URL with copy-to-clipboard for offline sharing
460. Add stats card showing invite counts per status
461. Show invite link expiry countdown on admin page
462. Auto-clean expired invites after 60 days
463. Add audit log entry on every invite action
464. Add invite analytics — conversion rate, avg time-to-complete
465. Send reminder email 24h before invite expiry
466. Track invite views and form starts for analytics
467. Add invite preview mode for HR to see what candidate sees
468. Add invite customisation per role (different doc requirements)
469. Add automatic invite revocation after first successful use
470. Validate token format before DB lookup (avoid SQL hits on garbage)
471. Add invite-specific master data filter (e.g. only show India states for India tenant)
472. Add bulk-invite progress bar with retry-on-error
473. Show inviter name on candidate-side onboarding form
474. Add Saved-as-draft state on PublicOnboarding form
475. Send onboarding-completion email back to inviter
476. Build candidate-side photo crop tool
477. Build candidate-side address auto-complete via pincode lookup
478. Add browser back-button warning on PublicOnboarding form
479. Create recruitments table migration with tenant and code fields
480. Add recruitment status enum (In Progress, Completed, Cancelled)
481. Add recruitment employment_type enum (Full Time, Part Time, Contract, Internship)
482. Add recruitment work_mode enum (On-site, Remote, Hybrid, Flexible)
483. Implement /api/recruitments/next-code endpoint
484. Implement /api/recruitments index with applyScope tenant rules
485. Implement /api/recruitments store endpoint
486. Validate recruitment payload via validatePayload helper
487. Guard against duplicate (job_title+department) per tenant on create
488. Allocate per-tenant recruitment code via allocateCode
489. Implement /api/recruitments/{id} show endpoint
490. Implement /api/recruitments/{id} update endpoint
491. Implement /api/recruitments/{id} destroy with soft-delete
492. Apply applyScope tenant filtering with branch_id narrow
493. Add applySwitcherBranchFilter to RecruitmentController
494. Build HrRecruitment React page with kanban or list view
495. Build recruitment-form with job description, required skills, qualification
496. Add required_experience field with min/max years
497. Add preferred_profile free-text field
498. Add hiring_priority enum (Critical, High, Medium, Low)
499. Add recruitment kanban view by status pipeline
500. Add interview scheduling module
501. Add candidate evaluation scorecard per recruitment
502. Add offer letter template generator linked to recruitment
503. Add time-to-hire and time-to-offer metrics on recruitment
504. Add recruitment pipeline conversion analytics
505. Add recruitment social-share button for job postings
506. Add candidate referral program tracking per recruitment
507. Add bulk-archive completed recruitments
508. Add recruitment audit log
509. Create hiring_requests table migration
510. Add hiring request code with HRQ-### per-tenant sequence
511. Add openings, urgency, employment_type, work_mode fields
512. Add business_justification, hiring_need_reason, current_team_gap fields
513. Add request_type enum (replacement, expansion, contractor)
514. Implement /api/hiring-requests/next-code endpoint
515. Implement /api/hiring-requests index with applyScope
516. Implement /api/hiring-requests store with validatePayload
517. Validate (title+department) duplicate per tenant on create
518. Allocate per-tenant HRQ-### sequence
519. Implement /api/hiring-requests/{id} show endpoint
520. Implement /api/hiring-requests/{id} update endpoint
521. Implement /api/hiring-requests/{id} destroy with soft-delete
522. Add HiringRequestCreatedMail mailable
523. Build emails/hiring-request-created.blade.php template
524. Send HiringRequestCreatedMail on store via notifyManager
525. Resolve creator employee from auth user_id
526. Resolve reporting manager via creator.reporting_manager_id
527. Use manager.email as primary recipient, manager.user.email fallback
528. Silently no-op when creator has no Employee row
529. Silently no-op when creator has no reporting_manager_id
530. Silently no-op when manager has no usable email
531. Gate hiring-request mail by master notifications.emailNotif setting
532. Wrap mail dispatch in try/catch to prevent rollback on SMTP error
533. Log warning on mail failure without breaking request creation
534. Apply applySwitcherBranchFilter to HiringRequestController
535. Build hiring-request form with sections: basics, hiring need, role details, justification
536. Add Save-as-Draft button on hiring-request form
537. Add submitted vs draft status differentiation
538. Show approval pipeline UI for hiring requests
539. Add manager approval action on hiring request
540. Send notification to HR after manager approval
541. Convert approved hiring request into Recruitment row
542. Add hiring-request CSV export
543. Add hiring-request analytics per department
544. Add target_join_date field with date picker
545. Add daily_responsibilities free-text field
546. Add required_skills and required_qualification fields
547. Add what_if_not_filled field for risk justification
548. Create candidates table migration with recruitment_id FK
549. Add candidate status enum (Applied, Shortlisted, In Interview, Final Interview, Selected, Offered, Rejected, On Hold)
550. Add candidate source enum (LinkedIn, Naukri, Indeed, Referral, etc.)
551. Add notice_period enum (Immediate, 15/30/45/60/90 Days)
552. Add transport_mode enum for commute estimation
553. Implement /api/candidates index with applyScope and recruitment filter
554. Implement /api/candidates store endpoint
555. Implement /api/candidates/{id} show endpoint
556. Implement /api/candidates/{id} update endpoint
557. Implement /api/candidates/{id} destroy endpoint
558. Implement /api/candidates/stats endpoint with status breakdown
559. Implement /api/candidates/sample CSV template download
560. Implement /api/candidates/import bulk CSV import
561. Parse CSV with header detection and column mapping
562. Drop rows with BOM characters during import
563. Validate each CSV row before persisting (email required, etc.)
564. Skip duplicate emails within same recruitment on import
565. Return import summary with success/skip/error counts
566. Implement /api/candidates/export CSV download with current filter
567. Implement /api/candidates/{candidate}/cv download with token-query auth
568. Implement PATCH /api/candidates/{candidate}/status endpoint
569. Enforce forward-only status transitions (no Selected → Applied)
570. Implement /api/recruitments/{recruitment}/candidates/summary endpoint
571. Return per-status candidate counts in recruitment summary
572. Apply applySwitcherBranchFilter to CandidateController
573. Build HrCandidates React page with kanban view
574. Build kanban columns per status with drag-and-drop transitions
575. Build candidate detail panel with full profile
576. Show CV download button with auth token in URL
577. Add candidate notes timeline with author attribution
578. Add candidate interview scheduling
579. Add candidate evaluation scorecard with rubric
580. Add candidate communication log (email/call records)
581. Add candidate rejection-reason categorisation
582. Add candidate offer-letter generation with template
583. Add candidate offer acceptance/decline tracking
584. Convert offered candidate to Employee after acceptance
585. Auto-issue onboarding invite to selected candidate
586. Add candidate-source ROI analytics
587. Add candidate referral tracking with bonus payout
588. Add candidate skill tagging
589. Add candidate ranking by score
590. Add bulk-status update with reason capture
591. Build candidate search by name, email, phone, skills
592. Add candidate filter by status, source, recruitment, notice period
593. Add candidate stats card on recruitment view
594. Add candidate timeline tracking (applied → interviewed → offered)
595. Add candidate referrer name and contact tracking
596. Add candidate expected_salary and current_salary fields
597. Add candidate transport mode for commute analysis
598. Compress candidate CV PDFs on upload
599. Strip metadata from CV PDFs on upload
600. Add candidate consent capture for data retention
601. Block candidate creation for closed recruitment
602. Add candidate stage advance reminder email
603. Add candidate offer expiry tracking
604. Add reapplication tracking (same email across recruitments)
605. Add candidate WhatsApp integration for communication
606. Create expense_claims table migration
607. Add claim status (draft, manager_review, hr_review, approved, rejected)
608. Add manager_status enum and hr_status enum
609. Add manager_status_at and hr_status_at timestamps
610. Add manager_status_by and hr_status_by user FKs
611. Implement /api/expense-claims index with scope=mine|team|all
612. Apply tenant + branch + employee scoping in expense claim list
613. Implement /api/expense-claims store with attachments
614. Resolve employee_id from request input or current user
615. Block claim filing for other employees (except super_admin)
616. Validate currency, project, payment_method on store
617. Generate EXP-### claim_no per tenant tuple
618. Implement /api/expense-claims/{id} show with permission scope check
619. Implement /api/expense-claims/{id}/manager-approve endpoint
620. Implement /api/expense-claims/{id}/manager-reject endpoint with reason
621. Implement /api/expense-claims/{id}/hr-approve endpoint
622. Implement /api/expense-claims/{id}/hr-reject endpoint
623. Block HR approval before manager approval (pipeline order)
624. Block manager rejection after HR approval
625. Implement /api/expense-claims/{id}/attachments/{index} download
626. Apply applySwitcherBranchFilter to ExpenseClaimController
627. Build HrExpenseManagement React page with tabs (mine, team, all)
628. Build expense claim form with drag-and-drop receipt upload
629. Add receipt OCR auto-extract (amount, date, vendor)
630. Add multi-currency expense entry with exchange rate snapshot
631. Add mileage tracker for per-km claims
632. Add per-diem calculator based on city tier
633. Add expense category dropdown from masters
634. Add manager-delegation when manager on leave
635. Send email to manager on submit
636. Send email to HR on manager approval
637. Send email to employee on final decision
638. Add expense reports per category and per employee
639. Add expense audit log
640. Add bulk expense approval for managers
641. Add expense attachment count limit (max 5 per claim)
642. Add expense attachment size limit per file
643. Add expense duplicate detection (same vendor + date + amount)
644. Add expense advance payment offset tracking
645. Add expense reimbursement payout integration
646. Add expense GST input credit tracking
647. Add expense department-wise budget tracking
648. Create announcements table migration
649. Add announcement status enum (Draft, Scheduled, Active, Expired, Archived)
650. Add announcement type enum (General, Policy, Urgent)
651. Add announcement priority enum (Normal, High, Critical)
652. Add audience_type enum (all_employees, roles, designations)
653. Add publish_type enum (immediate, scheduled)
654. Add acknowledgement_mode enum (Mandatory, Optional)
655. Add ack_reminder_frequency enum (Daily, Weekly, Never)
656. Implement /api/announcements index with tenant scope
657. Implement /api/announcements/stats endpoint
658. Implement /api/announcements/next-code endpoint
659. Implement /api/announcements store endpoint
660. Implement /api/announcements/{id} show endpoint
661. Implement /api/announcements/{id} update endpoint
662. Implement /api/announcements/{id} destroy endpoint
663. Apply applySwitcherBranchFilter to AnnouncementController
664. Refresh lifecycle status on list call (scheduled → active → expired)
665. Build HrBroadcastCentre React page with tabs and filters
666. Build announcement-form with rich text editor for body
667. Add audience targeting UI (all/roles/designations multiselect)
668. Add scheduled publish date/time picker
669. Add mandatory-ack toggle and reminder cadence
670. Build employee-side broadcast viewer
671. Track ack receipts per employee per announcement
672. Send mandatory-ack reminder emails per cadence
673. Add ack-status dashboard for HR
674. Add bulk-archive expired announcements
675. Add announcement attachments (PDF, image)
676. Add announcement preview before publish
677. Add announcement search and filter by status/priority/type
678. XSS-sanitize announcement body on save
679. Add announcement category dropdown from masters
680. Add announcement read-receipts visualisation
681. Send daily announcement digest to non-ack users
682. Add announcement notification preferences per employee
683. Add announcement export to PDF
684. Add announcement template gallery
685. Create permissions table migration with module_id and user_id
686. Add can_view, can_add, can_edit, can_delete, can_export, can_import, can_approve booleans
687. Add granted_by FK to users for audit
688. Create modules table with parent_id for tree structure
689. Add module slug column for codename lookup
690. Add module is_active and sort_order columns
691. Add module is_default flag for system-required modules
692. Implement /api/modules endpoint returning active module tree
693. Implement /api/permissions/users endpoint listing manageable users
694. Allow super_admin to manage permissions for any client_admin
695. Allow client_admin to manage permissions for branch_users and employees in own client
696. Allow main-branch user to manage permissions across sibling branches
697. Restrict sub-branch user from /permissions/users endpoint
698. Exclude self from manageableUsers list
699. Apply applySwitcherBranchFilter to manageableUsers
700. Implement /api/permissions/user/{userId} get endpoint
701. Allow self-read of own permissions
702. Allow super_admin to read any user permissions
703. Allow client_admin and main-branch user to read users in own client
704. Allow read of orphan users (NULL client_id) for client_admin / main-branch
705. Implement /api/permissions/user/{userId} save endpoint
706. Block save for super_admin target users
707. Block save when target not in granter manageable set
708. Adopt orphan employees into granter tenant on first grant
709. Set client_id and branch_id on orphan adoption
710. Validate granted flags cannot exceed granter own flags
711. Skip permissions for parent modules (only leaf modules get perms)
712. Wipe existing permissions before insert on save
713. Skip empty-flag perm rows (don't insert rows with all false)
714. Run cascade-clear when super_admin updates client_admin permissions
715. Cascade-clear branch_user perms when admin loses a flag
716. Cascade-clear employee perms when admin loses a flag
717. Run cascade-prune on plan downgrade via SubscriptionController
718. Build Permissions React page with module tree
719. Build user-picker dropdown for permissions page
720. Build matrix UI with row-per-module and column-per-action
721. Add bulk-toggle by row (all actions for one module)
722. Add bulk-toggle by column (one action across all modules)
723. Show inherited-from-plan badge on plan-granted permissions
724. Add permission diff view (compare two users)
725. Add permission templates per role
726. Add time-bound permission grants with auto-expire
727. Add permission delegation (temporary grant to another user)
728. Add permission audit log with diff history
729. Add permission search by module name
730. Add permission grouping by parent module category
731. Create plans table migration with max_branches, max_users, price, billing_cycle
732. Add plan status enum (active, inactive)
733. Add plan_type enum (free, paid)
734. Add trial_days field
735. Add yearly_discount percentage field
736. Create plan_modules table linking plans to modules
737. Add access_level enum (full, limited, none) per plan_module
738. Implement /api/plans CRUD endpoints
739. Restrict plan CRUD to super_admin only
740. Implement /api/subscription/plans endpoint listing active plans
741. Eager-load modules in subscription/plans response
742. Build Plans admin page for super_admin
743. Build AddPlan form with module access selection
744. Add module access matrix on plan form
745. Add feature comparison table component for plan card display
746. Add plan tier badges (Starter, Basic, Pro, Business, Enterprise)
747. Add plan-card highlight for currently-active plan
748. Add plan usage bars (X/Y branches used)
749. Show plan modules list on PlanView
750. Add bulk module-access change across plans
751. Add plan archival (status=inactive) without deletion
752. Block plan deletion when clients are subscribed
753. Add plan price history tracking
754. Add plan effective-from date for pricing changes
755. Add coupon code system per plan
756. Add per-tenant custom plan support
757. Add plan upgrade preview (what changes after upgrade)
758. Add plan-comparison page for prospects
759. Implement /api/subscription/status endpoint
760. Return current plan, expires_at, usage in status response
761. Implement /api/subscription/create-order endpoint
762. Compute pricing via computePricing based on plan and billing_cycle
763. Create pending Payment row via createPendingPayment helper
764. Generate Razorpay order_id via RazorpayService
765. Auto-activate free plan without Razorpay flow when total ≤ 0
766. Implement /api/subscription/verify-payment endpoint
767. Verify Razorpay signature via verifyPaymentSignature
768. Update payment status=failed when signature mismatches
769. Update payment status=success and call activatePlan on valid signature
770. Activate plan inside DB transaction to prevent partial state
771. Flip client.plan_id, plan_type=paid, status=active, plan_expires_at on activate
772. Reset client_admin permissions before applying new plan modules
773. Grant module permissions per plan_module access_level
774. Run cascadePruneDownstreamPermissions on plan change
775. Run enforceBranchLimit to deactivate excess branches on downgrade
776. Require kept_branch_ids array on downgrade when over new limit
777. Validate kept_branch_ids includes main branch
778. Validate kept_branch_ids count ≤ new plan limit
779. Send PaymentInvoiceMail after activation via InvoiceMailer
780. Implement /api/subscription/cancel-order endpoint
781. Mark pending payment status=failed on cancel
782. Implement /api/razorpay/webhook endpoint (public, signed)
783. Verify Razorpay webhook signature via verifyWebhookSignature
784. Map razorpay order_id to local Payment via order_id lookup
785. Idempotency check on webhook: skip if payment already success/refunded
786. Update payment status=success on payment.captured or order.paid event
787. Activate plan from webhook via activateFromWebhook helper
788. Send PaymentInvoiceMail after webhook activation
789. Update payment status=failed on payment.failed event
790. Log all webhook events for audit
791. Build PlanSelection React page for client_admin
792. Build Razorpay checkout integration on PlanSelection
793. Show plan upgrade modal with pricing breakdown
794. Show plan downgrade modal with kept-branches picker
795. Show plan trial-period countdown
796. Send plan-expiry reminder 7 days before
797. Block branch_user from PlanSelection page
798. Block branch_user access when client plan expired
799. Redirect expired-plan client_admin to /my-plan on every page
800. Create payments table migration with client_id, plan_id, amount, gst, total
801. Add payment status enum (pending, success, failed, refunded)
802. Add payment method enum (upi, credit_card, debit_card, net_banking, wallet, cash, cheque)
803. Add invoice_number column with INV-YYYYMMDD-XXXX format
804. Add invoice_path column for generated PDF
805. Add billing_cycle enum (monthly, quarterly, yearly)
806. Add valid_from and valid_until dates
807. Add auto_renew boolean
808. Add refund_amount, refund_reason, refunded_at columns
809. Add gateway_response JSON column for raw gateway data
810. Add processed_by FK to users
811. Implement /api/payments index with client scoping
812. Implement /api/payments/stats endpoint
813. Implement /api/payments/{id} show endpoint
814. Implement /api/payments store endpoint (super_admin manual)
815. Generate invoice number on payment creation
816. Send PaymentInvoiceMail when manual payment marks status=success
817. Implement /api/payments/{id} update endpoint
818. Implement /api/payments/{id} destroy endpoint
819. Implement /api/payments/{id}/send-reminder endpoint
820. Send PlanReminderMail to client.email + client_admin.email
821. Gate send-reminder by notifications.planExp setting
822. Return 503 when planExp toggle is OFF
823. Return 422 when client.email is missing
824. Build Payments admin page with date-range filter
825. Build payment status pills with color coding
826. Show payment-method icons in list
827. Add payment search by txn_id, invoice_number, client
828. Add payment filter by status, method, gateway, date range
829. Build Razorpay manual-record form for super_admin
830. Add bulk-export payments to CSV
831. Add GST report export for accountants
832. Add invoice ZIP bulk-download
833. Add payment refund workflow with reason
834. Add payment dispute tracking
835. Add payment failure retry button
836. Index payments(created_at) for date-range queries
837. Index payments(client_id, status) for stats queries
838. Create app/Services/InvoiceMailer service class
839. Implement InvoiceMailer::sendForPayment as single entry point
840. Implement InvoiceMailer::ensureInvoicePdf with idempotent generation
841. Use DomPDF Pdf::loadView to render invoices.payment-invoice template
842. Set A4 paper size on generated invoice PDFs
843. Save PDF under storage/app/invoices/{invoice_number}.pdf
844. Persist invoice_path on Payment row after PDF generation
845. Skip PDF regeneration when file already exists
846. Send PaymentInvoiceMail with PDF attachment
847. Build emails/payment-invoice.blade.php template
848. Build invoices/payment-invoice.blade.php PDF template
849. Include client logo from settings in invoice PDF
850. Include client GST and PAN on invoice
851. Include invoice number, date, due date
852. Include line items with amount, GST, total
853. Include payment method and txn_id
854. Add HSN code field on invoice
855. Add company address and seal on invoice
856. Add QR code for payment verification on invoice
857. Send invoice to client.email and client_admin.email
858. Skip duplicate when client.email equals client_admin.email
859. Skip mail when client has no email (log warning)
860. Tolerate PDF generation failure (send mail without attachment)
861. Log invoice generation and mail dispatch events
862. Gate invoice mail by notifications.payAlerts setting
863. Skip invoice mail when payAlerts toggle is OFF
864. Implement /api/payments/{payment}/invoice/download endpoint
865. Implement /api/payments/{payment}/invoice/view endpoint
866. Support sanctum token in URL query for direct browser downloads
867. Authenticate from query token in PaymentController authenticateFromQuery
868. Return 401 for invalid query token
869. Return PDF inline for view endpoint with Content-Type application/pdf
870. Return PDF download for download endpoint
871. Add invoice retention policy (delete > 7 years old)
872. Add invoice email logs table for delivery tracking
873. Add custom invoice numbering per client option
874. Add invoice email retry mechanism on SMTP failure
875. Create migration for masters.Roles table with tenant scoping
876. Implement GET /api/master/Roles list endpoint via MasterController
877. Implement POST /api/master/Roles create endpoint with validation
878. Implement PUT /api/master/Roles/{id} update endpoint
879. Implement DELETE /api/master/Roles/{id} soft-delete endpoint
880. Create migration for masters.Departments table with tenant scoping
881. Implement GET /api/master/Departments list endpoint via MasterController
882. Implement POST /api/master/Departments create endpoint with validation
883. Implement PUT /api/master/Departments/{id} update endpoint
884. Implement DELETE /api/master/Departments/{id} soft-delete endpoint
885. Create migration for masters.Designations table with tenant scoping
886. Implement GET /api/master/Designations list endpoint via MasterController
887. Implement POST /api/master/Designations create endpoint with validation
888. Implement PUT /api/master/Designations/{id} update endpoint
889. Implement DELETE /api/master/Designations/{id} soft-delete endpoint
890. Create migration for masters.Countries table with tenant scoping
891. Implement GET /api/master/Countries list endpoint via MasterController
892. Implement POST /api/master/Countries create endpoint with validation
893. Implement PUT /api/master/Countries/{id} update endpoint
894. Implement DELETE /api/master/Countries/{id} soft-delete endpoint
895. Create migration for masters.States table with tenant scoping
896. Implement GET /api/master/States list endpoint via MasterController
897. Implement POST /api/master/States create endpoint with validation
898. Implement PUT /api/master/States/{id} update endpoint
899. Implement DELETE /api/master/States/{id} soft-delete endpoint
900. Create migration for masters.StateCodes table with tenant scoping
901. Implement GET /api/master/StateCodes list endpoint via MasterController
902. Implement POST /api/master/StateCodes create endpoint with validation
903. Implement PUT /api/master/StateCodes/{id} update endpoint
904. Implement DELETE /api/master/StateCodes/{id} soft-delete endpoint
905. Create migration for masters.Currencies table with tenant scoping
906. Implement GET /api/master/Currencies list endpoint via MasterController
907. Implement POST /api/master/Currencies create endpoint with validation
908. Implement PUT /api/master/Currencies/{id} update endpoint
909. Implement DELETE /api/master/Currencies/{id} soft-delete endpoint
910. Create migration for masters.GstPercentage table with tenant scoping
911. Implement GET /api/master/GstPercentage list endpoint via MasterController
912. Implement POST /api/master/GstPercentage create endpoint with validation
913. Implement PUT /api/master/GstPercentage/{id} update endpoint
914. Implement DELETE /api/master/GstPercentage/{id} soft-delete endpoint
915. Create migration for masters.HsnCodes table with tenant scoping
916. Implement GET /api/master/HsnCodes list endpoint via MasterController
917. Implement POST /api/master/HsnCodes create endpoint with validation
918. Implement PUT /api/master/HsnCodes/{id} update endpoint
919. Implement DELETE /api/master/HsnCodes/{id} soft-delete endpoint
920. Create migration for masters.AssetCategories table with tenant scoping
921. Implement GET /api/master/AssetCategories list endpoint via MasterController
922. Implement POST /api/master/AssetCategories create endpoint with validation
923. Implement PUT /api/master/AssetCategories/{id} update endpoint
924. Implement DELETE /api/master/AssetCategories/{id} soft-delete endpoint
925. Create migration for masters.Assets table with tenant scoping
926. Implement GET /api/master/Assets list endpoint via MasterController
927. Implement POST /api/master/Assets create endpoint with validation
928. Implement PUT /api/master/Assets/{id} update endpoint
929. Implement DELETE /api/master/Assets/{id} soft-delete endpoint
930. Create migration for masters.BankAccounts table with tenant scoping
931. Implement GET /api/master/BankAccounts list endpoint via MasterController
932. Implement POST /api/master/BankAccounts create endpoint with validation
933. Implement PUT /api/master/BankAccounts/{id} update endpoint
934. Implement DELETE /api/master/BankAccounts/{id} soft-delete endpoint
935. Create migration for masters.LegalEntities table with tenant scoping
936. Implement GET /api/master/LegalEntities list endpoint via MasterController
937. Implement POST /api/master/LegalEntities create endpoint with validation
938. Implement PUT /api/master/LegalEntities/{id} update endpoint
939. Implement DELETE /api/master/LegalEntities/{id} soft-delete endpoint
940. Create migration for masters.PaymentTerms table with tenant scoping
941. Implement GET /api/master/PaymentTerms list endpoint via MasterController
942. Implement POST /api/master/PaymentTerms create endpoint with validation
943. Implement PUT /api/master/PaymentTerms/{id} update endpoint
944. Implement DELETE /api/master/PaymentTerms/{id} soft-delete endpoint
945. Create migration for masters.Incoterms table with tenant scoping
946. Implement GET /api/master/Incoterms list endpoint via MasterController
947. Implement POST /api/master/Incoterms create endpoint with validation
948. Implement PUT /api/master/Incoterms/{id} update endpoint
949. Implement DELETE /api/master/Incoterms/{id} soft-delete endpoint
950. Create migration for masters.PortOfLoading table with tenant scoping
951. Implement GET /api/master/PortOfLoading list endpoint via MasterController
952. Implement POST /api/master/PortOfLoading create endpoint with validation
953. Implement PUT /api/master/PortOfLoading/{id} update endpoint
954. Implement DELETE /api/master/PortOfLoading/{id} soft-delete endpoint
955. Create migration for masters.PortOfDischarge table with tenant scoping
956. Implement GET /api/master/PortOfDischarge list endpoint via MasterController
957. Implement POST /api/master/PortOfDischarge create endpoint with validation
958. Implement PUT /api/master/PortOfDischarge/{id} update endpoint
959. Implement DELETE /api/master/PortOfDischarge/{id} soft-delete endpoint
960. Create migration for masters.ProcurementCategory table with tenant scoping
961. Implement GET /api/master/ProcurementCategory list endpoint via MasterController
962. Implement POST /api/master/ProcurementCategory create endpoint with validation
963. Implement PUT /api/master/ProcurementCategory/{id} update endpoint
964. Implement DELETE /api/master/ProcurementCategory/{id} soft-delete endpoint
965. Create migration for masters.RackTypeMaster table with tenant scoping
966. Implement GET /api/master/RackTypeMaster list endpoint via MasterController
967. Implement POST /api/master/RackTypeMaster create endpoint with validation
968. Implement PUT /api/master/RackTypeMaster/{id} update endpoint
969. Implement DELETE /api/master/RackTypeMaster/{id} soft-delete endpoint
970. Create migration for masters.Racks table with tenant scoping
971. Implement GET /api/master/Racks list endpoint via MasterController
972. Implement POST /api/master/Racks create endpoint with validation
973. Implement PUT /api/master/Racks/{id} update endpoint
974. Implement DELETE /api/master/Racks/{id} soft-delete endpoint
975. Create migration for masters.ShelfMaster table with tenant scoping
976. Implement GET /api/master/ShelfMaster list endpoint via MasterController
977. Implement POST /api/master/ShelfMaster create endpoint with validation
978. Implement PUT /api/master/ShelfMaster/{id} update endpoint
979. Implement DELETE /api/master/ShelfMaster/{id} soft-delete endpoint
980. Create migration for masters.WarehouseMaster table with tenant scoping
981. Implement GET /api/master/WarehouseMaster list endpoint via MasterController
982. Implement POST /api/master/WarehouseMaster create endpoint with validation
983. Implement PUT /api/master/WarehouseMaster/{id} update endpoint
984. Implement DELETE /api/master/WarehouseMaster/{id} soft-delete endpoint
985. Create migration for masters.ZoneMaster table with tenant scoping
986. Implement GET /api/master/ZoneMaster list endpoint via MasterController
987. Implement POST /api/master/ZoneMaster create endpoint with validation
988. Implement PUT /api/master/ZoneMaster/{id} update endpoint
989. Implement DELETE /api/master/ZoneMaster/{id} soft-delete endpoint
990. Create migration for masters.TempClassMaster table with tenant scoping
991. Implement GET /api/master/TempClassMaster list endpoint via MasterController
992. Implement POST /api/master/TempClassMaster create endpoint with validation
993. Implement PUT /api/master/TempClassMaster/{id} update endpoint
994. Implement DELETE /api/master/TempClassMaster/{id} soft-delete endpoint
995. Create migration for masters.RiskLevels table with tenant scoping
996. Implement GET /api/master/RiskLevels list endpoint via MasterController
997. Implement POST /api/master/RiskLevels create endpoint with validation
998. Implement PUT /api/master/RiskLevels/{id} update endpoint
999. Implement DELETE /api/master/RiskLevels/{id} soft-delete endpoint
1000. Create migration for masters.Segments table with tenant scoping
1001. Implement GET /api/master/Segments list endpoint via MasterController
1002. Implement POST /api/master/Segments create endpoint with validation
1003. Implement PUT /api/master/Segments/{id} update endpoint
1004. Implement DELETE /api/master/Segments/{id} soft-delete endpoint
1005. Create migration for masters.SourcingType table with tenant scoping
1006. Implement GET /api/master/SourcingType list endpoint via MasterController
1007. Implement POST /api/master/SourcingType create endpoint with validation
1008. Implement PUT /api/master/SourcingType/{id} update endpoint
1009. Implement DELETE /api/master/SourcingType/{id} soft-delete endpoint
1010. Create migration for masters.VendorTypes table with tenant scoping
1011. Implement GET /api/master/VendorTypes list endpoint via MasterController
1012. Implement POST /api/master/VendorTypes create endpoint with validation
1013. Implement PUT /api/master/VendorTypes/{id} update endpoint
1014. Implement DELETE /api/master/VendorTypes/{id} soft-delete endpoint
1015. Create migration for masters.VendorBehaviour table with tenant scoping
1016. Implement GET /api/master/VendorBehaviour list endpoint via MasterController
1017. Implement POST /api/master/VendorBehaviour create endpoint with validation
1018. Implement PUT /api/master/VendorBehaviour/{id} update endpoint
1019. Implement DELETE /api/master/VendorBehaviour/{id} soft-delete endpoint
1020. Create migration for masters.VendorDirectory table with tenant scoping
1021. Implement GET /api/master/VendorDirectory list endpoint via MasterController
1022. Implement POST /api/master/VendorDirectory create endpoint with validation
1023. Implement PUT /api/master/VendorDirectory/{id} update endpoint
1024. Implement DELETE /api/master/VendorDirectory/{id} soft-delete endpoint
1025. Create migration for masters.CustomerTypes table with tenant scoping
1026. Implement GET /api/master/CustomerTypes list endpoint via MasterController
1027. Implement POST /api/master/CustomerTypes create endpoint with validation
1028. Implement PUT /api/master/CustomerTypes/{id} update endpoint
1029. Implement DELETE /api/master/CustomerTypes/{id} soft-delete endpoint
1030. Create migration for masters.CustomerClassifications table with tenant scoping
1031. Implement GET /api/master/CustomerClassifications list endpoint via MasterController
1032. Implement POST /api/master/CustomerClassifications create endpoint with validation
1033. Implement PUT /api/master/CustomerClassifications/{id} update endpoint
1034. Implement DELETE /api/master/CustomerClassifications/{id} soft-delete endpoint
1035. Create migration for masters.PackagingMaterial table with tenant scoping
1036. Implement GET /api/master/PackagingMaterial list endpoint via MasterController
1037. Implement POST /api/master/PackagingMaterial create endpoint with validation
1038. Implement PUT /api/master/PackagingMaterial/{id} update endpoint
1039. Implement DELETE /api/master/PackagingMaterial/{id} soft-delete endpoint
1040. Create migration for masters.HazClass table with tenant scoping
1041. Implement GET /api/master/HazClass list endpoint via MasterController
1042. Implement POST /api/master/HazClass create endpoint with validation
1043. Implement PUT /api/master/HazClass/{id} update endpoint
1044. Implement DELETE /api/master/HazClass/{id} soft-delete endpoint
1045. Create migration for masters.LicenseName table with tenant scoping
1046. Implement GET /api/master/LicenseName list endpoint via MasterController
1047. Implement POST /api/master/LicenseName create endpoint with validation
1048. Implement PUT /api/master/LicenseName/{id} update endpoint
1049. Implement DELETE /api/master/LicenseName/{id} soft-delete endpoint
1050. Create migration for masters.KPIs table with tenant scoping
1051. Implement GET /api/master/KPIs list endpoint via MasterController
1052. Implement POST /api/master/KPIs create endpoint with validation
1053. Implement PUT /api/master/KPIs/{id} update endpoint
1054. Implement DELETE /api/master/KPIs/{id} soft-delete endpoint
1055. Create migration for masters.DigitalTwin table with tenant scoping
1056. Implement GET /api/master/DigitalTwin list endpoint via MasterController
1057. Implement POST /api/master/DigitalTwin create endpoint with validation
1058. Implement PUT /api/master/DigitalTwin/{id} update endpoint
1059. Implement DELETE /api/master/DigitalTwin/{id} soft-delete endpoint
1060. Create migration for masters.DocumentType table with tenant scoping
1061. Implement GET /api/master/DocumentType list endpoint via MasterController
1062. Implement POST /api/master/DocumentType create endpoint with validation
1063. Implement PUT /api/master/DocumentType/{id} update endpoint
1064. Implement DELETE /api/master/DocumentType/{id} soft-delete endpoint
1065. Create migration for masters.Uom table with tenant scoping
1066. Implement GET /api/master/Uom list endpoint via MasterController
1067. Implement POST /api/master/Uom create endpoint with validation
1068. Implement PUT /api/master/Uom/{id} update endpoint
1069. Implement DELETE /api/master/Uom/{id} soft-delete endpoint
1070. Create migration for masters.Freezers table with tenant scoping
1071. Implement GET /api/master/Freezers list endpoint via MasterController
1072. Implement POST /api/master/Freezers create endpoint with validation
1073. Implement PUT /api/master/Freezers/{id} update endpoint
1074. Implement DELETE /api/master/Freezers/{id} soft-delete endpoint
1075. Create migration for masters.ExpenseCategories table with tenant scoping
1076. Implement GET /api/master/ExpenseCategories list endpoint via MasterController
1077. Implement POST /api/master/ExpenseCategories create endpoint with validation
1078. Implement PUT /api/master/ExpenseCategories/{id} update endpoint
1079. Implement DELETE /api/master/ExpenseCategories/{id} soft-delete endpoint
1080. Create migration for masters.Conditions table with tenant scoping
1081. Implement GET /api/master/Conditions list endpoint via MasterController
1082. Implement POST /api/master/Conditions create endpoint with validation
1083. Implement PUT /api/master/Conditions/{id} update endpoint
1084. Implement DELETE /api/master/Conditions/{id} soft-delete endpoint
1085. Create migration for masters.DeviationReason table with tenant scoping
1086. Implement GET /api/master/DeviationReason list endpoint via MasterController
1087. Implement POST /api/master/DeviationReason create endpoint with validation
1088. Implement PUT /api/master/DeviationReason/{id} update endpoint
1089. Implement DELETE /api/master/DeviationReason/{id} soft-delete endpoint
1090. Create migration for masters.MatchException table with tenant scoping
1091. Implement GET /api/master/MatchException list endpoint via MasterController
1092. Implement POST /api/master/MatchException create endpoint with validation
1093. Implement PUT /api/master/MatchException/{id} update endpoint
1094. Implement DELETE /api/master/MatchException/{id} soft-delete endpoint
1095. Create migration for masters.GoodsServiceFlag table with tenant scoping
1096. Implement GET /api/master/GoodsServiceFlag list endpoint via MasterController
1097. Implement POST /api/master/GoodsServiceFlag create endpoint with validation
1098. Implement PUT /api/master/GoodsServiceFlag/{id} update endpoint
1099. Implement DELETE /api/master/GoodsServiceFlag/{id} soft-delete endpoint
1100. Create migration for masters.ComplianceBehaviours table with tenant scoping
1101. Implement GET /api/master/ComplianceBehaviours list endpoint via MasterController
1102. Implement POST /api/master/ComplianceBehaviours create endpoint with validation
1103. Implement PUT /api/master/ComplianceBehaviours/{id} update endpoint
1104. Implement DELETE /api/master/ComplianceBehaviours/{id} soft-delete endpoint
1105. Create migration for masters.ApplicableTypes table with tenant scoping
1106. Implement GET /api/master/ApplicableTypes list endpoint via MasterController
1107. Implement POST /api/master/ApplicableTypes create endpoint with validation
1108. Implement PUT /api/master/ApplicableTypes/{id} update endpoint
1109. Implement DELETE /api/master/ApplicableTypes/{id} soft-delete endpoint
1110. Create migration for masters.ApprovalAuthority table with tenant scoping
1111. Implement GET /api/master/ApprovalAuthority list endpoint via MasterController
1112. Implement POST /api/master/ApprovalAuthority create endpoint with validation
1113. Implement PUT /api/master/ApprovalAuthority/{id} update endpoint
1114. Implement DELETE /api/master/ApprovalAuthority/{id} soft-delete endpoint
1115. Create migration for masters.AdvancePaymentRules table with tenant scoping
1116. Implement GET /api/master/AdvancePaymentRules list endpoint via MasterController
1117. Implement POST /api/master/AdvancePaymentRules create endpoint with validation
1118. Implement PUT /api/master/AdvancePaymentRules/{id} update endpoint
1119. Implement DELETE /api/master/AdvancePaymentRules/{id} soft-delete endpoint
1120. Create migration for masters.AddressTypes table with tenant scoping
1121. Implement GET /api/master/AddressTypes list endpoint via MasterController
1122. Implement POST /api/master/AddressTypes create endpoint with validation
1123. Implement PUT /api/master/AddressTypes/{id} update endpoint
1124. Implement DELETE /api/master/AddressTypes/{id} soft-delete endpoint
1125. Create migration for masters.LegalEntityBank table with tenant scoping
1126. Implement GET /api/master/LegalEntityBank list endpoint via MasterController
1127. Implement POST /api/master/LegalEntityBank create endpoint with validation
1128. Implement PUT /api/master/LegalEntityBank/{id} update endpoint
1129. Implement DELETE /api/master/LegalEntityBank/{id} soft-delete endpoint
1130. Build MasterController generic slug router for 50+ master tables
1131. Implement MasterController applyScope with branch_id narrowing
1132. Implement MasterController resolveOwnership for stamping new rows
1133. Implement MasterController next-code generator per master slug
1134. Add master_module permission gate per slug
1135. Add hierarchical edit rule (lower-rank cannot edit higher-rank rows)
1136. Add hierarchical delete rule per role rank
1137. Skip parent modules in permission save (only leafs)
1138. Add MasterPage React page with generic CRUD UI
1139. Add MasterDashboard listing all 50+ masters with counts
1140. Build masterFormKit shared components (MasterSelect, MasterMultiSelect, MasterDatePicker)
1141. Build masterConfigs.ts with schemas per slug
1142. Add inline search filter on every master list
1143. Add bulk-delete confirmation modal
1144. Add bulk-export per master table to CSV
1145. Add bulk-import per master table from CSV
1146. Add master data versioning to track changes
1147. Add master.is_system flag for super-admin-seeded rows
1148. Block edit of is_system master rows by non-super_admin
1149. Create platform_settings table migration with section + JSON value
1150. Seed default settings for general, security, notifications, appearance, privacy, help, contact
1151. Build PlatformSetting model with getSection and setSection helpers
1152. Build SettingsController with index, update, uploadAsset endpoints
1153. Restrict PUT /api/settings/{section} to super_admin via 403
1154. Allow GET /api/settings for any authenticated user
1155. Implement per-section validation rules array in SettingsController
1156. Validate general.platform_name as required string
1157. Validate general support_email and admin_email as email format
1158. Validate general website_url as URL format
1159. Validate appearance.primary_color and secondary_color as hex regex
1160. Validate privacy.privacy_policy_url as URL format
1161. Validate help.faqs as array of {q,a} objects
1162. Preserve appearance.logo_path on update when not provided
1163. Preserve appearance.favicon_path on update when not provided
1164. Implement uploadAsset endpoint for logo and favicon upload
1165. Restrict uploadAsset to super_admin
1166. Validate uploaded asset file type and 2MB size limit
1167. Save uploaded assets under storage/app/public/platform/
1168. Delete old asset file when replacing logo or favicon
1169. Build app/Support/Settings facade for clean toggle reads
1170. Implement Settings::is and Settings::section static methods
1171. Implement Settings::shouldSendMail with master + category gating
1172. Cache settings for 60 seconds via Cache::remember
1173. Bust Settings cache on every save via Settings::bust
1174. Wire SettingsContext on frontend to load /api/settings on user login
1175. Skip /settings fetch when no token present to avoid pre-login 401 loop
1176. Refresh SettingsContext on user.id change to pick up post-login data
1177. Cache settings client-side in localStorage as cbc_platform_settings_v1
1178. Apply document.title = settings.general.platform_name as side effect
1179. Apply favicon swap from settings.appearance.favicon_path
1180. Apply CSS root vars from settings.appearance.primary_color and secondary_color
1181. Build Settings.tsx React page with 8 tabs
1182. Build General tab with platform info and contact info forms
1183. Build Security tab with 6 toggle switches
1184. Build Notifications tab with channels and alerts sections
1185. Build Appearance tab with color pickers and asset uploads
1186. Build Privacy tab with data handling and compliance toggles
1187. Build About tab as read-only display with platform stats
1188. Build Help & FAQs tab with add/edit/delete FAQ list
1189. Build Contact Us tab with editable contact fields
1190. Show read-only banner for non-super_admin users
1191. Disable Save buttons for non-super_admin with tooltip
1192. Refresh global SettingsContext after each save
1193. Show saving spinner on Save button during PUT
1194. Show success toast after save
1195. Show error toast with validation messages on failure
1196. Build CookieBanner component gated by privacy.cookie setting
1197. Persist cookie-accept in localStorage cbc_cookies_accepted_v1
1198. Link Privacy Policy URL from cookie banner
1199. Build IdleTimeout component gated by security.sessTimeout
1200. Set IdleTimeout to 5 hours of inactivity
1201. Reset idle timer on mouse/keyboard/touch/scroll events
1202. Wire login page wordmark to settings.general.platform_name
1203. Split platform name into 3 words for stylized wordmark rendering
1204. Apply weight contrast (thin/medium/bold-italic-gradient) per word
1205. Build cbc-wordmark CSS with shimmer + underline animation
1206. Wire WebSocket push toggle to pushNotif setting (future feature)
1207. Add settings audit log (who changed what when)
1208. Build /api/dashboard/admin-stats endpoint for super_admin
1209. Build /api/dashboard/client-stats endpoint for client_admin
1210. Return counts: total_clients, active_clients, inactive_clients in admin stats
1211. Return total_users, total_branches, total_payments in admin stats
1212. Return success_payments, pending_payments, failed_payments counts
1213. Return revenue total and monthly breakdown
1214. Return plan_breakdown counts per plan
1215. Return revenue_trend last 12 months series
1216. Return client_growth last 12 months series
1217. Return user_types breakdown
1218. Return org_types counts
1219. Return recent_clients and recent_payments lists
1220. Return top_clients by revenue
1221. Build AdminDashboard React page with KPI cards
1222. Build KpiCard reusable component with icon, value, trend
1223. Format INR values via formatINRCompact (98,500 → 98K, 1.52L, 1.50Cr)
1224. Animate counter via AnimatedNumber component
1225. Build revenue trend area chart with Recharts
1226. Build plan distribution pie chart with Recharts
1227. Build recent activity timeline
1228. Build top clients leaderboard
1229. Build ClientDashboard for client_admin with own client metrics
1230. Build BranchDashboard for branch_user with own branch metrics
1231. Apply branch_id filter to BranchDashboard fetches
1232. Show "All Branches" overview when main-branch user has no specific selection
1233. Add date-range selector on all dashboards
1234. Add real-time KPI refresh on focus
1235. Cache dashboard responses for 60s to reduce DB load
1236. Add WebSocket support for real-time KPI updates (future)
1237. Build dashboard export to PDF
1238. Build customisable dashboard widgets (drag/drop)
1239. Add dashboard mobile-responsive layout
1240. Add dashboard tooltip with metric definition on hover
1241. Show dashboard loading skeleton during initial fetch
1242. Configure smtp mailer in config/mail.php
1243. Set MAIL_HOST to smtp.gmail.com in .env
1244. Set MAIL_PORT to 587 with STARTTLS
1245. Set MAIL_FROM_ADDRESS to platform sender
1246. Set MAIL_FROM_NAME to Cross Border Command
1247. Build WelcomeCredentialsMail mailable
1248. Build emails/welcome-credentials.blade.php template
1249. Build OnboardingInviteMail mailable
1250. Build emails/onboarding-invite.blade.php template
1251. Build PasswordResetOtpMail mailable
1252. Build emails/password-reset-otp.blade.php template
1253. Build PasswordChangedMail mailable
1254. Build emails/password-changed.blade.php template
1255. Build PaymentInvoiceMail mailable with PDF attachment
1256. Build emails/payment-invoice.blade.php template
1257. Build PlanReminderMail mailable
1258. Build emails/plan-reminder.blade.php template
1259. Build HiringRequestCreatedMail mailable
1260. Build emails/hiring-request-created.blade.php template
1261. Use Velzon-styled HTML tables for cross-client compatibility
1262. Inline-style all email templates (no external CSS)
1263. Use SVG-free icons via emoji or PNG fallbacks
1264. Test email rendering in Gmail web, Gmail mobile, Outlook
1265. Add unsubscribe footer link to non-transactional mails
1266. Move all mailables to queue (implements ShouldQueue)
1267. Configure database queue driver
1268. Run php artisan queue:work as production service
1269. Add Supervisor config for queue worker
1270. Add Retry policy with backoff for SMTP failures
1271. Add bounce handling — auto-disable email on permanent bounce
1272. Build mail delivery dashboard for super_admin
1273. Show last 100 mail attempts with status
1274. Add mail-failure alert to ops team
1275. Add per-mailable disable toggle in Settings → Notifications
1276. Add weekly digest cadence for low-priority emails
1277. Localize email templates (multi-language)
1278. Configure SPF record for sending domain
1279. Configure DKIM signing for sending domain
1280. Configure DMARC policy for sending domain
1281. Add reply-to address per mailable type
1282. Add Apple-mail dark-mode media query in templates
1283. Add Outlook-specific conditional styles
1284. Add per-template plain-text fallback for accessibility
1285. Strip plaintext-password references from logs
1286. Encrypt mail logs at rest
1287. Add mail attachment scanner before send
1288. Add mail rate-limiter to prevent spam-trigger from misconfig
1289. Add mail preview endpoint for super_admin to inspect templates
1290. Setup Vite + React 19 + TypeScript build pipeline
1291. Configure Tailwind CSS in tailwind.config.js
1292. Configure Velzon theme variables
1293. Build AuthContext with login, logout, refresh
1294. Build ThemeContext for light/dark toggle
1295. Build VariantContext for layout variants
1296. Build ToastContext with success/error/info toasts
1297. Build LayoutContext for sidebar collapse
1298. Build BranchSwitcherContext with per-user persistence
1299. Build SettingsContext with platform settings cache
1300. Build NavigateContext for consistent navigation across pages
1301. Build CookieBanner component
1302. Build IdleTimeout component
1303. Build SplashLoader component shown on first login
1304. Build VelzonShell layout wrapper
1305. Build HorizontalLayout with mega-menu support
1306. Build VerticalLayout sidebar with collapse
1307. Build ProfileDropdown in topbar
1308. Gate "My Plan" link to client_admin only
1309. Build BranchSwitcher dropdown in topbar
1310. Build GlobalSearch component
1311. Build Avatar component with initials fallback
1312. Build ThemeCustomizer panel
1313. Build SearchableSelect component
1314. Build MasterSelect, MasterMultiSelect, MasterDatePicker
1315. Build MasterFormStyles shared style component
1316. Build Tooltip component with delay and arrow
1317. Build Shimmer skeleton loading component
1318. Build Button component with variants
1319. Build Input component with error state
1320. Build ActionBtn icon-pill component for table rows
1321. Build Modal wrapper using reactstrap
1322. Build form validation via per-page validate functions
1323. Build axios instance with bearer token interceptor
1324. Build axios 401 response interceptor with /me tolerance
1325. Build axios branch_id auto-injection
1326. Skip /branches and /me URLs in branch_id interceptor
1327. Build BrowserRouter with nested Routes
1328. Add /onboarding/{token} public route bypass
1329. Add Splash + auth + dashboard route trees
1330. Add Wrapper components for URL-param extraction
1331. Build SidebarMenu from constants.ts menu items
1332. Filter sidebar items by user.user_type role array
1333. Filter sidebar items by user.permissions slugs
1334. Build navigateFn with plan-expired redirect logic
1335. Block expired-plan branch_user from non-default pages
1336. Redirect expired-plan client_admin to /my-plan
1337. Add plan-blocked page for branch_user during plan expiry
1338. Build PublicOnboarding page for public token route
1339. Wire FEATURE_FLAGS constant to gate hrAttendance route
1340. Set up @vite directive in welcome.blade.php
1341. Configure CSRF cookie for SPA routes
1342. Configure Sanctum stateful domains for SPA
1343. Add custom 404 page with back-to-dashboard
1344. Add custom 500 page with reload action
1345. Add maintenance page during deploys
1346. Audit all controllers for OWASP Top 10 vulnerabilities
1347. Audit SQL injection on every where(...) clause
1348. Audit XSS sanitisation on every user-facing form
1349. Audit CSRF token verification across endpoints
1350. Audit file upload magic-byte checks (not just extension)
1351. Rate limit /api/login, /api/forgot-password endpoints
1352. Add Content-Security-Policy header on responses
1353. Add HSTS header with 1-year max-age
1354. Add X-Frame-Options: DENY header
1355. Add Subresource Integrity for third-party JS
1356. Sanitize uploaded filenames before storage
1357. Strip EXIF metadata from uploaded images
1358. Audit SoftDelete restores for permission checks
1359. Rate limit /api/forgot-password to prevent enumeration
1360. Use generic auth error messages (no user-exists leak)
1361. Document secrets rotation policy
1362. Document Sanctum token TTL recommendation
1363. Document audit log retention policy
1364. Penetration test by external firm
1365. SOC 2 / ISO 27001 preparation checklist
1366. Run OWASP ZAP automated scan in CI
1367. Document security incident response playbook
1368. Add password breach check via HaveIBeenPwned API
1369. Add MFA enforcement for super_admin
1370. Add IP-based geolocation alert for unusual logins
1371. Add session pinning to prevent token theft
1372. Add device fingerprinting for anomaly detection
1373. Add brute-force lockout per IP, not just per email
1374. Add API key support for service-to-service auth
1375. Add encryption-at-rest for sensitive columns
1376. Add field-level encryption for GST/PAN
1377. Audit storage permissions for uploaded files
1378. Prevent path traversal in download endpoints
1379. Validate query param token format before DB hit
1380. Add request signing for webhook callbacks
1381. Audit all routes for proper auth middleware
1382. Audit cross-tenant data access on every endpoint
1383. Add per-tenant rate limits to prevent abuse
1384. Add anomaly detection on unusual API usage patterns
1385. Add database indexes on employees(client_id, branch_id)
1386. Add database index on payments(status, valid_until)
1387. Add database index on permissions(user_id, module_id)
1388. Add database index on platform_settings(section)
1389. Eager-load relations in EmployeeController index (prevent N+1)
1390. Eager-load relations in CandidateController index
1391. Eager-load relations in RecruitmentController index
1392. Move PaymentInvoiceMail to queue to avoid 20s blocking
1393. Move WelcomeCredentialsMail to queue
1394. Move PasswordChangedMail to queue
1395. Move OnboardingInviteMail to queue
1396. Reduce DomPDF memory footprint per render
1397. Compress responses with gzip middleware
1398. Add Redis cache for hot reads (modules, masters)
1399. Add CDN for static assets
1400. Add image lazy-loading in employee directory
1401. Code-split React routes for faster initial bundle
1402. Add bundle-size budget enforcement (<500KB initial JS)
1403. Run load test: 1000 concurrent users
1404. Run load test: 100 concurrent logins
1405. Build CI pipeline with PHPUnit + ESLint + tsc
1406. Build CD pipeline to staging environment
1407. Set up daily database backup automation
1408. Test database point-in-time restore
1409. Document disaster recovery runbook
1410. Set up Sentry / NewRelic for monitoring
1411. Set up centralised log aggregation (ELK / Loki)
1412. Add /up health-check endpoint for load balancer
1413. Automate SSL certificate renewal
1414. Build Docker development environment
1415. Configure Supervisor for production queue worker
1416. Configure systemd timers for production cron
1417. Implement blue-green deployment
1418. Implement feature flag system
1419. Build A/B testing infrastructure
1420. Reduce Composer install time via caching
1421. Enable Vite build caching
1422. Reduce Docker image size with multi-stage build
1423. Document server hardening checklist
1424. Implement secrets management via Vault
1425. Document deployment runbook
1426. Document environment variable reference
1427. Set up PHPUnit test suite with database transactions
1428. Set up Laravel TestCase base with authentication helper
1429. Set up Vitest for frontend unit tests
1430. Set up Playwright for E2E tests
1431. Write feature test for /api/login happy path
1432. Write feature test for /api/login with wrong password
1433. Write feature test for inactive user blocked at login
1434. Write feature test for brute-force lockout after 5 failures
1435. Write feature test for OTP send → verify → reset chain
1436. Write feature test for change-password with reuse blocking
1437. Write feature test for ClientController CRUD
1438. Write feature test for BranchController CRUD with plan limits
1439. Write feature test for EmployeeController multi-ancillary roles
1440. Write feature test for HiringRequestController manager email
1441. Write feature test for InvoiceMailer all 3 paths
1442. Write feature test for branch_id filter on every list endpoint
1443. Write feature test for cross-tenant branch_id ignored
1444. Write feature test for SettingsController per-section validation
1445. Write feature test for permissions cascade-clear on plan downgrade
1446. Write feature test for Razorpay webhook idempotency
1447. Write E2E test for client onboarding wizard
1448. Write E2E test for branch creation within plan limit
1449. Write E2E test for employee onboarding token flow
1450. Write E2E test for HR creates hiring request → manager mail
1451. Write E2E test for customer pays plan → invoice mail received
1452. Write E2E test for forgot-password full flow
1453. Write E2E test for branch switcher data refilter
1454. Write E2E test for super_admin settings save and reload
1455. Write E2E test for cookie banner accept persistence
1456. Write E2E test for idle-timeout auto-logout
1457. Write E2E test for ProfileDropdown role gating
1458. Add visual regression tests via Percy or Chromatic
1459. Add cross-browser tests for Chrome, Firefox, Safari, Edge
1460. Add mobile tests for iOS Safari and Chrome Android
1461. Add accessibility tests via axe-core
1462. Add Lighthouse CI for performance budgets
1463. Add CSV import edge-case tests (malformed rows, BOM, encoding)
1464. Add file-upload limit tests
1465. Add concurrent-request race-condition tests
1466. Add load tests with k6
1467. Add Razorpay test-mode toggle in Settings → Privacy
1468. Add staging-vs-production banner on frontend
1469. Build admin notes panel on every model edit page
1470. Add bulk-archive UI on Recruitment list
1471. Add bulk-reactivate UI on disabled employees
1472. Add per-role landing page redirect after login
1473. Add audit log filter by user, action, entity
1474. Build admin user impersonation flow for support cases
1475. Add audit trail for impersonation events
1476. Build per-tenant data-export request workflow (GDPR)
1477. Build per-tenant data-deletion request workflow
1478. Add session list page with per-device revoke button
1479. Add device-name labelling on Sanctum tokens
1480. Add user.preferences JSON column for UI persistence
1481. Build dark-mode default propagation from settings.appearance.dark_default
1482. Add per-user notification preferences page
1483. Build in-app notification center (bell icon)
1484. Persist notification reads per user
1485. Add Telegram/Slack webhook notifications option
1486. Add SMS notification adapter (Twilio)
1487. Add WhatsApp Business API integration for candidate communication
1488. Add API rate-limit headers in responses
1489. Add OpenAPI/Swagger documentation generation
1490. Build Postman collection from OpenAPI
1491. Build API key management for service-to-service auth
1492. Add API usage analytics per tenant
1493. Add API quota and throttling per plan tier
1494. Build webhook subscription system per tenant
1495. Add webhook signature secret rotation
1496. Add webhook delivery retry policy with backoff
1497. Build webhook delivery log per tenant
1498. Build SCIM provisioning endpoint (enterprise)
1499. Build SAML SSO integration (enterprise)
1500. Build OAuth2 provider endpoints
1501. Add tenant-level white-label branding (full domain support)
1502. Build per-tenant subdomain routing
1503. Build per-tenant custom domain support with SSL
1504. Add data residency selection per tenant
1505. Add per-tenant backup schedule configuration
1506. Add per-tenant retention policy override
1507. Build audit log compliance export (SOC 2 ready)
1508. Add Single Sign-On for Azure AD
1509. Add Single Sign-On for Google Workspace
1510. Add SCIM auto-provisioning from external IdP
1511. Build Help Center inline article system
1512. Build tooltips on every form field for self-service help
1513. Add changelog page accessible from settings menu
1514. Build platform status indicator (operational / degraded)
1515. Add A/B test infrastructure for feature rollouts
1516. Build feature-flag toggle UI for super_admin
1517. Add per-tenant feature-flag overrides
1518. Build usage-based billing add-on (per-seat overage)
