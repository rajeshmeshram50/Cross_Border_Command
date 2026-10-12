<#
    Inventory * Product Flags Master - end-to-end smoke test.

    Seeds the 8 flags the prototype ships with, then exercises every endpoint
    and checks the two guards that are easy to break: the duplicate-name 422
    and the active-only filter on /options.

    Run `php artisan migrate` first - the five inventory tables are not created
    until you do, and every call 500s without them.

        pwsh docs/inventory/test-product-flags.ps1
        pwsh docs/inventory/test-product-flags.ps1 -BaseUrl http://127.0.0.1:8000/api
#>

param(
    [string] $BaseUrl  = 'http://localhost:8000/api',
    [string] $Email    = 'agrotech@mailinator.com',
    [string] $Password = 'Test@123'
)

$ErrorActionPreference = 'Stop'
$script:Pass = 0
$script:Fail = 0

function Show-Call {
    param([string] $Method, [string] $Path, $Payload)

    Write-Host ''
    Write-Host ("{0,-6} {1}" -f $Method, $Path) -ForegroundColor Cyan
    if ($null -ne $Payload) {
        Write-Host '  payload ' -NoNewline -ForegroundColor DarkGray
        Write-Host ($Payload | ConvertTo-Json -Compress -Depth 6) -ForegroundColor DarkGray
    }
}

# Returns a PSCustomObject: Code (int) + Body (parsed json, or $null).
#
# A 422 or 404 is an answer here, not a failure. Windows PowerShell 5.1 throws
# on any non-2xx and has no -SkipHttpErrorCheck, so the status is read back off
# the exception; pwsh 7 takes the same path and behaves identically.
function Invoke-Api {
    param(
        [string] $Method,
        [string] $Path,
        $Payload = $null,
        [string] $Token = $null
    )

    Show-Call -Method $Method -Path $Path -Payload $Payload

    $headers = @{ Accept = 'application/json' }
    if ($Token) { $headers['Authorization'] = "Bearer $Token" }

    $req = @{
        Uri             = "$BaseUrl$Path"
        Method          = $Method
        Headers         = $headers
        UseBasicParsing = $true
    }
    if ($null -ne $Payload) {
        $req['ContentType'] = 'application/json'
        $req['Body']        = ($Payload | ConvertTo-Json -Depth 6)
    }

    $code    = 0
    $content = $null

    try {
        $res     = Invoke-WebRequest @req
        $code    = [int] $res.StatusCode
        $content = $res.Content
    } catch {
        $response = $_.Exception.Response
        if ($null -eq $response) { throw }       # connection refused, DNS, timeout

        $code = [int] $response.StatusCode
        try {
            $reader  = New-Object System.IO.StreamReader($response.GetResponseStream())
            $content = $reader.ReadToEnd()
            $reader.Close()
        } catch { }
    }

    $body = $null
    if ($content) { try { $body = $content | ConvertFrom-Json } catch { } }

    return [pscustomobject]@{ Code = $code; Body = $body }
}

function Assert-Code {
    param([string] $What, $Response, [int] $Expect)

    if ($Response.Code -eq $Expect) {
        Write-Host ("  OK   {0}  [{1}]" -f $What, $Response.Code) -ForegroundColor Green
        $script:Pass++
    } else {
        $msg = if ($Response.Body) { $Response.Body.message } else { '' }
        Write-Host ("  FAIL {0}  expected {1}, got {2}  {3}" -f $What, $Expect, $Response.Code, $msg) -ForegroundColor Red
        $script:Fail++
    }
}

# -- 0 * token --------
Write-Host '== Auth ==' -ForegroundColor Yellow
$login = Invoke-Api -Method POST -Path '/login' -Payload @{ email = $Email; password = $Password }
if (-not $login.Body.token) {
    Write-Host '  no token in the response - check the credentials' -ForegroundColor Red
    exit 1
}
$token = $login.Body.token
Write-Host ("  OK   logged in as {0}  (branch {1})" -f $login.Body.user.name, $login.Body.user.branch_id) -ForegroundColor Green

# -- 1 * create the 8 flags --------
# POST /inventory/product-flags  *  application/json
#   flag_name  string, required, max 120, unique per client (case-insensitive)
#   purpose    string, required, max 255
#   status     int,    optional, 0|1, defaults to 1
Write-Host ''
Write-Host '== 1. Create 8 product flags ==' -ForegroundColor Yellow

$flags = @(
    @{ flag_name = 'Standard';              purpose = 'Normal product with no special handling' },
    @{ flag_name = 'Fragile';               purpose = 'Requires careful handling' },
    @{ flag_name = 'Hazardous';             purpose = 'Dangerous or regulated material' },
    @{ flag_name = 'Cold Chain';            purpose = 'Requires controlled cold temperature' },
    @{ flag_name = 'Temperature Sensitive'; purpose = 'Requires a specified temperature range' },
    @{ flag_name = 'Flammable';             purpose = 'Fire-risk material requiring suitable storage' },
    @{ flag_name = 'Non-Stackable';         purpose = 'Cannot have other boxes stacked on top' },
    @{ flag_name = 'Keep Upright';          purpose = 'Must remain in a specified orientation' }
)

$created = @()
foreach ($f in $flags) {
    $r = Invoke-Api -Method POST -Path '/inventory/product-flags' -Payload $f -Token $token
    Assert-Code -What "create $($f.flag_name)" -Response $r -Expect 201
    if ($r.Code -eq 201) {
        $created += $r.Body.data
        Write-Host ("       -> id {0}  code {1}" -f $r.Body.data.id, $r.Body.data.flag_code) -ForegroundColor DarkGray
    }
}

