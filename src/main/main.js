const {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  dialog,
  shell,
  clipboard,
  nativeImage,
  screen
} = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { pathToFileURL } = require('url');
const sharp = require('sharp');

const {
  NATIVE_WEB_EXTS,
  RAW_DNG_EXTS,
  CUSTOM_DECODE_EXTS,
  ALL_SUPPORTED_EXTS,
  extractDngFastPreview,
  generateThumbnail,
  getDisplayableImageBuffer,
  extractImageMetadata
} = require('./dng-engine');

const {
  registerWindowsDefaultViewer,
  unregisterWindowsDefaultViewer,
  checkWindowsViewerRegistration,
  setAsDesktopWallpaper
} = require('./win-integration');

const APP_VERSION = '1.2';
const SUPPORTED_LANGS = ['en', 'tr', 'de', 'fr', 'es', 'ru', 'zh', 'ja', 'ar', 'pt'];

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'imgplus',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

let mainWindow = null;
let pendingOpenFilePath = null;
let cachedLogoBuffer = null;
let cachedLogoMime = 'image/png';

const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});

// ==================== PERSISTENT SETTINGS ====================

function getSettingsFilePath() {
  return path.join(app.getPath('userData'), 'settings_v12.json');
}

function detectDefaultLanguage() {
  try {
    const sysLocale = (app.getLocale() || 'en').toLowerCase();
    const baseLang = sysLocale.split('-')[0].split('_')[0];
    if (SUPPORTED_LANGS.includes(baseLang)) {
      return baseLang;
    }
  } catch {
    // ignore
  }
  return 'en';
}

function getDefaultSettings() {
  return {
    language: detectDefaultLanguage(),
    uiTheme: 'liquid-glass', // 'liquid-glass' | 'dark' | 'light'
    bgTheme: 'bg-checkerboard', // default checkerboard as requested
    showFilmstrip: true,
    showExif: false,
    wheelMode: 'zoom',
    windowBounds: null
  };
}

function loadSettingsSync() {
  const defaults = getDefaultSettings();
  try {
    const fp = getSettingsFilePath();
    if (fs.existsSync(fp)) {
      const parsed = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      return { ...defaults, ...parsed };
    }
  } catch {
    // ignore corrupt settings
  }
  return defaults;
}

function saveSettingsSync(partial) {
  try {
    const current = loadSettingsSync();
    const merged = { ...current, ...partial };
    const fp = getSettingsFilePath();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(merged, null, 2), 'utf-8');
    return merged;
  } catch (err) {
    console.error('Failed to save settings:', err);
    return partial;
  }
}

// ==================== DYNAMIC LOGO DETECTOR & ICON GENERATOR ====================

function buildIcoFromPng(pngBuf) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(0, 6);
  header.writeUInt8(0, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(pngBuf.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, pngBuf]);
}

function getCandidateLogoDirs() {
  const dirs = new Set([
    path.resolve(__dirname, '..', '..'),
    path.dirname(process.execPath),
    path.resolve(path.dirname(process.execPath), '..', '..'),
    path.resolve(__dirname, '..', '..', 'assets')
  ]);
  return Array.from(dirs).filter(d => d && fs.existsSync(d));
}

