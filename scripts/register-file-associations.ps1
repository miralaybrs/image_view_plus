param(
  [switch]$Unregister
)

$ErrorActionPreference = 'Stop'
$progId = 'ImageViewPlus.Photo'
$appName = 'ImageView+'
$appDesc = 'ImageView+'
$appRoot = Split-Path -Parent $PSScriptRoot
$electronExe = Join-Path $appRoot 'node_modules\electron\dist\electron.exe'
$packagedExe = Join-Path $appRoot 'dist\win-unpacked\ImageView+.exe'
$iconPath = Join-Path $appRoot 'assets\icon.ico'

if (Test-Path $packagedExe) {
  $launchCmd = "`"$packagedExe`" `"%1`""
  $exeName = 'ImageView+.exe'
} else {
  $launchCmd = "`"$electronExe`" `"$appRoot`" `"%1`""
  $exeName = 'electron.exe'
}

$iconSpec = "`"$iconPath`",0"
$exts = @(
  '.dng', '.webp', '.jpg', '.jpeg', '.jpe', '.jfif',
  '.png', '.apng', '.gif', '.bmp', '.dib',
  '.tif', '.tiff', '.tga', '.avif', '.heic', '.heif',
  '.svg', '.ico', '.psd', '.ppm', '.pgm', '.pnm', '.pcx', '.hdr', '.jp2', '.jxl',
  '.cr2', '.cr3', '.nef', '.arw', '.orf', '.rw2', '.pef', '.raf', '.srw'
)

if ($Unregister) {
  Remove-Item -Path "HKCU:\Software\Classes\$progId" -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path "HKCU:\Software\ImageViewPlus" -Recurse -Force -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path "HKCU:\Software\RegisteredApplications" -Name 'ImageView+' -Force -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path "HKCU:\Software\RegisteredApplications" -Name 'ImageViewPlus' -Force -ErrorAction SilentlyContinue
  foreach ($ext in $exts) {
    Remove-ItemProperty -Path "HKCU:\Software\Classes\$ext\OpenWithProgids" -Name $progId -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "HKCU:\Software\Classes\SystemFileAssociations\$ext\shell\ImageViewPlus" -Recurse -Force -ErrorAction SilentlyContinue
  }
  Write-Host "ImageView+ dosya iliskilendirmeleri kaldirildi." -ForegroundColor Yellow
  exit 0
}

$progPath = "HKCU:\Software\Classes\$progId"
New-Item -Path "$progPath\DefaultIcon" -Force | Out-Null
New-Item -Path "$progPath\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path $progPath -Name '(Default)' -Value $appName -Force
Set-ItemProperty -Path $progPath -Name 'FriendlyTypeName' -Value $appName -Force
Set-ItemProperty -Path $progPath -Name 'FriendlyAppName' -Value $appName -Force
Set-ItemProperty -Path "$progPath\DefaultIcon" -Name '(Default)' -Value $iconSpec -Force
Set-ItemProperty -Path "$progPath\shell\open" -Name 'FriendlyAppName' -Value $appName -Force
Set-ItemProperty -Path "$progPath\shell\open\command" -Name '(Default)' -Value $launchCmd -Force

$appExeKey = "HKCU:\Software\Classes\Applications\$exeName"
New-Item -Path "$appExeKey\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path $appExeKey -Name 'FriendlyAppName' -Value $appName -Force
Set-ItemProperty -Path "$appExeKey\shell\open\command" -Name '(Default)' -Value $launchCmd -Force

$capPath = "HKCU:\Software\ImageViewPlus\Capabilities"
$fileAssocPath = "$capPath\FileAssociations"
New-Item -Path $fileAssocPath -Force | Out-Null
Set-ItemProperty -Path $capPath -Name 'ApplicationName' -Value $appName -Force
Set-ItemProperty -Path $capPath -Name 'ApplicationDescription' -Value $appDesc -Force

foreach ($ext in $exts) {
  Set-ItemProperty -Path $fileAssocPath -Name $ext -Value $progId -Force
  $extKey = "HKCU:\Software\Classes\$ext"
  if (-not (Test-Path $extKey)) { New-Item -Path $extKey -Force | Out-Null }
  Set-ItemProperty -Path $extKey -Name '(Default)' -Value $progId -Force
  $owp = "$extKey\OpenWithProgids"
  if (-not (Test-Path $owp)) { New-Item -Path $owp -Force | Out-Null }
  New-ItemProperty -Path $owp -Name $progId -Value '' -PropertyType String -Force | Out-Null
}

$regAppsPath = "HKCU:\Software\RegisteredApplications"
if (-not (Test-Path $regAppsPath)) { New-Item -Path $regAppsPath -Force | Out-Null }
Set-ItemProperty -Path $regAppsPath -Name 'ImageView+' -Value 'Software\ImageViewPlus\Capabilities' -Force
Remove-ItemProperty -Path $regAppsPath -Name 'ImageViewPlus' -ErrorAction SilentlyContinue

Write-Host "ImageView+ basariyla Windows varsayilan resim goruntuleyici olarak kaydedildi!" -ForegroundColor Green
