<?php

/*
|--------------------------------------------------------------------------
| Email uniqueness
|--------------------------------------------------------------------------
|
| ONE file decides where an email address has to be unique. Nothing else in
| the app needs to know the rules — models pick them up through the
| EnforcesUniqueEmail trait, and forms report them through the
| UniqueSystemEmail rule.
|
| WHY THIS IS NOT "unique across every table"
| -------------------------------------------
| 29 tables hold an email address, but most of those columns are COPIES of
| one identity, not separate identities:
|
|   · customers.primary_email is written to customer_addresses.cp_email in
|     the same save — one customer, two rows;
|   · ConsigneeKycMirror deliberately clones a customer's contact details
|     onto its consignee;
|   · an employee's address IS their users.email — that pairing is the login;
|   · email_logs records every message ever sent, so every address in the
|     system appears in it by definition;
|   · leads arrive from IndiaMart, where the same buyer really does send
|     several enquiries.
|
| Refusing a duplicate across all of those would make it impossible to
| create a customer, clone a consignee, or onboard an employee. So the rule
| is: unique per IDENTITY, and a scope below is one identity.
|
| HOW TO USE IT
| -------------
|   · Two entity types that must not share an address go in the SAME scope.
|   · Types that may legitimately share one (a customer who is also a
|     vendor) go in different scopes.
| That is the only knob. Adding a table to a scope is one line here; no
| controller or model changes.
|
| tenant => true means "unique within the client", which is what the existing
| users_email_client_unique index already enforces: the same person can hold
| an account at two different client organisations, and login disambiguates
| by org. Setting it false would make the address unique across every tenant.
|
*/

return [

    /*
     | Addresses that never participate — they are records OF email, or
     | transient, and must never block a save. Listed for the reader; the
     | guard only ever looks at the sources below.
     |
     |   email_logs, password_reset_otps, password_reset_tokens,
     |   *_addresses / *_owners (child copies of their parent),
     |   leads, master_* (lookups), ctc_contracts (approver copies)
     */

    'scopes' => [

        /*
         | LOGIN — the address someone signs in with.
         | users.email already carries a partial unique index per client;
         | this makes the same rule visible to the UI so the user gets
         | "already used" instead of a 500 from the database.
         */
        'login' => [
            'label'   => 'another user account',
            'tenant'  => true,
            'sources' => [
                ['table' => 'users', 'column' => 'email', 'soft_deletes' => true, 'where' => ['email_active' => true]],
            ],
        ],

        /*
         | EMPLOYEE — two employees in a client cannot share an address.
         | Both columns are listed, so a personal address cannot be reused as
         | someone else's official one. The row being saved is always excluded
         | from its own check, so one employee holding the same value in both
         | columns is fine.
         */
        'employee' => [
            'label'   => 'another employee',
            'tenant'  => true,
            'sources' => [
                ['table' => 'employees', 'column' => 'email',          'soft_deletes' => true],
                ['table' => 'employees', 'column' => 'official_email', 'soft_deletes' => true],
            ],
        ],

        /*
         | CANDIDATE — a recruitment pipeline identity. Kept with the
         | onboarding invite so the same person cannot be invited twice
         | under two records.
         */
        'candidate' => [
            'label'   => 'another candidate or onboarding invite',
            'tenant'  => true,
            'sources' => [
                ['table' => 'candidates',                   'column' => 'email',         'soft_deletes' => true],
                ['table' => 'employee_onboarding_invites',  'column' => 'invitee_email', 'soft_deletes' => false],
            ],
        ],

        'customer' => [
            'label'   => 'another customer',
            'tenant'  => true,
            'sources' => [
                ['table' => 'customers', 'column' => 'primary_email', 'soft_deletes' => true],
            ],
        ],

        'consignee' => [
            'label'   => 'another consignee',
            'tenant'  => true,
            'sources' => [
                ['table' => 'consignees', 'column' => 'primary_email', 'soft_deletes' => true],
            ],
        ],

        /*
         | VENDOR — the vendor master and the P2P supplier master are two
         | tables describing the same real party, so they share one scope.
         */
        'vendor' => [
            'label'   => 'another vendor or supplier',
            'tenant'  => true,
            'sources' => [
                ['table' => 'vendors',       'column' => 'primary_email', 'soft_deletes' => true],
                ['table' => 'p2p_suppliers', 'column' => 'email',         'soft_deletes' => true],
            ],
        ],
    ],
];
