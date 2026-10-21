const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

function buildDngBuffer({
  make = 'Leica Camera AG',
  model = 'Leica Q3 DNG',
  software = 'ImageView+ DNG Lab 1.2',
  iso = 100,
  fNumberNum = 17,
  fNumberDen = 10,
  expNum = 1,
  expDen = 1000,
  focalNum = 28,
  focalDen = 1,
  width = 1920,
  height = 1280,
  thumbJpegBuf,
  previewJpegBuf
}) {
  const chunks = [];
  let offset = 0;

  const pushBuf = (b) => {
    chunks.push(b);
    offset += b.length;
    if (b.length % 2 === 1) {
      chunks.push(Buffer.from([0]));
      offset += 1;
    }
  };

  const header = Buffer.alloc(8);
  header.write('II', 0, 'ascii');
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(8, 4);
  pushBuf(header);

  function serializeIfd(entries, nextIfdOffset = 0, baseOffset = offset) {
    entries.sort((a, b) => a.tag - b.tag);
    const ifdHeaderSize = 2 + entries.length * 12 + 4;
    let dataCursor = baseOffset + ifdHeaderSize;

    const ifdBuf = Buffer.alloc(ifdHeaderSize);
    ifdBuf.writeUInt16LE(entries.length, 0);

    const extraData = [];

    entries.forEach((e, i) => {
      const pos = 2 + i * 12;
      ifdBuf.writeUInt16LE(e.tag, pos);
      ifdBuf.writeUInt16LE(e.type, pos + 2);
      ifdBuf.writeUInt32LE(e.count, pos + 4);

      if (Buffer.isBuffer(e.data)) {
        if (e.data.length <= 4) {
          e.data.copy(ifdBuf, pos + 8);
        } else {
          ifdBuf.writeUInt32LE(dataCursor, pos + 8);
          extraData.push(e.data);
          dataCursor += e.data.length;
          if (e.data.length % 2 === 1) {
            extraData.push(Buffer.from([0]));
            dataCursor += 1;
          }
        }
      } else {
        if (e.type === 3) {
          ifdBuf.writeUInt16LE(e.value, pos + 8);
        } else {
          ifdBuf.writeUInt32LE(e.value, pos + 8);
        }
      }
    });

    ifdBuf.writeUInt32LE(nextIfdOffset, 2 + entries.length * 12);
    return Buffer.concat([ifdBuf, ...extraData]);
  }

  const asciiEntry = (tag, str) => {
    const b = Buffer.from(str + '\0', 'ascii');
    return { tag, type: 2, count: b.length, data: b };
  };

  const rationalEntry = (tag, num, den) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(num, 0);
    b.writeUInt32LE(den, 4);
    return { tag, type: 5, count: 1, data: b };
  };

  function assemble(subIfdOffset, exifIfdOffset, thumbDataOffset, previewDataOffset) {
    const ifd0Entries = [
      { tag: 0x00fe, type: 4, count: 1, value: 1 },
      { tag: 0x0100, type: 4, count: 1, value: width },
      { tag: 0x0101, type: 4, count: 1, value: height },
      { tag: 0x0103, type: 3, count: 1, value: 7 },
      asciiEntry(0x010f, make),
      asciiEntry(0x0110, model),
      { tag: 0x0112, type: 3, count: 1, value: 1 },
      asciiEntry(0x0131, software),
      { tag: 0x014a, type: 4, count: 1, value: subIfdOffset },
      { tag: 0x0201, type: 4, count: 1, value: thumbDataOffset },
      { tag: 0x0202, type: 4, count: 1, value: thumbJpegBuf.length },
      { tag: 0x8769, type: 4, count: 1, value: exifIfdOffset },
      { tag: 0xc612, type: 1, count: 4, data: Buffer.from([1, 6, 0, 0]) },
      asciiEntry(0xc614, `${make} ${model}`)
    ];

    const subIfdEntries = [
      { tag: 0x00fe, type: 4, count: 1, value: 0x10001 },
      { tag: 0x0100, type: 4, count: 1, value: width },
      { tag: 0x0101, type: 4, count: 1, value: height },
      { tag: 0x0103, type: 3, count: 1, value: 7 },
      { tag: 0x0106, type: 3, count: 1, value: 6 },
      { tag: 0x0111, type: 4, count: 1, value: previewDataOffset },
      { tag: 0x0112, type: 3, count: 1, value: 1 },
      { tag: 0x0117, type: 4, count: 1, value: previewJpegBuf.length }
    ];

    const exifEntries = [
      rationalEntry(0x829a, expNum, expDen),
      rationalEntry(0x829d, fNumberNum, fNumberDen),
      { tag: 0x8827, type: 3, count: 1, value: iso },
      rationalEntry(0x920a, focalNum, focalDen),
      { tag: 0xa002, type: 4, count: 1, value: width },
      { tag: 0xa003, type: 4, count: 1, value: height },
      asciiEntry(0xa434, `${focalNum}mm f/${(fNumberNum / fNumberDen).toFixed(1)} ASPH`)
    ];

    const bIfd0 = serializeIfd(ifd0Entries, 0, 8);
    const calcSubOff = 8 + bIfd0.length;
    const bSubIfd = serializeIfd(subIfdEntries, 0, calcSubOff);
    const calcExifOff = calcSubOff + bSubIfd.length;
    const bExifIfd = serializeIfd(exifEntries, 0, calcExifOff);
    const calcThumbOff = calcExifOff + bExifIfd.length;
    const calcPrevOff = calcThumbOff + thumbJpegBuf.length + (thumbJpegBuf.length % 2);

    return {
      bIfd0,
      bSubIfd,
      bExifIfd,
      calcSubOff,
      calcExifOff,
      calcThumbOff,
      calcPrevOff
    };
  }

  const pass1 = assemble(0, 0, 0, 0);
  const pass2 = assemble(
    pass1.calcSubOff,
    pass1.calcExifOff,
    pass1.calcThumbOff,
    pass1.calcPrevOff
  );

  pushBuf(pass2.bIfd0);
  pushBuf(pass2.bSubIfd);
  pushBuf(pass2.bExifIfd);
  pushBuf(thumbJpegBuf);
  pushBuf(previewJpegBuf);

  return Buffer.concat(chunks);
}

