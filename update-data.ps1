$ErrorActionPreference = "Stop"

$coins = [ordered]@{
  bitcoin = "BTC"
  ethereum = "ETH"
  solana = "SOL"
  monero = "XMR"
  ripple = "XRP"
  cardano = "ADA"
  tron = "TRX"
  dogecoin = "DOGE"
}

$daySeconds = 24 * 60 * 60
$dataFile = Join-Path $PSScriptRoot "crypto-data.json"

function Get-History {
  param(
    [Parameter(Mandatory = $true)] [string] $Symbol,
    [Parameter(Mandatory = $false)] [int] $Limit = 0,
    [Parameter(Mandatory = $false)] [Nullable[long]] $ToTs,
    [Parameter(Mandatory = $false)] [switch] $All
  )

  $url = "https://min-api.cryptocompare.com/data/v2/histoday?fsym=$Symbol&tsym=USD"
  if ($All) {
    # allData=true returns the full available daily history for the symbol.
    $url += "&allData=true"
  } else {
    $safeLimit = [Math]::Max(1, [Math]::Min($Limit, 2000))
    $url += "&limit=$safeLimit"
    if ($ToTs.HasValue) {
      $url += "&toTs=$($ToTs.Value)"
    }
  }

  $resp = Invoke-RestMethod -UseBasicParsing $url
  if ($null -eq $resp.Data -or $null -eq $resp.Data.Data) {
    throw "No history data for $Symbol"
  }

  # Drop pre-inception padding: the API returns close = 0 for dates before the
  # coin existed, which is not a real price.
  return @($resp.Data.Data | Where-Object { $_.time -ne $null -and $_.close -ne $null -and $_.close -gt 0 } | ForEach-Object {
    [ordered]@{
      time = [int64] $_.time
      close = [double] $_.close
    }
  })
}

function Merge-History {
  param(
    [Parameter(Mandatory = $true)] [array] $Base,
    [Parameter(Mandatory = $true)] [array] $Incoming
  )

  $map = @{}

  foreach ($p in $Base) {
    $map[[string]$p.time] = $p
  }

  foreach ($p in $Incoming) {
    $map[[string]$p.time] = $p
  }

  return @($map.Values | Sort-Object -Property time)
}

$nowTs = [int64][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$todayStartTs = $nowTs - ($nowTs % $daySeconds)

if (Test-Path $dataFile) {
  try {
    $existing = Get-Content -Raw -Path $dataFile | ConvertFrom-Json -AsHashtable
  } catch {
    $existing = $null
  }
}

$out = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  range = "all"
  coins = [ordered]@{}
}

foreach ($id in $coins.Keys) {
  $sym = $coins[$id]
  $baseHistory = @()

  if ($existing -and $existing.ContainsKey("coins") -and $existing.coins.ContainsKey($id) -and $existing.coins[$id].ContainsKey("history")) {
    $baseHistory = @($existing.coins[$id].history | Where-Object { $_.time -ne $null -and $_.close -ne $null -and $_.close -gt 0 } | ForEach-Object {
      [ordered]@{
        time = [int64] $_.time
        close = [double] $_.close
      }
    } | Sort-Object -Property time)
  }

  if ($baseHistory.Count -eq 0) {
    # First time for this coin: pull the entire available daily history.
    $history = Get-History -Symbol $sym -All
  } else {
    $lastTs = [int64]$baseHistory[-1].time
    $missingDays = [Math]::Max(0, [Math]::Ceiling(($todayStartTs - $lastTs) / [double]$daySeconds))

    if ($missingDays -gt 0) {
      # Top up only the recent days and merge into the stored full history.
      $incoming = Get-History -Symbol $sym -Limit ($missingDays + 2) -ToTs $todayStartTs
      $history = Merge-History -Base $baseHistory -Incoming $incoming
    } else {
      $history = $baseHistory
    }
  }

  if ($history.Count -eq 0) {
    throw "Empty history for $sym ($id). JSON not updated to avoid broken dataset."
  }

  $out.coins[$id] = [ordered]@{
    symbol = $sym
    history = $history
  }
}

$out | ConvertTo-Json -Depth 8 | Set-Content -Path $dataFile -Encoding UTF8
Write-Output "Updated $dataFile"
