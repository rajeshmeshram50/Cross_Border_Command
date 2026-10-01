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
| tenant => false means "unique across the WHOLE system": once an address
| exists anywhere in this database it cannot be used again, by any client, in
| any branch, for any kind of record. That is what every scope below now says,
| on instruction (#221).
|
| It replaces the previous per-tenant rule, under which the same person could
| hold an account at two client organisations and login disambiguated by org
| (#15). That org picker still exists in the login flow; with these settings it
| can no longer be reached, because a second account on one address can no
| longer be created. Nothing had to be migrated: a scan of every participating
| column found no address used twice anywhere, so no existing row is made
| unsaveable by the change.
|
| To return any single scope to per-tenant, set its `tenant` back to true —
| one word, no other change.
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
            'tenant'  => false,
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
            'tenant'  => false,
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
            'tenant'  => false,
            'sources' => [
                ['table' => 'candidates',                   'column' => 'email',         'soft_deletes' => true],
                ['table' => 'employee_onboarding_invites',  'column' => 'invitee_email', 'soft_deletes' => false],
            ],
        ],

        /*
         | ORGANISATION — the contact address on a client or a branch record.
         |
         | Neither column belonged to ANY scope, so neither blocked anything and
         | nothing blocked them: an employee could be created on the address the
         | branch itself uses, and on the client's own address, with no warning.
         | Both were accepted outright (verified: HTTP 201 on each) even though
         | employee-vs-employee and employee-vs-login were already refused. That
         | is the duplicate this ticket is about — the address was already spoken
         | for, just not by a row anyone was looking at.
         |
         | Checked BY people (employees, logins); deliberately NOT checked by
         | clients and branches against each other. A client and its head-office
         | branch legitimately share one mailbox — they are one organisation, and
         | this database already has such a pair — so putting the two columns in
         | one mutual scope would refuse an edit to a record that has been
         | correct since the day it was created.
         |
         | `tenant_column` on clients is `id`: the clients table IS the tenant,
         | so its own primary key is what scopes it. See EmailGuard.
         */
        'organisation' => [
            'label'   => 'an organisation or branch contact address',
            'tenant'  => false,
            'sources' => [
                ['table' => 'clients',  'column' => 'email', 'soft_deletes' => true, 'tenant_column' => 'id'],
                ['table' => 'branches', 'column' => 'email', 'soft_deletes' => true],
            ],
        ],

        /*
         | PERSON — the identities a human holds inside a tenant: their login
         | and their employee record. Used by the client and branch forms so an
         | organisation address cannot be set to one a person already holds,
         | which is the same rule as `organisation` read from the other side.
         */
        'person' => [
            'label'   => 'a user account or employee',
            'tenant'  => false,
            'sources' => [
                ['table' => 'users',     'column' => 'email',          'soft_deletes' => true, 'where' => ['email_active' => true]],
                ['table' => 'employees', 'column' => 'email',          'soft_deletes' => true],
                ['table' => 'employees', 'column' => 'official_email', 'soft_deletes' => true],
            ],
        ],

        'customer' => [
            'label'   => 'another customer',
            'tenant'  => false,
            'sources' => [
                ['table' => 'customers', 'column' => 'primary_email', 'soft_deletes' => true],
            ],
        ],

        'consignee' => [
            'label'   => 'another consignee',
            'tenant'  => false,
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
            'tenant'  => false,
            'sources' => [
                ['table' => 'vendors',       'column' => 'primary_email', 'soft_deletes' => true],
                ['table' => 'p2p_suppliers', 'column' => 'email',         'soft_deletes' => true],
            ],
        ],
    ],
];