/**
 * Builds a multi-size Windows .ico containing 256, 128, 64, 48, 32, and 16px PNG images.
 */
async function buildMultiSizeIcoFromImage(sourcePathOrBuf) {
  const sizes = [256, 128, 64, 48, 32, 16];
  const pngBuffers = [];
  for (const s of sizes) {
    const b = await sharp(sourcePathOrBuf)
      .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    pngBuffers.push({ size: s, buf: b });
  }

  const count = pngBuffers.length;
  const headerSize = 6 + count * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  let dataOffset = headerSize;
  pngBuffers.forEach((item, idx) => {
    const pos = 6 + idx * 16;
    header.writeUInt8(item.size === 256 ? 0 : item.size, pos);
    header.writeUInt8(item.size === 256 ? 0 : item.size, pos + 1);
    header.writeUInt8(0, pos + 2);
    header.writeUInt8(0, pos + 3);
    header.writeUInt16LE(1, pos + 4);
    header.writeUInt16LE(32, pos + 6);
    header.writeUInt32LE(item.buf.length, pos + 8);
    header.writeUInt32LE(dataOffset, pos + 12);
    dataOffset += item.buf.length;
  });

  return Buffer.concat([header, ...pngBuffers.map(p => p.buf)]);
}

/**
 * Builds an uncompressed 32-bit BGRA Truevision TGA (.tga) buffer from raw RGBA pixels.
 */
function buildTgaBuffer(rgbaBuf, width, height) {
  const header = Buffer.alloc(18);
  header[2] = 2; // Uncompressed True-Color
  header.writeUInt16LE(width, 12);
  header.writeUInt16LE(height, 14);
  header[16] = 32; // 32-bit
  header[17] = 0x28; // Top-left origin + 8-bit alpha

  const bgra = Buffer.alloc(rgbaBuf.length);
  for (let i = 0; i < rgbaBuf.length; i += 4) {
    bgra[i] = rgbaBuf[i + 2];     // B
    bgra[i + 1] = rgbaBuf[i + 1]; // G
    bgra[i + 2] = rgbaBuf[i];     // R
    bgra[i + 3] = rgbaBuf[i + 3]; // A
  }
  return Buffer.concat([header, bgra]);
}

