<#
.SYNOPSIS
  Check an Anthropic API key, then store it as the parse-erg Edge Function secret.

.DESCRIPTION
  Key rotation has broken the erg photo reader twice, both times silently and
  both times for a reason that looked like something else:

    2026-08-26  a 30-day key expired. The app said "api key is invalid" and the
                obvious suspects (usage limits, Supabase config) were all fine.
    2026-08-31  the replacement was an identity-linked key, which authenticates
                and then refuses to act without an anthropic-workspace-id.

  Both were a minute's work to fix and an hour's work to find, so this script
  does the finding. It verifies the key against Anthropic FIRST and only writes
  the secret if the key actually works - a bad key never reaches Supabase, and
  a working one is never left unsaved.

  Run it from anywhere; it does not care about the working directory.

.PARAMETER Key
  The key from console.anthropic.com. Create it with Expires = Never.

.PARAMETER WorkspaceId
  Only for an identity-linked key ("Linked account: <a person>" in the console).
  A workspace or service-account key does not need this.

.EXAMPLE
  .\scripts\rotate-erg-key.ps1 -Key sk-ant-api03-xxxx

.EXAMPLE
  .\scripts\rotate-erg-key.ps1 -Key sk-ant-api03-xxxx -WorkspaceId wrkspc_01ABC
#>
param(
  [Parameter(Mandatory = $true)][string]$Key,
  [string]$WorkspaceId = "",
  [string]$ProjectRef = "tbhujqdflswhgxtioznb"
)

$ErrorActionPreference = "Stop"
$Key = $Key.Trim().Trim('"').Trim("'")   # a pasted key often arrives quoted

Write-Host ""
Write-Host "1. Testing the key against Anthropic..." -ForegroundColor Cyan

# Built as an array so no amount of line wrapping can drop an argument, which
# is exactly how the anthropic-version header went missing when this was a
# single pasted command.
$curlArgs = @(
  "-s", "-w", "`n%{http_code}",
  "https://api.anthropic.com/v1/models",
  "-H", "x-api-key: $Key",
  "-H", "anthropic-version: 2023-06-01"
)
if ($WorkspaceId) { $curlArgs += @("-H", "anthropic-workspace-id: $WorkspaceId") }

$raw = & curl.exe @curlArgs
$lines = $raw -split "`n"
$code = $lines[-1].Trim()
$body = ($lines[0..($lines.Count - 2)] -join "`n").Trim()

if ($code -ne "200") {
  Write-Host "   FAILED - HTTP $code" -ForegroundColor Red
  Write-Host "   $body" -ForegroundColor Red
  Write-Host ""
  if ($body -match "workspace") {
    Write-Host "   This key is identity-linked. Either create a key scoped to a" -ForegroundColor Yellow
    Write-Host "   workspace or service account instead, or re-run this with" -ForegroundColor Yellow
    Write-Host "   -WorkspaceId wrkspc_...  (console.anthropic.com > Settings > Workspaces)" -ForegroundColor Yellow
  } elseif ($body -match "authentication_error|invalid x-api-key|API key is invalid") {
    Write-Host "   The key itself is rejected - expired, revoked, or a partial copy." -ForegroundColor Yellow
    Write-Host "   Create a fresh one with Expires = Never." -ForegroundColor Yellow
  } elseif ($body -match "credit balance") {
    Write-Host "   The key is fine; the account is out of credit. Top it up." -ForegroundColor Yellow
  }
  Write-Host ""
  Write-Host "   Nothing was written to Supabase." -ForegroundColor Red
  exit 1
}
Write-Host "   OK - the key works." -ForegroundColor Green

Write-Host ""
Write-Host "2. Storing it as the parse-erg secret..." -ForegroundColor Cyan
& supabase secrets set "ANTHROPIC_API_KEY=$Key" --project-ref $ProjectRef | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "   FAILED to set the secret." -ForegroundColor Red; exit 1 }
Write-Host "   Stored." -ForegroundColor Green

if ($WorkspaceId) {
  & supabase secrets set "ANTHROPIC_WORKSPACE_ID=$WorkspaceId" --project-ref $ProjectRef | Out-Null
  Write-Host "   Workspace id stored." -ForegroundColor Green
}

Write-Host ""
Write-Host "3. Deploy for it to take effect:" -ForegroundColor Cyan
Write-Host "     cd tracker" -ForegroundColor White
Write-Host "     supabase functions deploy parse-erg --project-ref $ProjectRef" -ForegroundColor White
Write-Host "     cd .." -ForegroundColor White
Write-Host ""
