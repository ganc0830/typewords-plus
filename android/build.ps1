$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tools = $env:TYPEWORDS_ANDROID_TOOLS ?? (Join-Path $root '验证与备份/android-toolchain')
$webBuild = Join-Path $root 'upstream/.output'
if (!(Test-Path -LiteralPath (Join-Path $webBuild 'server/index.mjs'))) { $webBuild = Join-Path $root '.output' }
$jdk = (Get-ChildItem -LiteralPath (Join-Path $tools 'jdk') -Directory | Select-Object -First 1).FullName
$sdk = Join-Path $tools 'sdk'
$platform = Join-Path $sdk 'platforms/android-35/android.jar'
$buildTools = Join-Path $sdk 'build-tools/35.0.0'
$env:JAVA_HOME = $jdk
# aapt2 的 Windows 文件入口不支持本项目中文路径，暂存到固定 D 盘 ASCII 构建目录。
$work = $env:TYPEWORDS_ANDROID_WORK ?? 'D:/codex-review-temp/typewords-android-build'
$assets = Join-Path $work 'assets'
$classes = Join-Path $work 'classes'
$dist = Join-Path $PSScriptRoot 'dist'
$env:TEMP = Join-Path $work 'temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force $assets,$classes,$dist,$env:TEMP | Out-Null
Copy-Item -LiteralPath $platform -Destination (Join-Path $work 'android.jar')
$platform = Join-Path $work 'android.jar'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'AndroidManifest.xml') -Destination (Join-Path $work 'AndroidManifest.xml')
# 前端构建与 APK 共用同一套页面。HTML 由本次生产构建生成，避免引用旧资源哈希。
robocopy.exe (Join-Path $webBuild 'public') (Join-Path $assets 'public') /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { exit $LASTEXITCODE }
$env:NITRO_HOST = '127.0.0.1'
$env:NITRO_PORT = '5569'
$server = Start-Process -FilePath 'node.exe' -ArgumentList @('"' + (Join-Path $webBuild 'server/index.mjs') + '"') -WorkingDirectory $root -WindowStyle Hidden -PassThru
try {
  $html = $null
  for ($i = 0; $i -lt 30; $i++) {
    try { $html = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5569/words' -TimeoutSec 2; break } catch { Start-Sleep -Milliseconds 300 }
  }
  if (!$html) { Write-Error '无法生成 Android 页面'; exit 1 }
  [IO.File]::WriteAllText((Join-Path $assets 'public/index.html'), $html.Content, [Text.UTF8Encoding]::new($false))
} finally { if (!$server.HasExited) { Stop-Process -Id $server.Id } }
& (Join-Path $jdk 'bin/javac.exe') -encoding UTF-8 -source 8 -target 8 -classpath $platform -d $classes (Join-Path $PSScriptRoot 'src/cc/typewords/offline/MainActivity.java')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& (Join-Path $jdk 'bin/jar.exe') cf (Join-Path $work 'classes.jar') -C $classes .
& (Join-Path $buildTools 'd8.bat') --lib $platform --min-api 26 --output $work (Join-Path $work 'classes.jar')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$unsigned = Join-Path $work 'unsigned.apk'
& (Join-Path $buildTools 'aapt2.exe') link -I $platform --manifest (Join-Path $work 'AndroidManifest.xml') --min-sdk-version 26 --target-sdk-version 35 -o $unsigned
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& (Join-Path $jdk 'bin/jar.exe') uf $unsigned -C $work classes.dex
# Java ZIP 写入器保留词库内中文资源名；资源统一放在标准 assets 目录。
& (Join-Path $jdk 'bin/jar.exe') uf $unsigned -C $work assets
$aligned = Join-Path $work 'aligned.apk'
& (Join-Path $buildTools 'zipalign.exe') -f 4 $unsigned $aligned
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
# 本机安装签名只保存在本机；后续更新沿用同一密钥，Android 才能保留应用数据。
$key = Join-Path $tools 'typewords-install.jks'
if (!(Test-Path -LiteralPath $key)) {
  & (Join-Path $jdk 'bin/keytool.exe') -genkeypair -keystore $key -storepass android -keypass android -alias typewords -dname 'CN=TypeWords Local' -keyalg RSA -keysize 2048 -validity 10000
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
$apk = Join-Path $dist 'TypeWords-Android.apk'
& (Join-Path $buildTools 'apksigner.bat') sign --ks $key --ks-pass pass:android --key-pass pass:android --out $apk $aligned
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& (Join-Path $buildTools 'apksigner.bat') verify --verbose $apk
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Get-Item -LiteralPath $apk | Select-Object FullName,Length
