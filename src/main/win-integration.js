const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { execFile } = require('child_process');
const sharp = require('sharp');
const {
  RAW_DNG_EXTS,
  CUSTOM_DECODE_EXTS,
  extractDngFastPreview,
  getDisplayableImageBuffer
} = require('./dng-engine');

const ASSOCIATED_EXTENSIONS = [
  '.dng', '.webp', '.jpg', '.jpeg', '.jpe', '.jfif',
  '.png', '.apng', '.gif', '.bmp', '.dib',
  '.tif', '.tiff', '.tga', '.avif', '.heic', '.heif',
  '.svg', '.ico', '.psd', '.ppm', '.pgm', '.pnm', '.pcx', '.hdr', '.jp2', '.jxl',
  '.cr2', '.cr3', '.nef', '.arw', '.orf', '.rw2', '.pef', '.raf', '.srw'
];

const PROG_ID = 'ImageViewPlus.Photo';
const APP_NAME = 'ImageView+';
const APP_DESC = 'ImageView+';

function getLaunchCommand() {
  if (app.isPackaged) {
    return `"${process.execPath}" "%1"`;
  }
  const appRoot = path.resolve(__dirname, '..', '..');
  return `"${process.execPath}" "${appRoot}" "%1"`;
}

function getAppIconPath() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'assets', 'icon.ico'),
    path.resolve(__dirname, '..', '..', 'assets', 'icon.ico')
  ];
  for (const icoPath of candidates) {
    if (fs.existsSync(icoPath)) {
      return `"${icoPath}",0`;
    }
  }
  return `"${process.execPath}",0`;
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message));
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
}

/**
 * Registers ImageView+ in HKCU\Software\Classes & RegisteredApplications
 * with clean "ImageView+" program name everywhere in Windows.
 */
