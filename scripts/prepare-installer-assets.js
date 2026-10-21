const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

/**
 * Encodes raw RGB/RGBA pixels (top-down) into an uncompressed 24-bit Windows BMP buffer
 * compatible with NSIS (MUI_WELCOMEFINISHPAGE_BITMAP & MUI_HEADERIMAGE_BITMAP).
 */
function encode24BitBmp(rgbaBuf, width, height) {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelDataSize = rowStride * height;
  const fileSize = 54 + pixelDataSize;

  const bmp = Buffer.alloc(fileSize);
  // BITMAPFILEHEADER (14 bytes)
  bmp.write('BM', 0, 'ascii');
  bmp.writeUInt32LE(fileSize, 2);
  bmp.writeUInt32LE(0, 6);
  bmp.writeUInt32LE(54, 10);

  // BITMAPINFOHEADER (40 bytes)
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22); // Bottom-up DIB
  bmp.writeUInt16LE(1, 26); // Planes
  bmp.writeUInt16LE(24, 28); // 24-bit BGR
  bmp.writeUInt32LE(0, 30); // BI_RGB
  bmp.writeUInt32LE(pixelDataSize, 34);
  bmp.writeInt32LE(2835, 38); // 72 DPI
  bmp.writeInt32LE(2835, 42);
  bmp.writeUInt32LE(0, 46);
  bmp.writeUInt32LE(0, 50);

  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y; // flip vertically for bottom-up BMP
    const dstRowOffset = 54 + y * rowStride;
    for (let x = 0; x < width; x++) {
      const srcIdx = (srcRow * width + x) * 4;
      const dstIdx = dstRowOffset + x * 3;
      bmp[dstIdx] = rgbaBuf[srcIdx + 2];     // B
      bmp[dstIdx + 1] = rgbaBuf[srcIdx + 1]; // G
      bmp[dstIdx + 2] = rgbaBuf[srcIdx];     // R
    }
  }

  return bmp;
}

async function generateInstallerBmps() {
  const rootDir = path.resolve(__dirname, '..');
  const assetsDir = path.join(rootDir, 'assets');
  const logoPath = path.join(rootDir, 'logo.png');

  await fsp.mkdir(assetsDir, { recursive: true });

  // 1. Generate NSIS Sidebar Bitmap (164 x 314) with user's logo.png centered
  const sidebarW = 164;
  const sidebarH = 314;
  const sidebarBgSvg = `
  <svg width="${sidebarW}" height="${sidebarH}" viewBox="0 0 ${sidebarW} ${sidebarH}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sbg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#090d18"/>
        <stop offset="50%" stop-color="#111c35"/>
        <stop offset="100%" stop-color="#070a12"/>
      </linearGradient>
    </defs>
    <rect width="${sidebarW}" height="${sidebarH}" fill="url(#sbg)"/>
    <circle cx="82" cy="105" r="66" fill="#38bdf8" opacity="0.12"/>
    <text x="82" y="210" text-anchor="middle" fill="#f8fafc" font-family="Segoe UI, sans-serif" font-size="17" font-weight="bold">ImageView+</text>
    <text x="82" y="230" text-anchor="middle" fill="#38bdf8" font-family="Segoe UI, sans-serif" font-size="11" font-weight="bold">v1.2 Edition</text>
    <text x="82" y="276" text-anchor="middle" fill="#94a3b8" font-family="Segoe UI, sans-serif" font-size="9.5">Hakan GERMAN</text>
    <text x="82" y="292" text-anchor="middle" fill="#38bdf8" font-family="Segoe UI, sans-serif" font-size="9.5" font-weight="bold">www.markadestek.com</text>
  </svg>`;

  const logoResizedSidebar = await sharp(logoPath)
    .resize(108, 108, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const { data: sidebarRgba } = await sharp(Buffer.from(sidebarBgSvg))
    .composite([{ input: logoResizedSidebar, top: 48, left: 28 }])
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const sidebarBmp = encode24BitBmp(sidebarRgba, sidebarW, sidebarH);
  await fsp.writeFile(path.join(assetsDir, 'installerSidebar.bmp'), sidebarBmp);

  // 2. Generate NSIS Header Bitmap (150 x 57) with user's logo.png
  const headerW = 150;
  const headerH = 57;
  const headerBgSvg = `
  <svg width="${headerW}" height="${headerH}" viewBox="0 0 ${headerW} ${headerH}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="hbg" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#1e293b"/>
      </linearGradient>
    </defs>
    <rect width="${headerW}" height="${headerH}" fill="url(#hbg)"/>
    <text x="18" y="30" fill="#f8fafc" font-family="Segoe UI, sans-serif" font-size="13" font-weight="bold">ImageView+</text>
    <text x="18" y="44" fill="#38bdf8" font-family="Segoe UI, sans-serif" font-size="9.5" font-weight="bold">v1.2 · Marka Destek</text>
  </svg>`;

  const logoResizedHeader = await sharp(logoPath)
    .resize(42, 42, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const { data: headerRgba } = await sharp(Buffer.from(headerBgSvg))
    .composite([{ input: logoResizedHeader, top: 7, left: 100 }])
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const headerBmp = encode24BitBmp(headerRgba, headerW, headerH);
  await fsp.writeFile(path.join(assetsDir, 'installerHeader.bmp'), headerBmp);

  console.log('Generated NSIS installerSidebar.bmp and installerHeader.bmp with custom logo!');
}

generateInstallerBmps().catch((err) => {
  console.error(err);
  process.exit(1);
});