if ($created.Count -eq 0) {
    Write-Host ''
    Write-Host 'Nothing was created - did you run `php artisan migrate`?' -ForegroundColor Red
    exit 1
}

$first = $created[0]

# -- 2 * duplicate name is refused --------
Write-Host ''
Write-Host '== 2. Duplicate name (expect 422) ==' -ForegroundColor Yellow
$dup = Invoke-Api -Method POST -Path '/inventory/product-flags' `
    -Payload @{ flag_name = 'fragile'; purpose = 'lower case on purpose' } -Token $token
Assert-Code -What 'duplicate refused' -Response $dup -Expect 422

# -- 3 * list, with tab counts --------
# GET /inventory/product-flags?tab=all|active|inactive&q=&page=&per_page=
Write-Host ''
Write-Host '== 3. List ==' -ForegroundColor Yellow
$list = Invoke-Api -Method GET -Path '/inventory/product-flags?tab=all&per_page=10' -Token $token
Assert-Code -What 'list' -Response $list -Expect 200
if ($list.Code -eq 200) {
    Write-Host ("       tabs all={0} active={1} inactive={2}  *  total {3}, page {4}/{5}" -f `
        $list.Body.tabs.all, $list.Body.tabs.active, $list.Body.tabs.inactive,
        $list.Body.meta.total, $list.Body.meta.page, $list.Body.meta.last_page) -ForegroundColor DarkGray
}

# -- 4 * search (ilike over flag_name + purpose) --------
Write-Host ''
Write-Host '== 4. Search ==' -ForegroundColor Yellow
$search = Invoke-Api -Method GET -Path '/inventory/product-flags?q=cold' -Token $token
Assert-Code -What 'search q=cold' -Response $search -Expect 200
if ($search.Code -eq 200) {
    Write-Host ("       {0} row(s); tabs still all={1} - the counts ignore the search" -f `
        $search.Body.data.Count, $search.Body.tabs.all) -ForegroundColor DarkGray
}

# -- 5 * show --------
Write-Host ''
Write-Host '== 5. Show ==' -ForegroundColor Yellow
$show = Invoke-Api -Method GET -Path "/inventory/product-flags/$($first.id)" -Token $token
Assert-Code -What 'show' -Response $show -Expect 200

# -- 6 * update --------
# PUT /inventory/product-flags/{id}  *  same body as create
Write-Host ''
Write-Host '== 6. Update ==' -ForegroundColor Yellow
$upd = Invoke-Api -Method PUT -Path "/inventory/product-flags/$($first.id)" `
    -Payload @{ flag_name = $first.flag_name; purpose = 'Updated by the smoke test' } -Token $token
Assert-Code -What 'update' -Response $upd -Expect 200

# -- 7 * toggle, and prove /options drops it --------
# PUT /inventory/product-flags/{id}/status  *  { status: 0|1 }
Write-Host ''
Write-Host '== 7. Toggle + options ==' -ForegroundColor Yellow

$before = Invoke-Api -Method GET -Path '/inventory/product-flags/options' -Token $token
Assert-Code -What 'options before' -Response $before -Expect 200

$off = Invoke-Api -Method PUT -Path "/inventory/product-flags/$($first.id)/status" `
    -Payload @{ status = 0 } -Token $token
Assert-Code -What 'toggle to inactive' -Response $off -Expect 200

$after = Invoke-Api -Method GET -Path '/inventory/product-flags/options' -Token $token
Assert-Code -What 'options after' -Response $after -Expect 200

if ($before.Code -eq 200 -and $after.Code -eq 200) {
    $n1 = $before.Body.data.Count
    $n2 = $after.Body.data.Count
    if ($n2 -eq $n1 - 1) {
        Write-Host ("  OK   options dropped the inactive flag ({0} -> {1})" -f $n1, $n2) -ForegroundColor Green
        $script:Pass++
    } else {
        Write-Host ("  FAIL options should have gone {0} -> {1}, got {2}" -f $n1, ($n1 - 1), $n2) -ForegroundColor Red
        $script:Fail++
    }
}

# An inactive flag must still be listed under its own tab.
$inact = Invoke-Api -Method GET -Path '/inventory/product-flags?tab=inactive' -Token $token
Assert-Code -What 'tab=inactive lists it' -Response $inact -Expect 200

# -- 8 * delete --------
# Allowed outright, unlike the other four masters: a flag has no children.
Write-Host ''
Write-Host '== 8. Delete ==' -ForegroundColor Yellow
$del = Invoke-Api -Method DELETE -Path "/inventory/product-flags/$($first.id)" -Token $token
Assert-Code -What 'delete' -Response $del -Expect 200

$gone = Invoke-Api -Method GET -Path "/inventory/product-flags/$($first.id)" -Token $token
Assert-Code -What 'deleted row is gone' -Response $gone -Expect 404

# -- summary --------
Write-Host ''
Write-Host ('=' * 54)
Write-Host ("  passed {0}   failed {1}" -f $script:Pass, $script:Fail) `
    -ForegroundColor $(if ($script:Fail -eq 0) { 'Green' } else { 'Red' })
Write-Host ('=' * 54)

exit $(if ($script:Fail -eq 0) { 0 } else { 1 })