function findUserLogoFile() {
  const logoExts = ['.png', '.webp', '.jpg', '.jpeg', '.svg', '.ico', '.bmp', '.gif'];
  const priorityNames = ['logo', 'markadestek', 'app_logo', 'brand', 'icon'];
  const dirs = getCandidateLogoDirs();

  // 1. Check explicit logo.* filenames in root/exec directories first
  for (const dir of dirs) {
    for (const base of priorityNames) {
      for (const ext of logoExts) {
        const candidate = path.join(dir, `${base}${ext}`);
        if (fs.existsSync(candidate)) {
          // Skip default generated assets/icon.* unless nothing else is in root
          if (dir.endsWith('assets') && base === 'icon') continue;
          return candidate;
        }
      }
    }
  }

  // 2. Check any image file placed directly inside the program root folder
  const rootDirs = [
    path.resolve(__dirname, '..', '..'),
    path.dirname(process.execPath),
    path.resolve(path.dirname(process.execPath), '..', '..')
  ];
  for (const rDir of rootDirs) {
    if (!fs.existsSync(rDir)) continue;
    try {
      const entries = fs.readdirSync(rDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (logoExts.includes(ext)) {
          return path.join(rDir, entry.name);
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. Fallback to assets/logo.png or assets/icon.png
  const fallbackPng = path.resolve(__dirname, '..', '..', 'assets', 'icon.png');
  if (fs.existsSync(fallbackPng)) return fallbackPng;
  return null;
}

async function syncProgramLogoAndIcon() {
  const foundPath = findUserLogoFile();
  if (!foundPath) return null;

  try {
    const pngBuf = await sharp(foundPath, { failOn: 'none' })
      .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    cachedLogoBuffer = pngBuf;
    cachedLogoMime = 'image/png';

    // Also update assets/icon.png and assets/icon.ico if a custom logo was dropped
    const assetsDir = path.resolve(__dirname, '..', '..', 'assets');
    if (fs.existsSync(assetsDir) && !foundPath.startsWith(assetsDir)) {
      const icoBuf = buildIcoFromPng(pngBuf);
      await fsp.writeFile(path.join(assetsDir, 'icon.png'), pngBuf).catch(() => {});
      await fsp.writeFile(path.join(assetsDir, 'icon.ico'), icoBuf).catch(() => {});
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      const nImg = nativeImage.createFromBuffer(pngBuf);
      if (!nImg.isEmpty()) {
        mainWindow.setIcon(nImg);
      }
      mainWindow.webContents.send('app:logo-updated', `imgplus://logo?t=${Date.now()}`);
    }
    return foundPath;
  } catch (err) {
    console.error('Logo sync error:', err);
    return foundPath;
  }
}

function setupLogoWatchers() {
  const watchDirs = [
    path.resolve(__dirname, '..', '..'),
    path.dirname(process.execPath),
    path.resolve(path.dirname(process.execPath), '..', '..')
  ];
  const seen = new Set();
  for (const d of watchDirs) {
    if (!d || seen.has(d) || !fs.existsSync(d)) continue;
    seen.add(d);
    try {
      let debounceTimer = null;
      fs.watch(d, (_eventType, filename) => {
        if (!filename) return;
        const ext = path.extname(filename).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.webp', '.ico', '.svg', '.bmp'].includes(ext)) {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            syncProgramLogoAndIcon();
          }, 250);
        }
      });
    } catch {
      // ignore watch errors
    }
  }
}

// ==================== FOLDER & FILE RESOLUTION ====================

function extractTargetFromArgv(argv) {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  for (const arg of args) {
    if (!arg || arg.startsWith('-')) continue;
    try {
      const resolved = path.resolve(arg);
      if (fs.existsSync(resolved)) {
        const stat = fs.statSync(resolved);
        if (stat.isFile()) {
          const ext = path.extname(resolved).toLowerCase();
          if (ALL_SUPPORTED_EXTS.has(ext)) return resolved;
        } else if (stat.isDirectory()) {
          return resolved;
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

async function scanDirectoryImages(dirPath) {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (ALL_SUPPORTED_EXTS.has(ext)) {
      files.push({
        name: entry.name,
        path: path.join(dirPath, entry.name),
        ext: ext.replace('.', '').toUpperCase(),
        isRaw: RAW_DNG_EXTS.has(ext)
      });
    }
  }
  files.sort((a, b) => naturalCollator.compare(a.name, b.name));
  return files;
}

async function resolveFolderContext(targetPath) {
  const stat = await fsp.stat(targetPath);
  let dirPath;
  let activeFilePath = null;

  if (stat.isDirectory()) {
    dirPath = targetPath;
  } else {
    dirPath = path.dirname(targetPath);
    activeFilePath = path.resolve(targetPath);
  }

  const files = await scanDirectoryImages(dirPath);
  let currentIndex = 0;

  if (activeFilePath) {
    const foundIdx = files.findIndex(
      f => f.path.toLowerCase() === activeFilePath.toLowerCase()
    );
    if (foundIdx !== -1) {
      currentIndex = foundIdx;
    } else {
      const ext = path.extname(activeFilePath).toLowerCase();
      files.unshift({
        name: path.basename(activeFilePath),
        path: activeFilePath,
        ext: ext.replace('.', '').toUpperCase(),
        isRaw: RAW_DNG_EXTS.has(ext)
      });
      currentIndex = 0;
    }
  }

  return {
    directory: dirPath,
    files,
    currentIndex,
    activeFile: files[currentIndex] || null
  };
}

app.on('open-file', async (event, filePath) => {
  event.preventDefault();
  if (mainWindow && mainWindow.webContents) {
    const ctx = await resolveFolderContext(filePath).catch(() => null);
    if (ctx) mainWindow.webContents.send('app:open-context', ctx);
  } else {
    pendingOpenFilePath = filePath;
  }
});

function createMainWindow() {
  const savedSettings = loadSettingsSync();
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;

  const defaultW = Math.min(1380, Math.round(screenW * 0.82));
  const defaultH = Math.min(860, Math.round(screenH * 0.84));

  const bounds = savedSettings.windowBounds || {};
  const winWidth = bounds.width && bounds.width >= 720 ? bounds.width : defaultW;
  const winHeight = bounds.height && bounds.height >= 480 ? bounds.height : defaultH;

  const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.ico');

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: typeof bounds.x === 'number' ? bounds.x : undefined,
    y: typeof bounds.y === 'number' ? bounds.y : undefined,
    minWidth: 720,
    minHeight: 480,
    center: typeof bounds.x !== 'number',
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d12',
    show: false,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', async () => {
    await syncProgramLogoAndIcon();
    if (bounds.isMaximized) {
      mainWindow.maximize();
    }
    mainWindow.show();
    mainWindow.hide();
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true);
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(false);
  });

  const persistBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isFullScreen() && !mainWindow.isMaximized()) {
      const b = mainWindow.getBounds();
      saveSettingsSync({
        windowBounds: { ...b, isMaximized: false }
      });
    } else if (mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
      const current = loadSettingsSync().windowBounds || {};
      saveSettingsSync({
        windowBounds: { ...current, isMaximized: true }
      });
    }
  };

  mainWindow.on('resized', persistBounds);
  mainWindow.on('moved', persistBounds);

  mainWindow.on('maximize', () => {
    persistBounds();
    mainWindow.webContents.send('window:state-changed', getWindowState());
  });
  mainWindow.on('unmaximize', () => {
    persistBounds();
    mainWindow.webContents.send('window:state-changed', getWindowState());
  });
  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('window:state-changed', getWindowState());
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('window:state-changed', getWindowState());
  });
}