async function registerWindowsDefaultViewer(options = { openWindowsSettings: false }) {
  if (process.platform !== 'win32') {
    return {
      success: false,
      message: 'Windows file association is only available on Windows.'
    };
  }

  const launchCmd = getLaunchCommand().replace(/'/g, "''");
  const iconSpec = getAppIconPath().replace(/'/g, "''");
  const exeName = path.basename(process.execPath).replace(/'/g, "''");
  const extListPs = ASSOCIATED_EXTENSIONS.map(e => `'${e}'`).join(',');

  const psScript = `
$ErrorActionPreference = 'Stop'
$progId = '${PROG_ID}'
$appName = '${APP_NAME}'
$appDesc = '${APP_DESC}'
$launchCmd = '${launchCmd}'
$iconSpec = '${iconSpec}'
$exeName = '${exeName}'
$exts = @(${extListPs})

# 1. Create ProgID under HKCU\\Software\\Classes
$progPath = "HKCU:\\Software\\Classes\\$progId"
New-Item -Path $progPath -Force | Out-Null
Set-ItemProperty -Path $progPath -Name '(Default)' -Value $appName -Force
Set-ItemProperty -Path $progPath -Name 'FriendlyTypeName' -Value $appName -Force
Set-ItemProperty -Path $progPath -Name 'FriendlyAppName' -Value $appName -Force

$iconPath = "$progPath\\DefaultIcon"
New-Item -Path $iconPath -Force | Out-Null
Set-ItemProperty -Path $iconPath -Name '(Default)' -Value $iconSpec -Force

$shellOpenPath = "$progPath\\shell\\open"
New-Item -Path $shellOpenPath -Force | Out-Null
Set-ItemProperty -Path $shellOpenPath -Name 'FriendlyAppName' -Value $appName -Force

$cmdPath = "$shellOpenPath\\command"
New-Item -Path $cmdPath -Force | Out-Null
Set-ItemProperty -Path $cmdPath -Name '(Default)' -Value $launchCmd -Force

# Set FriendlyAppName on Applications\\ImageView+.exe so Windows Open With always shows "ImageView+"
$appExeKey = "HKCU:\\Software\\Classes\\Applications\\$exeName"
New-Item -Path "$appExeKey\\shell\\open\\command" -Force | Out-Null
Set-ItemProperty -Path $appExeKey -Name 'FriendlyAppName' -Value $appName -Force
Set-ItemProperty -Path "$appExeKey\\shell\\open\\command" -Name '(Default)' -Value $launchCmd -Force

# 2. Register Application Capabilities for Windows 10/11 Default Apps
$capPath = "HKCU:\\Software\\ImageViewPlus\\Capabilities"
New-Item -Path $capPath -Force | Out-Null
Set-ItemProperty -Path $capPath -Name 'ApplicationName' -Value $appName -Force
Set-ItemProperty -Path $capPath -Name 'ApplicationDescription' -Value $appDesc -Force

$fileAssocPath = "$capPath\\FileAssociations"
New-Item -Path $fileAssocPath -Force | Out-Null

foreach ($ext in $exts) {
  Set-ItemProperty -Path $fileAssocPath -Name $ext -Value $progId -Force

  $extKey = "HKCU:\\Software\\Classes\\$ext"
  if (-not (Test-Path $extKey)) {
    New-Item -Path $extKey -Force | Out-Null
  }
  Set-ItemProperty -Path $extKey -Name '(Default)' -Value $progId -Force

  $openWithProgids = "$extKey\\OpenWithProgids"
  if (-not (Test-Path $openWithProgids)) {
    New-Item -Path $openWithProgids -Force | Out-Null
  }
  New-ItemProperty -Path $openWithProgids -Name $progId -Value '' -PropertyType String -Force | Out-Null

  $ctxCmd = "HKCU:\\Software\\Classes\\SystemFileAssociations\\$ext\\shell\\ImageViewPlus"
  New-Item -Path "$ctxCmd\\command" -Force | Out-Null
  Set-ItemProperty -Path $ctxCmd -Name '(Default)' -Value 'ImageView+' -Force
  Set-ItemProperty -Path $ctxCmd -Name 'Icon' -Value $iconSpec -Force
  Set-ItemProperty -Path "$ctxCmd\\command" -Name '(Default)' -Value $launchCmd -Force
}

$regAppsPath = "HKCU:\\Software\\RegisteredApplications"
if (-not (Test-Path $regAppsPath)) {
  New-Item -Path $regAppsPath -Force | Out-Null
}
Set-ItemProperty -Path $regAppsPath -Name 'ImageView+' -Value 'Software\\ImageViewPlus\\Capabilities' -Force
Remove-ItemProperty -Path $regAppsPath -Name 'ImageViewPlus' -ErrorAction SilentlyContinue

$code = @'
using System;
using System.Runtime.InteropServices;
public class ShellNotify {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
}
'@
Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
[ShellNotify]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Output "OK"
`;

  await runPowerShell(psScript);

  if (options && options.openWindowsSettings) {
    shell.openExternal('ms-settings:defaultapps');
  }

  return {
    success: true,
    extensions: ASSOCIATED_EXTENSIONS
  };
}

async function unregisterWindowsDefaultViewer() {
  if (process.platform !== 'win32') return { success: false };

  const extListPs = ASSOCIATED_EXTENSIONS.map(e => `'${e}'`).join(',');
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$progId = '${PROG_ID}'
$exts = @(${extListPs})

Remove-Item -Path "HKCU:\\Software\\Classes\\$progId" -Recurse -Force
Remove-Item -Path "HKCU:\\Software\\ImageViewPlus" -Recurse -Force
Remove-ItemProperty -Path "HKCU:\\Software\\RegisteredApplications" -Name 'ImageView+' -Force
Remove-ItemProperty -Path "HKCU:\\Software\\RegisteredApplications" -Name 'ImageViewPlus' -Force

foreach ($ext in $exts) {
  Remove-ItemProperty -Path "HKCU:\\Software\\Classes\\$ext\\OpenWithProgids" -Name $progId -Force
  Remove-Item -Path "HKCU:\\Software\\Classes\\SystemFileAssociations\\$ext\\shell\\ImageViewPlus" -Recurse -Force
}
Write-Output "OK"
`;
  await runPowerShell(psScript);
  return { success: true };
}

async function checkWindowsViewerRegistration() {
  if (process.platform !== 'win32') return { registered: false, platform: process.platform };
  try {
    const out = await runPowerShell(`Test-Path 'HKCU:\\Software\\Classes\\${PROG_ID}\\shell\\open\\command'`);
    return {
      registered: out.toLowerCase() === 'true',
      platform: process.platform,
      extensions: ASSOCIATED_EXTENSIONS
    };
  } catch {
    return { registered: false, platform: process.platform, extensions: ASSOCIATED_EXTENSIONS };
  }
}

async function setAsDesktopWallpaper(filePath) {
  if (process.platform !== 'win32') {
    throw new Error('Desktop wallpaper is only supported on Windows.');
  }

  const ext = path.extname(filePath).toLowerCase();
  const userDataDir = app.getPath('userData');
  await fsp.mkdir(userDataDir, { recursive: true });
  const targetPngPath = path.join(userDataDir, 'imageviewplus_wallpaper.png');

  if (RAW_DNG_EXTS.has(ext)) {
    const preview = await extractDngFastPreview(filePath, 'preview');
    await sharp(preview.buffer).png().toFile(targetPngPath);
  } else if (CUSTOM_DECODE_EXTS.has(ext)) {
    const displayable = await getDisplayableImageBuffer(filePath);
    await sharp(displayable.buffer).png().toFile(targetPngPath);
  } else {
    await sharp(filePath, { failOn: 'none' }).rotate().png().toFile(targetPngPath);
  }

  const escapedPath = targetPngPath.replace(/'/g, "''");
  const psScript = `
$code = @'
using System;
using System.Runtime.InteropServices;
public class WallpaperSetter {
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
'@
Add-Type -TypeDefinition $code
[WallpaperSetter]::SystemParametersInfo(0x0014, 0, '${escapedPath}', 0x01 -bor 0x02) | Out-Null
Write-Output "OK"
`;
  await runPowerShell(psScript);
  return { success: true, wallpaperPath: targetPngPath };
}

module.exports = {
  ASSOCIATED_EXTENSIONS,
  registerWindowsDefaultViewer,
  unregisterWindowsDefaultViewer,
  checkWindowsViewerRegistration,
  setAsDesktopWallpaper
};
