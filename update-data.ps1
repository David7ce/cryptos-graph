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

$days = 365
$daySeconds = 24 * 60 * 60
$dataFile = Join-Path $PSScriptRoot "crypto-data.json"

function Get-History {
  param(
    [Parameter(Mandatory = $true)] [string] $Symbol,
    [Parameter(Mandatory = $true)] [int] $Limit,
    [Parameter(Mandatory = $false)] [Nullable[long]] $ToTs
  )

  $safeLimit = [Math]::Max(1, [Math]::Min($Limit, 2000))
  $url = "https://min-api.cryptocompare.com/data/v2/histoday?fsym=$Symbol&tsym=USD&limit=$safeLimit"
  if ($ToTs.HasValue) {
    $url += "&toTs=$($ToTs.Value)"
  }

  $resp = Invoke-RestMethod -UseBasicParsing $url
  if ($null -eq $resp.Data -or $null -eq $resp.Data.Data) {
    throw "No history data for $Symbol"
  }

  return @($resp.Data.Data | Where-Object { $_.time -ne $null -and $_.close -ne $null } | ForEach-Object {
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
  days = $days
  coins = [ordered]@{}
}

foreach ($id in $coins.Keys) {
  $sym = $coins[$id]
  $baseHistory = @()

  if ($existing -and $existing.ContainsKey("coins") -and $existing.coins.ContainsKey($id) -and $existing.coins[$id].ContainsKey("history")) {
    $baseHistory = @($existing.coins[$id].history | Where-Object { $_.time -ne $null -and $_.close -ne $null } | ForEach-Object {
      [ordered]@{
        time = [int64] $_.time
        close = [double] $_.close
      }
    } | Sort-Object -Property time)
  }

  if ($baseHistory.Count -eq 0) {
    $history = Get-History -Symbol $sym -Limit $days -ToTs $todayStartTs
  } else {
    $lastTs = [int64]$baseHistory[-1].time
    $missingDays = [Math]::Max(0, [Math]::Ceiling(($todayStartTs - $lastTs) / [double]$daySeconds))

    if ($missingDays -gt 0) {
      $incoming = Get-History -Symbol $sym -Limit ($missingDays + 2) -ToTs $todayStartTs
      $history = Merge-History -Base $baseHistory -Incoming $incoming
    } else {
      $history = $baseHistory
    }
  }

  if ($history.Count -gt ($days + 1)) {
    $history = @($history | Select-Object -Last ($days + 1))
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