function getWindowState() {
  if (!mainWindow) return { isMaximized: false, isFullScreen: false };
  return {
    isMaximized: mainWindow.isMaximized(),
    isFullScreen: mainWindow.isFullScreen()
  };
}

app.whenReady().then(async () => {
  await syncProgramLogoAndIcon();
  setupLogoWatchers();

  // Automatically register file associations on first launch on a new PC
  const currentSettings = loadSettingsSync();
  if (!currentSettings.autoRegisteredAssociations && process.platform === 'win32') {
    registerWindowsDefaultViewer({ openWindowsSettings: false })
      .then(() => saveSettingsSync({ autoRegisteredAssociations: true }))
      .catch(() => {});
  }

  protocol.handle('imgplus', async (request) => {
    try {
      const urlObj = new URL(request.url);
      const action = urlObj.hostname; // 'view', 'thumb', or 'logo'

      if (action === 'logo') {
        if (!cachedLogoBuffer) {
          await syncProgramLogoAndIcon();
        }
        if (cachedLogoBuffer) {
          return new Response(cachedLogoBuffer, {
            headers: {
              'Content-Type': cachedLogoMime,
              'Cache-Control': 'no-cache'
            }
          });
        }
        return new Response('No logo', { status: 404 });
      }

      const filePath = urlObj.searchParams.get('path');
      if (!filePath) {
        return new Response('Missing path', { status: 400 });
      }

      if (action === 'thumb') {
        const thumb = await generateThumbnail(filePath);
        return new Response(thumb.buffer, {
          headers: {
            'Content-Type': thumb.mimeType,
            'Cache-Control': 'private, max-age=3600'
          }
        });
      }

      const ext = path.extname(filePath).toLowerCase();
      if (NATIVE_WEB_EXTS.has(ext)) {
        return await net.fetch(pathToFileURL(filePath).toString());
      }

      const displayable = await getDisplayableImageBuffer(filePath);
      if (displayable && displayable.buffer) {
        return new Response(displayable.buffer, {
          headers: {
            'Content-Type': displayable.mimeType,
            'X-Fast-Preview': displayable.isFastPreview ? '1' : '0',
            'Cache-Control': 'private, max-age=3600'
          }
        });
      }

      return await net.fetch(pathToFileURL(filePath).toString());
    } catch (err) {
      console.error('Protocol error:', err);
      return new Response('Failed to decode image', { status: 500 });
    }
  });

  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ==================== IPC HANDLERS ====================

ipcMain.handle('settings:get', () => {
  const settings = loadSettingsSync();
  // Ensure initial auto-detected language is persisted on first launch
  saveSettingsSync(settings);
  return {
    ...settings,
    appVersion: APP_VERSION,
    systemLocale: app.getLocale()
  };
});

ipcMain.handle('settings:save', (_event, partial) => {
  return saveSettingsSync(partial);
});

ipcMain.handle('shell:open-external', async (_event, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    await shell.openExternal(url);
  }
  return { success: true };
});

ipcMain.handle('app:get-initial-context', async () => {
  const cliTarget = pendingOpenFilePath || extractTargetFromArgv(process.argv);
  if (cliTarget) {
    try {
      return await resolveFolderContext(cliTarget);
    } catch (err) {
      console.error('Failed to load CLI target:', err);
    }
  }

  const candidateSamples = [
    path.join(process.resourcesPath || '', 'samples'),
    path.join(__dirname, '..', '..', 'samples'),
    path.join(path.dirname(process.execPath), 'samples'),
    path.join(path.dirname(process.execPath), '..', '..', 'samples')
  ];
  for (const samplesDir of candidateSamples) {
    if (samplesDir && fs.existsSync(samplesDir)) {
      try {
        const ctx = await resolveFolderContext(samplesDir);
        if (ctx.files.length > 0) return ctx;
      } catch {
        // ignore
      }
    }
  }

  return null;
});

ipcMain.handle('folder:open-from-path', async (_event, targetPath) => {
  return await resolveFolderContext(targetPath);
});

ipcMain.handle('dialog:open-file', async () => {
  const extArray = Array.from(ALL_SUPPORTED_EXTS).map(e => e.replace('.', ''));
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'ImageView+',
    properties: ['openFile'],
    filters: [
      { name: 'All Supported Images (DNG, WebP, TGA, TIFF, PSD, JPG, PNG, GIF, BMP...)', extensions: extArray },
      { name: 'RAW & DNG Photos', extensions: ['dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'orf', 'rw2', 'pef', 'raf', 'srw'] },
      { name: 'Standard & Pro Formats', extensions: ['webp', 'avif', 'png', 'apng', 'jpg', 'jpeg', 'gif', 'bmp', 'tga', 'tif', 'tiff', 'psd', 'svg', 'ico', 'heic', 'ppm', 'pcx', 'hdr'] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return null;
  return await resolveFolderContext(result.filePaths[0]);
});

ipcMain.handle('dialog:open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'ImageView+',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths.length) return null;
  return await resolveFolderContext(result.filePaths[0]);
});

ipcMain.handle('image:get-metadata', async (_event, filePath) => {
  return await extractImageMetadata(filePath);
});

ipcMain.handle('image:copy-to-clipboard', async (_event, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  let pngBuffer;

  if (RAW_DNG_EXTS.has(ext)) {
    const preview = await extractDngFastPreview(filePath, 'preview');
    pngBuffer = await sharp(preview.buffer).png().toBuffer();
  } else if (CUSTOM_DECODE_EXTS.has(ext)) {
    const displayable = await getDisplayableImageBuffer(filePath);
    pngBuffer = await sharp(displayable.buffer).png().toBuffer();
  } else {
    pngBuffer = await sharp(filePath, { failOn: 'none' }).rotate().png().toBuffer();
  }

  const nImg = nativeImage.createFromBuffer(pngBuffer);
  clipboard.writeImage(nImg);
  return { success: true };
});

ipcMain.handle('image:copy-path', (_event, filePath) => {
  clipboard.writeText(filePath);
  return { success: true };
});

ipcMain.handle('image:set-wallpaper', async (_event, filePath) => {
  return await setAsDesktopWallpaper(filePath);
});

ipcMain.handle('image:reveal-in-explorer', (_event, filePath) => {
  shell.showItemInFolder(filePath);
  return { success: true };
});

ipcMain.handle('image:delete-to-trash', async (_event, filePath) => {
  await shell.trashItem(filePath);
  return { success: true };
});

ipcMain.handle('assoc:check', async () => {
  return await checkWindowsViewerRegistration();
});

ipcMain.handle('assoc:register', async (_event, options) => {
  return await registerWindowsDefaultViewer(options);
});

ipcMain.handle('assoc:unregister', async () => {
  return await unregisterWindowsDefaultViewer();
});

ipcMain.handle('assoc:open-win-settings', async () => {
  await shell.openExternal('ms-settings:defaultapps');
  return { success: true };
});

ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window:toggle-maximize', () => {
  if (!mainWindow) return getWindowState();
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return getWindowState();
});

ipcMain.handle('window:toggle-fullscreen', () => {
  if (!mainWindow) return getWindowState();
  const nextState = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(nextState);
  return { isMaximized: mainWindow.isMaximized(), isFullScreen: nextState };
});

ipcMain.handle('window:set-fullscreen', (_event, flag) => {
  if (!mainWindow) return getWindowState();
  mainWindow.setFullScreen(Boolean(flag));
  return { isMaximized: mainWindow.isMaximized(), isFullScreen: Boolean(flag) };
});

ipcMain.handle('window:get-state', () => {
  return getWindowState();
});

ipcMain.handle('window:close', () => {
  if (mainWindow) mainWindow.close();
});
