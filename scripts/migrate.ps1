# scripts/migrate.ps1
#
# Runs a SQL migration file against the Supabase project using the Management API.
# Reads credentials from .env.migrations (git-ignored).
#
# Usage:
#   pwsh -File scripts/migrate.ps1 -SqlFile supabase/migrations/045_story_media.sql
#   pwsh -File scripts/migrate.ps1 -Sql "ALTER TABLE ..."

param(
  [string]$SqlFile,
  [string]$Sql
)

# ── Load credentials ──────────────────────────────────────────────────────────
$envFile = Join-Path $PSScriptRoot ".." ".env.migrations"
if (-not (Test-Path $envFile)) {
  Write-Error "ERROR: .env.migrations not found at $envFile"
  exit 1
}

$env = @{}
Get-Content $envFile | Where-Object { $_ -match '=' } | ForEach-Object {
  $parts = $_ -split '=', 2
  $env[$parts[0].Trim()] = $parts[1].Trim()
}

$ref = $env['SUPABASE_PROJECT_REF']
$pat = $env['SUPABASE_PAT']

if (-not $ref -or -not $pat) {
  Write-Error "ERROR: SUPABASE_PROJECT_REF or SUPABASE_PAT missing in .env.migrations"
  exit 1
}

# ── Resolve SQL ───────────────────────────────────────────────────────────────
if ($SqlFile) {
  $fullPath = Join-Path $PSScriptRoot ".." $SqlFile
  $Sql = Get-Content $fullPath -Raw
}

if (-not $Sql) {
  Write-Error "ERROR: Provide -SqlFile or -Sql"
  exit 1
}

# Strip -- comments
$Sql = ($Sql -split "`n" | Where-Object { $_ -notmatch '^\s*--' }) -join "`n"
$Sql = $Sql.Trim()

if (-not $Sql) {
  Write-Host "Nothing to run (SQL was empty after stripping comments)."
  exit 0
}

# ── Execute ───────────────────────────────────────────────────────────────────
$url     = "https://api.supabase.com/v1/projects/$ref/database/query"
$headers = @{ "Authorization" = "Bearer $pat"; "Content-Type" = "application/json" }
$body    = @{ query = $Sql } | ConvertTo-Json -Depth 3

Write-Host "Running migration on project $ref..."

try {
  $res = Invoke-RestMethod -Uri $url -Method POST -Headers $headers -Body $body
  Write-Host "Migration applied successfully."
} catch {
  $code   = $_.Exception.Response.StatusCode.value__
  $stream = $_.Exception.Response.GetResponseStream()
  $detail = [System.IO.StreamReader]::new($stream).ReadToEnd()
  Write-Error "Migration FAILED ($code): $detail"
  exit 1
}
