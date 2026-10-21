const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const KEEP_LOCALES = new Set([
  'en-US.pak',
  'en-GB.pak',
  'tr.pak',
  'de.pak',
  'fr.pak',
  'es.pak',
  'ru.pak',
  'zh-CN.pak',
  'ja.pak',
  'ar.pak',
  'pt-BR.pak'
]);

const VC_REDIST_DLLS = [
  'vcruntime140.dll',
  'vcruntime140_1.dll',
  'msvcp140.dll',
  'concrt140.dll',
  'vccorlib140.dll'
];

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  console.log('Running afterPack optimization & standalone DLL bundling on:', appOutDir);

  // 1. Remove heavy license & unused software-vulkan files (~14.5 MB saved)
  const rootRemovals = [
    'LICENSES.chromium.html',
    'LICENSE.electron.txt',
    'vk_swiftshader.dll',
    'vk_swiftshader_icd.json',
    'vulkan-1.dll'
  ];
  for (const file of rootRemovals) {
    const p = path.join(appOutDir, file);
    if (fs.existsSync(p)) {
      await fsp.unlink(p).catch(() => {});
    }
  }

  // 2. Keep only the 10 supported language .pak files in locales/ (~30 MB saved)
  const localesDir = path.join(appOutDir, 'locales');
  if (fs.existsSync(localesDir)) {
    const entries = await fsp.readdir(localesDir);
    for (const entry of entries) {
      if (!KEEP_LOCALES.has(entry)) {
        await fsp.unlink(path.join(localesDir, entry)).catch(() => {});
      }
    }
  }

  // 3. Bundle Visual C++ Runtime DLLs so the app works on ANY fresh Windows PC without prerequisites
  const sys32 = path.join(process.env.WINDIR || 'C:\\Windows', 'System32');
  const sharpLibDir = path.join(
    appOutDir,
    'resources',
    'app',
    'node_modules',
    '@img',
    'sharp-win32-x64',
    'lib'
  );

  for (const dll of VC_REDIST_DLLS) {
    const srcDll = path.join(sys32, dll);
    if (fs.existsSync(srcDll)) {
      await fsp.copyFile(srcDll, path.join(appOutDir, dll)).catch(() => {});
      if (fs.existsSync(sharpLibDir)) {
        await fsp.copyFile(srcDll, path.join(sharpLibDir, dll)).catch(() => {});
      }
    }
  }

  // 4. Ensure logo.png is also placed directly in appOutDir for quick access
  const rootLogo = path.resolve(__dirname, '..', 'logo.png');
  if (fs.existsSync(rootLogo)) {
    await fsp.copyFile(rootLogo, path.join(appOutDir, 'logo.png')).catch(() => {});
  }
};
