$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$mobileData = $env:TYPEWORDS_MOBILE_DATA ?? (Join-Path $root 'service/mobile-data')
$releases = Join-Path $mobileData 'android-releases'
$dist = Join-Path $PSScriptRoot 'dist'
$apk = Join-Path $dist 'TypeWords-Android.apk'
$manifest = Join-Path $dist 'TypeWords-Android.json'
$release = Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json
$hash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash
if ($release.versionCode -isnot [long] -and $release.versionCode -isnot [int]) { Write-Error 'APK 版本无效' }
if ($release.versionCode -lt 1 -or $release.sha256 -ne $hash -or $release.size -ne (Get-Item -LiteralPath $apk).Length) { Write-Error 'APK 和发布清单不匹配' }
$latest = Join-Path $releases 'latest.json'
if (Test-Path -LiteralPath $latest) {
  $previous = Get-Content -Raw -LiteralPath $latest | ConvertFrom-Json
  if ($previous.versionCode -gt $release.versionCode) { Write-Error '发布版本低于当前版本' }
}
$folder = Join-Path $releases ([string]$release.versionCode)
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$target = Join-Path $folder 'TypeWords-Android.apk'
if (Test-Path -LiteralPath $target) {
  if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $hash) { Write-Error '该版本已发布，请提高 versionCode 后重试' }
} else {
  Copy-Item -LiteralPath $apk -Destination ($target + '.incoming')
  Move-Item -LiteralPath ($target + '.incoming') -Destination $target
}
# 完整 APK 到位后替换清单，旧版本文件仍可供进行中的下载使用。
$next = Join-Path $releases ('latest.' + [guid]::NewGuid().ToString('N') + '.json')
Copy-Item -LiteralPath $manifest -Destination $next
[IO.File]::Move($next, $latest, $true)
"Published Android $($release.versionName) ($($release.versionCode))"
