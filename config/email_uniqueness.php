<?php

return [
    'scopes' => [
        'login' => [
            'label'   => 'another user account',
            'tenant'  => false,
            'sources' => [
                ['table' => 'users', 'column' => 'email', 'soft_deletes' => true, 'where' => ['email_active' => true]],
            ],
        ],

        'employee' => [
            'label'   => 'another employee',
            'tenant'  => false,
            'sources' => [
                ['table' => 'employees', 'column' => 'email',          'soft_deletes' => true],
                ['table' => 'employees', 'column' => 'official_email', 'soft_deletes' => true],
            ],
        ],

        'candidate' => [
            'label'   => 'another candidate or onboarding invite',
            'tenant'  => false,
            'sources' => [
                ['table' => 'candidates',                   'column' => 'email',         'soft_deletes' => true],
                ['table' => 'employee_onboarding_invites',  'column' => 'invitee_email', 'soft_deletes' => false],
            ],
        ],

        'organisation' => [
            'label'   => 'an organisation or branch contact address',
            'tenant'  => false,
            'sources' => [
                ['table' => 'clients',  'column' => 'email', 'soft_deletes' => true, 'tenant_column' => 'id'],
                ['table' => 'branches', 'column' => 'email', 'soft_deletes' => true],
            ],
        ],

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