async function generateAll() {
  const rootDir = path.resolve(__dirname, '..');
  const assetsDir = path.join(rootDir, 'assets');
  const samplesDir = path.join(rootDir, 'samples');

  await fsp.mkdir(assetsDir, { recursive: true });
  await fsp.mkdir(samplesDir, { recursive: true });

  // 1. Convert user's logo.png into assets/icon.ico, assets/icon.png, and assets/logo.png
  const userLogoPath = path.join(rootDir, 'logo.png');
  if (fs.existsSync(userLogoPath)) {
    const icoBuf = await buildMultiSizeIcoFromImage(userLogoPath);
    const png256 = await sharp(userLogoPath)
      .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    await fsp.writeFile(path.join(assetsDir, 'icon.ico'), icoBuf);
    await fsp.writeFile(path.join(assetsDir, 'icon.png'), png256);
    await fsp.copyFile(userLogoPath, path.join(assetsDir, 'logo.png'));
    console.log('Synced user logo.png -> assets/icon.ico & assets/icon.png');
  }

  // 2. Sample 1: 01_Alpine_ProRAW.dng
  const svg1 = `
  <svg width="1920" height="1280" viewBox="0 0 1920 1280" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#070b19"/>
        <stop offset="55%" stop-color="#1e293b"/>
        <stop offset="100%" stop-color="#f59e0b"/>
      </linearGradient>
      <linearGradient id="mtn1" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#334155"/>
        <stop offset="100%" stop-color="#0f172a"/>
      </linearGradient>
    </defs>
    <rect width="1920" height="1280" fill="url(#sky)"/>
    <circle cx="1420" cy="360" r="140" fill="#fde047" opacity="0.88"/>
    <polygon points="0,1280 480,520 1050,1280" fill="url(#mtn1)"/>
    <polygon points="560,1280 1180,380 1780,1280" fill="#1e293b"/>
    <polygon points="1180,380 1340,620 1120,660 1020,610" fill="#f8fafc" opacity="0.85"/>
    <polygon points="1050,1280 1560,590 1920,1040 1920,1280" fill="#0f172a"/>
    <rect x="60" y="60" width="460" height="90" rx="16" fill="#0f172a" opacity="0.78"/>
    <text x="90" y="118" fill="#fcd34d" font-family="Segoe UI, sans-serif" font-size="38" font-weight="bold">DNG RAW · Fast Preview</text>
  </svg>`;

  const preview1 = await sharp(Buffer.from(svg1)).jpeg({ quality: 94 }).toBuffer();
  const thumb1 = await sharp(Buffer.from(svg1)).resize(256, 170).jpeg({ quality: 82 }).toBuffer();
  const dng1 = buildDngBuffer({
    make: 'Leica Camera AG',
    model: 'Leica Q3 DNG',
    iso: 100,
    fNumberNum: 17,
    fNumberDen: 10,
    expNum: 1,
    expDen: 1000,
    focalNum: 28,
    focalDen: 1,
    width: 1920,
    height: 1280,
    thumbJpegBuf: thumb1,
    previewJpegBuf: preview1
  });
  await fsp.writeFile(path.join(samplesDir, '01_Alpine_ProRAW.dng'), dng1);

  // 3. Sample 2: 02_Cyberpunk_Neon.webp
  const svg2 = `
  <svg width="1920" height="1280" viewBox="0 0 1920 1280" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="neon" cx="50%" cy="45%" r="65%">
        <stop offset="0%" stop-color="#38bdf8"/>
        <stop offset="45%" stop-color="#6366f1"/>
        <stop offset="100%" stop-color="#090d16"/>
      </radialGradient>
    </defs>
    <rect width="1920" height="1280" fill="url(#neon)"/>
    <circle cx="960" cy="640" r="340" fill="none" stroke="#f43f5e" stroke-width="18" opacity="0.85"/>
    <circle cx="960" cy="640" r="220" fill="none" stroke="#38bdf8" stroke-width="12" opacity="0.9"/>
    <rect x="60" y="60" width="420" height="90" rx="16" fill="#090d16" opacity="0.78"/>
    <text x="90" y="118" fill="#38bdf8" font-family="Segoe UI, sans-serif" font-size="38" font-weight="bold">WEBP · Zero-Copy GPU</text>
  </svg>`;
  await sharp(Buffer.from(svg2)).webp({ quality: 92 }).toFile(path.join(samplesDir, '02_Cyberpunk_Neon.webp'));

  // 4. Sample 3: 03_Astro_Nebula_RAW.dng
  const svg3 = `
  <svg width="1920" height="1280" viewBox="0 0 1920 1280" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="nebula" cx="55%" cy="45%" r="60%">
        <stop offset="0%" stop-color="#ec4899"/>
        <stop offset="45%" stop-color="#4f46e5"/>
        <stop offset="100%" stop-color="#030712"/>
      </radialGradient>
    </defs>
    <rect width="1920" height="1280" fill="url(#nebula)"/>
    <circle cx="420" cy="300" r="6" fill="#fff"/>
    <circle cx="1520" cy="280" r="8" fill="#fff"/>
    <circle cx="1280" cy="880" r="5" fill="#fff"/>
    <circle cx="980" cy="580" r="160" fill="#fdf4ff" opacity="0.22"/>
    <rect x="60" y="60" width="480" height="90" rx="16" fill="#090d16" opacity="0.78"/>
    <text x="90" y="118" fill="#f472b6" font-family="Segoe UI, sans-serif" font-size="38" font-weight="bold">DNG RAW · Sony A7R V</text>
  </svg>`;
  const preview3 = await sharp(Buffer.from(svg3)).jpeg({ quality: 94 }).toBuffer();
  const thumb3 = await sharp(Buffer.from(svg3)).resize(256, 170).jpeg({ quality: 82 }).toBuffer();
  const dng3 = buildDngBuffer({
    make: 'SONY',
    model: 'ILCE-7RM5',
    iso: 400,
    fNumberNum: 14,
    fNumberDen: 10,
    expNum: 1,
    expDen: 500,
    focalNum: 50,
    focalDen: 1,
    width: 1920,
    height: 1280,
    thumbJpegBuf: thumb3,
    previewJpegBuf: preview3
  });
  await fsp.writeFile(path.join(samplesDir, '03_Astro_Nebula_RAW.dng'), dng3);

  // 5. Sample 4: 04_Transparent_Prism.png (Shows off Default Checkerboard background!)
  const svg4 = `
  <svg width="1600" height="1200" viewBox="0 0 1600 1200" xmlns="http://www.w3.org/2000/svg">
    <polygon points="800,140 1340,980 260,980" fill="rgba(56, 189, 248, 0.38)" stroke="#38bdf8" stroke-width="16"/>
    <polygon points="800,280 1160,880 440,880" fill="rgba(129, 140, 248, 0.48)" stroke="#a5b4fc" stroke-width="10"/>
    <text x="510" y="1080" fill="#f8fafc" font-family="Segoe UI, sans-serif" font-size="40" font-weight="bold">PNG · Alpha Checkerboard</text>
  </svg>`;
  await sharp(Buffer.from(svg4)).png().toFile(path.join(samplesDir, '04_Transparent_Prism.png'));

  // 6. Sample 5: 05_Truevision_Graphic.tga (Truevision TGA 32-bit sample)
  const svgTga = `
  <svg width="640" height="400" viewBox="0 0 640 400" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="tgaGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0ea5e9"/>
        <stop offset="100%" stop-color="#10b981"/>
      </linearGradient>
    </defs>
    <rect x="60" y="50" width="520" height="300" rx="24" fill="url(#tgaGrad)" opacity="0.9"/>
    <text x="150" y="210" fill="#ffffff" font-family="Segoe UI, sans-serif" font-size="28" font-weight="bold">TGA · 32-bit Truevision</text>
  </svg>`;
  const { data: tgaRgba, info: tgaInfo } = await sharp(Buffer.from(svgTga))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const tgaBuf = buildTgaBuffer(tgaRgba, tgaInfo.width, tgaInfo.height);
  await fsp.writeFile(path.join(samplesDir, '05_Truevision_Graphic.tga'), tgaBuf);

  // 7. Sample 6: 06_Studio_Master.tif (TIFF sample)
  await sharp(Buffer.from(svg1)).tiff({ compression: 'lzw' }).toFile(path.join(samplesDir, '06_Studio_Master.tif'));

  console.log('Generated samples (DNG, WebP, PNG, TGA, TIF) and synced custom logo icon!');
}

generateAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
