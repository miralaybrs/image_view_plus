const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const exifr = require('exifr');

// 1. Native hardware-accelerated formats in Chromium/Blink
const NATIVE_WEB_EXTS = new Set([
  '.jpg', '.jpeg', '.jpe', '.jfif',
  '.png', '.apng',
  '.webp',
  '.gif',
  '.bmp', '.dib',
  '.svg', '.svgz',
  '.avif',
  '.ico', '.cur'
]);

// 2. Camera RAW & DNG formats
const RAW_DNG_EXTS = new Set([
  '.dng', '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.srf', '.sr2',
  '.orf', '.rw2', '.raw', '.pef', '.raf', '.srw', '.erf', '.kdc',
  '.dcr', '.3fr', '.fff', '.iiq', '.mef', '.mos', '.mrw', '.rwl', '.x3f'
]);

// 3. Sharp/libvips direct conversion formats
const SHARP_CONVERT_EXTS = new Set([
  '.tiff', '.tif', '.heic', '.heif', '.jp2', '.j2k', '.jxl'
]);

// 4. Custom binary format decoders (TGA, Netpbm PPM/PGM/PNM, PSD, HDR, PCX)
const CUSTOM_DECODE_EXTS = new Set([
  '.tga', '.icb', '.vda', '.vst',
  '.ppm', '.pgm', '.pbm', '.pnm',
  '.psd',
  '.hdr', '.pic',
  '.pcx'
]);

const ALL_SUPPORTED_EXTS = new Set([
  ...NATIVE_WEB_EXTS,
  ...RAW_DNG_EXTS,
  ...SHARP_CONVERT_EXTS,
  ...CUSTOM_DECODE_EXTS
]);

class MemoryLRUCache {
  constructor(maxEntries = 36) {
    this.maxEntries = maxEntries;
    this.map = new Map();
  }
  get(key) {
    if (!this.map.has(key)) return null;
    const val = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }
  set(key, val) {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
    this.map.set(key, val);
  }
  clear() {
    this.map.clear();
  }
}

const previewCache = new MemoryLRUCache(32);
const thumbCache = new MemoryLRUCache(320);

// ==================== CUSTOM FORMAT DECODERS ====================

/**
 * Truevision TGA (.tga) Decoder:
 * Supports uncompressed & RLE-compressed 8-bit grayscale, 16-bit, 24-bit BGR, and 32-bit BGRA TGA files.
 */
function decodeTgaToRgba(buf) {
  if (buf.length < 18) throw new Error('Invalid TGA header');
  const idLength = buf.readUInt8(0);
  const colorMapType = buf.readUInt8(1);
  const imageType = buf.readUInt8(2);
  const cmFirstEntry = buf.readUInt16LE(3);
  const cmLength = buf.readUInt16LE(5);
  const cmEntrySize = buf.readUInt8(7);
  const width = buf.readUInt16LE(12);
  const height = buf.readUInt16LE(14);
  const pixelDepth = buf.readUInt8(16);
  const descriptor = buf.readUInt8(17);

  if (width <= 0 || height <= 0 || width > 16384 || height > 16384) {
    throw new Error('Invalid TGA dimensions');
  }

  const bytesPerPixel = Math.ceil(pixelDepth / 8);
  const colorMapBytes = colorMapType === 1 ? cmLength * Math.ceil(cmEntrySize / 8) : 0;
  let offset = 18 + idLength + colorMapBytes;

  const totalPixels = width * height;
  const rawPixels = Buffer.alloc(totalPixels * 4);
  const isRle = imageType >= 9 && imageType <= 11;

  function readPixel(srcOff, dstIdx) {
    if (pixelDepth === 32) {
      rawPixels[dstIdx] = buf[srcOff + 2];     // R
      rawPixels[dstIdx + 1] = buf[srcOff + 1]; // G
      rawPixels[dstIdx + 2] = buf[srcOff];     // B
      rawPixels[dstIdx + 3] = buf[srcOff + 3]; // A
    } else if (pixelDepth === 24) {
      rawPixels[dstIdx] = buf[srcOff + 2];     // R
      rawPixels[dstIdx + 1] = buf[srcOff + 1]; // G
      rawPixels[dstIdx + 2] = buf[srcOff];     // B
      rawPixels[dstIdx + 3] = 255;
    } else if (pixelDepth === 16 || pixelDepth === 15) {
      const v = buf.readUInt16LE(srcOff);
      rawPixels[dstIdx] = ((v >> 10) & 0x1f) << 3;
      rawPixels[dstIdx + 1] = ((v >> 5) & 0x1f) << 3;
      rawPixels[dstIdx + 2] = (v & 0x1f) << 3;
      rawPixels[dstIdx + 3] = 255;
    } else {
      const g = buf[srcOff];
      rawPixels[dstIdx] = g;
      rawPixels[dstIdx + 1] = g;
      rawPixels[dstIdx + 2] = g;
      rawPixels[dstIdx + 3] = 255;
    }
  }

  if (!isRle) {
    for (let i = 0; i < totalPixels && offset + bytesPerPixel <= buf.length; i++) {
      readPixel(offset, i * 4);
      offset += bytesPerPixel;
    }
  } else {
    let pixelIdx = 0;
    while (pixelIdx < totalPixels && offset < buf.length) {
      const packetHeader = buf[offset++];
      const count = (packetHeader & 0x7f) + 1;
      if (packetHeader & 0x80) {
        // RLE packet
        for (let j = 0; j < count && pixelIdx < totalPixels; j++) {
          readPixel(offset, pixelIdx * 4);
          pixelIdx++;
        }
        offset += bytesPerPixel;
      } else {
        // Raw packet
        for (let j = 0; j < count && pixelIdx < totalPixels && offset + bytesPerPixel <= buf.length; j++) {
          readPixel(offset, pixelIdx * 4);
          offset += bytesPerPixel;
          pixelIdx++;
        }
      }
    }
  }

  // Flip vertically if origin is bottom-left (bit 5 of descriptor == 0)
  const topOrigin = (descriptor & 0x20) !== 0;
  if (!topOrigin) {
    const rowBytes = width * 4;
    const tempRow = Buffer.alloc(rowBytes);
    for (let y = 0; y < Math.floor(height / 2); y++) {
      const topOff = y * rowBytes;
      const botOff = (height - 1 - y) * rowBytes;
      rawPixels.copy(tempRow, 0, topOff, topOff + rowBytes);
      rawPixels.copy(rawPixels, topOff, botOff, botOff + rowBytes);
      tempRow.copy(rawPixels, botOff, 0, rowBytes);
    }
  }

  return { rgba: rawPixels, width, height };
}

/**
 * Netpbm (.ppm, .pgm, .pnm) Decoder
 */
function decodeNetpbmToRgba(buf) {
  const magic = buf.toString('ascii', 0, 2);
  if (!['P2', 'P3', 'P5', 'P6'].includes(magic)) {
    throw new Error('Unsupported Netpbm format');
  }
  let pos = 2;
  const nextToken = () => {
    while (pos < buf.length) {
      const c = buf[pos];
      if (c === 35) { // '#' comment
        while (pos < buf.length && buf[pos] !== 10) pos++;
      } else if (c <= 32) {
        pos++;
      } else {
        break;
      }
    }
    let start = pos;
    while (pos < buf.length && buf[pos] > 32 && buf[pos] !== 35) pos++;
    return buf.toString('ascii', start, pos);
  };

  const width = parseInt(nextToken(), 10);
  const height = parseInt(nextToken(), 10);
  const maxVal = parseInt(nextToken(), 10) || 255;
  pos++; // single whitespace after maxVal

  const totalPixels = width * height;
  const rgba = Buffer.alloc(totalPixels * 4);

  if (magic === 'P6') {
    for (let i = 0; i < totalPixels && pos + 2 < buf.length; i++) {
      rgba[i * 4] = buf[pos++];
      rgba[i * 4 + 1] = buf[pos++];
      rgba[i * 4 + 2] = buf[pos++];
      rgba[i * 4 + 3] = 255;
    }
  } else if (magic === 'P5') {
    for (let i = 0; i < totalPixels && pos < buf.length; i++) {
      const v = buf[pos++];
      rgba[i * 4] = v;
      rgba[i * 4 + 1] = v;
      rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }
  } else if (magic === 'P3') {
    for (let i = 0; i < totalPixels; i++) {
      rgba[i * 4] = Math.round((parseInt(nextToken(), 10) / maxVal) * 255);
      rgba[i * 4 + 1] = Math.round((parseInt(nextToken(), 10) / maxVal) * 255);
      rgba[i * 4 + 2] = Math.round((parseInt(nextToken(), 10) / maxVal) * 255);
      rgba[i * 4 + 3] = 255;
    }
  } else if (magic === 'P2') {
    for (let i = 0; i < totalPixels; i++) {
      const v = Math.round((parseInt(nextToken(), 10) / maxVal) * 255);
      rgba[i * 4] = v;
      rgba[i * 4 + 1] = v;
      rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }
  }

  return { rgba, width, height };
}

/**
 * ZSoft PCX (.pcx) Decoder
 */
function decodePcxToRgba(buf) {
  if (buf.length < 128 || buf[0] !== 0x0a) throw new Error('Invalid PCX header');
  const bitsPerPixel = buf[3];
  const xmin = buf.readUInt16LE(4);
  const ymin = buf.readUInt16LE(6);
  const xmax = buf.readUInt16LE(8);
  const ymax = buf.readUInt16LE(10);
  const numPlanes = buf[65];
  const bytesPerLine = buf.readUInt16LE(66);

  const width = xmax - xmin + 1;
  const height = ymax - ymin + 1;
  const rgba = Buffer.alloc(width * height * 4);

  const scanlineSize = numPlanes * bytesPerLine;
  let offset = 128;

  // Read optional 256-color palette at end of file
  let palette = null;
  if (bitsPerPixel === 8 && numPlanes === 1 && buf.length > 769 && buf[buf.length - 769] === 0x0c) {
    palette = buf.subarray(buf.length - 768);
  }

  const lineBuf = Buffer.alloc(scanlineSize);
  for (let y = 0; y < height; y++) {
    let idx = 0;
    while (idx < scanlineSize && offset < buf.length) {
      const byte = buf[offset++];
      if ((byte & 0xc0) === 0xc0) {
        const count = byte & 0x3f;
        const val = buf[offset++] || 0;
        for (let k = 0; k < count && idx < scanlineSize; k++) lineBuf[idx++] = val;
      } else {
        lineBuf[idx++] = byte;
      }
    }

    for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 4;
      if (numPlanes >= 3 && bitsPerPixel === 8) {
        rgba[dst] = lineBuf[x];
        rgba[dst + 1] = lineBuf[bytesPerLine + x];
        rgba[dst + 2] = lineBuf[2 * bytesPerLine + x];
        rgba[dst + 3] = 255;
      } else if (palette) {
        const pIdx = lineBuf[x] * 3;
        rgba[dst] = palette[pIdx];
        rgba[dst + 1] = palette[pIdx + 1];
        rgba[dst + 2] = palette[pIdx + 2];
        rgba[dst + 3] = 255;
      } else {
        const g = lineBuf[x];
        rgba[dst] = g;
        rgba[dst + 1] = g;
        rgba[dst + 2] = g;
        rgba[dst + 3] = 255;
      }
    }
  }

  return { rgba, width, height };
}

/**
 * Decodes custom formats (.tga, .ppm, .pgm, .pnm, .pcx, .psd, .hdr) into PNG/JPEG via Sharp.
 */
async function decodeCustomFormat(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buf = await fsp.readFile(filePath);

  if (['.tga', '.icb', '.vda', '.vst'].includes(ext)) {
    const { rgba, width, height } = decodeTgaToRgba(buf);
    const out = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
    return { buffer: out, mimeType: 'image/png', width, height };
  }

  if (['.ppm', '.pgm', '.pbm', '.pnm'].includes(ext)) {
    const { rgba, width, height } = decodeNetpbmToRgba(buf);
    const out = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
    return { buffer: out, mimeType: 'image/png', width, height };
  }

  if (ext === '.pcx') {
    const { rgba, width, height } = decodePcxToRgba(buf);
    const out = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
    return { buffer: out, mimeType: 'image/png', width, height };
  }

  // Fallback for PSD or other formats: try sharp directly or scan embedded JPEG resource
  try {
    const out = await sharp(buf, { failOn: 'none' }).png().toBuffer();
    return { buffer: out, mimeType: 'image/png' };
  } catch {
    // Scan for embedded JPEG thumbnail in PSD
    const soi = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
    const eoi = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
    if (soi !== -1 && eoi > soi) {
      return { buffer: buf.subarray(soi, eoi + 2), mimeType: 'image/jpeg' };
    }
    throw new Error(`Unsupported custom format: ${ext}`);
  }
}

// ==================== TIFF / DNG FAST PREVIEW ENGINE ====================

async function parseTiffIfdsForPreviews(fileHandle, fileSize) {
  const headerBuf = Buffer.alloc(8);
  const { bytesRead } = await fileHandle.read(headerBuf, 0, 8, 0);
  if (bytesRead < 8) return null;

  const byteOrder = headerBuf.toString('ascii', 0, 2);
  const isLE = byteOrder === 'II';
  const isBE = byteOrder === 'MM';
  if (!isLE && !isBE) return null;

  const readU16 = (buf, off) => (isLE ? buf.readUInt16LE(off) : buf.readUInt16BE(off));
  const readU32 = (buf, off) => (isLE ? buf.readUInt32LE(off) : buf.readUInt32BE(off));

  const magic = readU16(headerBuf, 2);
  if (magic !== 42 && magic !== 0x4f52 && magic !== 0x55) return null;

  const firstIfdOffset = readU32(headerBuf, 4);
  const visitedOffsets = new Set();
  const ifdQueue = [firstIfdOffset];
  const candidates = [];
  let mainOrientation = 1;
  let maxRawWidth = 0;
  let maxRawHeight = 0;

  const TYPE_SIZES = {
    1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1,
    7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8
  };

  async function readIfdValueArray(type, count, valueOffsetBuf) {
    const unitSize = TYPE_SIZES[type] || 1;
    const totalBytes = unitSize * count;
    let dataBuf;
    if (totalBytes <= 4) {
      dataBuf = valueOffsetBuf;
    } else {
      const ptr = readU32(valueOffsetBuf, 0);
      if (ptr + totalBytes > fileSize) return [];
      dataBuf = Buffer.alloc(Math.min(totalBytes, 65536));
      await fileHandle.read(dataBuf, 0, dataBuf.length, ptr);
    }

    const actualCount = Math.min(count, Math.floor(dataBuf.length / unitSize));
    const values = [];
    for (let i = 0; i < actualCount; i++) {
      const off = i * unitSize;
      if (type === 3) values.push(readU16(dataBuf, off));
      else if (type === 4) values.push(readU32(dataBuf, off));
      else if (type === 1) values.push(dataBuf.readUInt8(off));
      else values.push(readU32(dataBuf, 0));
    }
    return values;
  }

  while (ifdQueue.length > 0 && visitedOffsets.size < 32) {
    const ifdOffset = ifdQueue.shift();
    if (!ifdOffset || ifdOffset >= fileSize - 2 || visitedOffsets.has(ifdOffset)) continue;
    visitedOffsets.add(ifdOffset);

    const countBuf = Buffer.alloc(2);
    await fileHandle.read(countBuf, 0, 2, ifdOffset);
    const numEntries = readU16(countBuf, 0);
    if (numEntries <= 0 || numEntries > 512) continue;

    const entriesBytes = numEntries * 12;
    if (ifdOffset + 2 + entriesBytes > fileSize) continue;

    const entriesBuf = Buffer.alloc(entriesBytes + 4);
    await fileHandle.read(entriesBuf, 0, entriesBuf.length, ifdOffset + 2);

    const info = {
      subfileType: 0,
      width: 0,
      height: 0,
      compression: 0,
      photometric: 0,
      orientation: 0,
      jpegOffset: 0,
      jpegLength: 0,
      stripOffsets: [],
      stripByteCounts: []
    };

    for (let i = 0; i < numEntries; i++) {
      const base = i * 12;
      const tag = readU16(entriesBuf, base);
      const type = readU16(entriesBuf, base + 2);
      const count = readU32(entriesBuf, base + 4);
      const valSlice = entriesBuf.subarray(base + 8, base + 12);

      switch (tag) {
        case 0x00fe: {
          const vals = await readIfdValueArray(type, count, valSlice);
          if (vals.length) info.subfileType = vals[0];
          break;
        }
        case 0x0100: {
          const vals = await readIfdValueArray(type, count, valSlice);
          if (vals.length) info.width = vals[0];
          break;
        }
        case 0x0101: {
          const vals = await readIfdValueArray(type, count, valSlice);
          if (vals.length) info.height = vals[0];
          break;
        }
        case 0x0103: {
          const vals = await readIfdValueArray(type, count, valSlice);
          if (vals.length) info.compression = vals[0];
          break;
        }
        case 0x0106: {
          const vals = await readIfdValueArray(type, count, valSlice);
          if (vals.length) info.photometric = vals[0];
          break;
        }
        case 0x0111: {
          info.stripOffsets = await readIfdValueArray(type, count, valSlice);
          break;
        }
        case 0x0112: {
          const vals = await readIfdValueArray(type, count, valSlice);
          if (vals.length && vals[0] >= 1 && vals[0] <= 8) {
            info.orientation = vals[0];
            if (mainOrientation === 1) mainOrientation = vals[0];
          }
          break;
        }
        case 0x0117: {
          info.stripByteCounts = await readIfdValueArray(type, count, valSlice);
          break;
        }
        case 0x014a: {
          const subOffsets = await readIfdValueArray(type, count, valSlice);
          for (const subOff of subOffsets) {
            if (subOff > 0 && subOff < fileSize) ifdQueue.push(subOff);
          }
          break;
        }
        case 0x0201: {
          const vals = await readIfdValueArray(type, count, valSlice);
          if (vals.length) info.jpegOffset = vals[0];
          break;
        }
        case 0x0202: {
          const vals = await readIfdValueArray(type, count, valSlice);
          if (vals.length) info.jpegLength = vals[0];
          break;
        }
        case 0x8769: {
          const exifOffs = await readIfdValueArray(type, count, valSlice);
          for (const eo of exifOffs) {
            if (eo > 0 && eo < fileSize) ifdQueue.push(eo);
          }
          break;
        }
      }
    }

    if (info.width > maxRawWidth && info.height > maxRawHeight) {
      maxRawWidth = info.width;
      maxRawHeight = info.height;
    }

    if (info.jpegOffset > 0 && info.jpegLength > 256 && info.jpegOffset + info.jpegLength <= fileSize) {
      candidates.push({
        offset: info.jpegOffset,
        length: info.jpegLength,
        width: info.width || 0,
        height: info.height || 0,
        subfileType: info.subfileType,
        orientation: info.orientation || mainOrientation
      });
    } else if (
      (info.compression === 7 || info.compression === 6) &&
      info.stripOffsets.length > 0 &&
      info.stripByteCounts.length > 0
    ) {
      const isRawCfa = info.photometric === 32803 || info.photometric === 34892;
      if (!isRawCfa || info.subfileType !== 0) {
        const firstOffset = info.stripOffsets[0];
        const totalLength = info.stripByteCounts.reduce((acc, v) => acc + v, 0);
        if (firstOffset > 0 && totalLength > 256 && firstOffset + totalLength <= fileSize) {
          candidates.push({
            offset: firstOffset,
            length: totalLength,
            width: info.width || 0,
            height: info.height || 0,
            subfileType: info.subfileType,
            orientation: info.orientation || mainOrientation
          });
        }
      }
    }

    if (entriesBuf.length >= entriesBytes + 4) {
      const nextIfd = readU32(entriesBuf, entriesBytes);
      if (nextIfd > 0 && nextIfd < fileSize) {
        ifdQueue.push(nextIfd);
      }
    }
  }

  const validCandidates = [];
  const checkBuf = Buffer.alloc(4);
  for (const c of candidates) {
    await fileHandle.read(checkBuf, 0, 4, c.offset);
    if (checkBuf[0] === 0xff && checkBuf[1] === 0xd8 && checkBuf[2] === 0xff) {
      validCandidates.push(c);
    }
  }

  return {
    candidates: validCandidates,
    mainOrientation,
    maxRawWidth,
    maxRawHeight
  };
}

async function scanEmbeddedJpegsFallback(fileHandle, fileSize) {
  const scanSize = Math.min(fileSize, 16 * 1024 * 1024);
  const buf = Buffer.alloc(scanSize);
  await fileHandle.read(buf, 0, scanSize, 0);

  const jpegs = [];
  let pos = 0;
  while (pos < scanSize - 4) {
    const soi = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]), pos);
    if (soi === -1) break;

    let searchPos = soi + 2048;
    let foundEoi = -1;
    while (searchPos < scanSize - 1) {
      const eoi = buf.indexOf(Buffer.from([0xff, 0xd9]), searchPos);
      if (eoi === -1) break;
      foundEoi = eoi + 2;
      if (foundEoi - soi > 25000) break;
      searchPos = eoi + 2;
    }

    if (foundEoi !== -1) {
      jpegs.push({
        offset: soi,
        length: foundEoi - soi,
        buffer: buf.subarray(soi, foundEoi)
      });
      pos = foundEoi;
    } else {
      pos = soi + 3;
    }
  }

  return jpegs;
}

async function normalizeJpegBuffer(jpegBuf, orientation = 1) {
  try {
    if (!orientation || orientation === 1) return jpegBuf;
    return await sharp(jpegBuf).rotate().jpeg({ quality: 95 }).toBuffer();
  } catch {
    return jpegBuf;
  }
}

async function extractDngFastPreview(filePath, mode = 'preview') {
  const stat = await fsp.stat(filePath);
  const cacheKey = `${filePath}:${stat.mtimeMs}`;

  if (mode === 'thumb') {
    const cachedThumb = thumbCache.get(cacheKey);
    if (cachedThumb) return cachedThumb;
  } else {
    const cachedPreview = previewCache.get(cacheKey);
    if (cachedPreview) return cachedPreview;
  }

  let fileHandle;
  try {
    fileHandle = await fsp.open(filePath, 'r');
    const parsed = await parseTiffIfdsForPreviews(fileHandle, stat.size);

    if (parsed && parsed.candidates.length > 0) {
      const sorted = [...parsed.candidates].sort((a, b) => {
        const areaA = (a.width || 0) * (a.height || 0);
        const areaB = (b.width || 0) * (b.height || 0);
        if (areaA !== areaB && areaA > 0 && areaB > 0) return areaB - areaA;
        return b.length - a.length;
      });

      if (mode === 'thumb') {
        const smallest = [...sorted].reverse().find(c => c.length >= 4096) || sorted[0];
        const rawBuf = Buffer.alloc(smallest.length);
        await fileHandle.read(rawBuf, 0, smallest.length, smallest.offset);
        const thumbBuf = await sharp(rawBuf)
          .rotate()
          .resize({ width: 240, height: 180, fit: 'cover', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
        const result = { buffer: thumbBuf, mimeType: 'image/webp' };
        thumbCache.set(cacheKey, result);
        return result;
      }

      const best = sorted[0];
      const previewBuf = Buffer.alloc(best.length);
      await fileHandle.read(previewBuf, 0, best.length, best.offset);

      const finalBuf = await normalizeJpegBuffer(previewBuf, best.orientation);
      const result = {
        buffer: finalBuf,
        mimeType: 'image/jpeg',
        previewWidth: best.width,
        previewHeight: best.height,
        rawWidth: parsed.maxRawWidth || best.width,
        rawHeight: parsed.maxRawHeight || best.height,
        isFastPreview: true
      };
      previewCache.set(cacheKey, result);
      return result;
    }

    const exifrThumb = await exifr.thumbnailBuffer(filePath).catch(() => null);
    if (exifrThumb && exifrThumb.length > 1024 && mode === 'thumb') {
      const result = { buffer: Buffer.from(exifrThumb), mimeType: 'image/jpeg' };
      thumbCache.set(cacheKey, result);
      return result;
    }

    const scannedJpegs = await scanEmbeddedJpegsFallback(fileHandle, stat.size);
    if (scannedJpegs.length > 0) {
      scannedJpegs.sort((a, b) => b.length - a.length);
      const chosen = mode === 'thumb' ? scannedJpegs[scannedJpegs.length - 1] : scannedJpegs[0];
      const result = {
        buffer: chosen.buffer,
        mimeType: 'image/jpeg',
        isFastPreview: true
      };
      if (mode === 'thumb') thumbCache.set(cacheKey, result);
      else previewCache.set(cacheKey, result);
      return result;
    }

    await fileHandle.close();
    fileHandle = null;

    if (mode === 'thumb') {
      const thumbBuf = await sharp(filePath, { failOn: 'none' })
        .rotate()
        .resize({ width: 240, height: 180, fit: 'cover', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      const result = { buffer: thumbBuf, mimeType: 'image/webp' };
      thumbCache.set(cacheKey, result);
      return result;
    } else {
      const jpegBuf = await sharp(filePath, { failOn: 'none' })
        .rotate()
        .jpeg({ quality: 94 })
        .toBuffer();
      const result = { buffer: jpegBuf, mimeType: 'image/jpeg', isFastPreview: true };
      previewCache.set(cacheKey, result);
      return result;
    }
  } finally {
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
    }
  }
}

async function generateThumbnail(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (RAW_DNG_EXTS.has(ext)) {
    return await extractDngFastPreview(filePath, 'thumb');
  }

  const stat = await fsp.stat(filePath);
  const cacheKey = `${filePath}:${stat.mtimeMs}`;
  const cached = thumbCache.get(cacheKey);
  if (cached) return cached;

  if (CUSTOM_DECODE_EXTS.has(ext)) {
    const decoded = await decodeCustomFormat(filePath);
    const thumbBuf = await sharp(decoded.buffer)
      .resize({ width: 240, height: 180, fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    const res = { buffer: thumbBuf, mimeType: 'image/webp' };
    thumbCache.set(cacheKey, res);
    return res;
  }

  if (ext === '.svg' || ext === '.svgz' || ext === '.ico' || ext === '.cur') {
    const raw = await fsp.readFile(filePath);
    const mime = ext.startsWith('.svg') ? 'image/svg+xml' : 'image/x-icon';
    return { buffer: raw, mimeType: mime };
  }

  const thumbBuf = await sharp(filePath, { failOn: 'none', animated: false })
    .rotate()
    .resize({ width: 240, height: 180, fit: 'cover', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  const result = { buffer: thumbBuf, mimeType: 'image/webp' };
  thumbCache.set(cacheKey, result);
  return result;
}

async function getDisplayableImageBuffer(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (RAW_DNG_EXTS.has(ext)) {
    return await extractDngFastPreview(filePath, 'preview');
  }

  const stat = await fsp.stat(filePath);
  const cacheKey = `${filePath}:${stat.mtimeMs}`;
  const cached = previewCache.get(cacheKey);
  if (cached) return cached;

  if (CUSTOM_DECODE_EXTS.has(ext)) {
    const decoded = await decodeCustomFormat(filePath);
    const res = {
      buffer: decoded.buffer,
      mimeType: decoded.mimeType,
      previewWidth: decoded.width,
      previewHeight: decoded.height,
      isFastPreview: false
    };
    previewCache.set(cacheKey, res);
    return res;
  }

  if (SHARP_CONVERT_EXTS.has(ext)) {
    const buf = await sharp(filePath, { failOn: 'none' })
      .rotate()
      .jpeg({ quality: 95 })
      .toBuffer();
    const res = { buffer: buf, mimeType: 'image/jpeg', isFastPreview: false };
    previewCache.set(cacheKey, res);
    return res;
  }
  return null;
}

async function extractImageMetadata(filePath) {
  const stat = await fsp.stat(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const isRaw = RAW_DNG_EXTS.has(ext);

  let exif = {};
  try {
    exif = (await exifr.parse(filePath, {
      tiff: true,
      exif: true,
      gps: true,
      ifd0: true,
      interop: true,
      translateKeys: true,
      translateValues: true,
      reviveValues: true
    })) || {};
  } catch {
    exif = {};
  }

  let width = exif.ExifImageWidth || exif.ImageWidth || null;
  let height = exif.ExifImageHeight || exif.ImageHeight || null;
  let colorSpace = exif.ColorSpace || 'sRGB';
  let channels = null;
  let hasAlpha = false;

  const cacheKey = `${filePath}:${stat.mtimeMs}`;
  const cached = previewCache.get(cacheKey);
  if (cached && (cached.rawWidth || cached.previewWidth)) {
    width = cached.rawWidth || cached.previewWidth || width;
    height = cached.rawHeight || cached.previewHeight || height;
  } else if (!isRaw && !CUSTOM_DECODE_EXTS.has(ext)) {
    try {
      const sharpMeta = await sharp(filePath, { failOn: 'none' }).metadata();
      width = sharpMeta.width || width;
      height = sharpMeta.height || height;
      colorSpace = sharpMeta.space || colorSpace;
      channels = sharpMeta.channels || null;
      hasAlpha = Boolean(sharpMeta.hasAlpha);
    } catch {
      // ignore
    }
  }

  let shutterSpeed = null;
  if (exif.ExposureTime) {
    const et = Number(exif.ExposureTime);
    if (et > 0 && et < 1) {
      shutterSpeed = `1/${Math.round(1 / et)}s`;
    } else if (et >= 1) {
      shutterSpeed = `${et}s`;
    }
  }

  let aperture = null;
  if (exif.FNumber) {
    aperture = `f/${Number(exif.FNumber).toFixed(1).replace(/\.0$/, '')}`;
  }

  let focalLength = null;
  if (exif.FocalLength) {
    focalLength = `${Math.round(Number(exif.FocalLength))}mm`;
  }

  return {
    fileName: path.basename(filePath),
    filePath,
    directory: path.dirname(filePath),
    extension: ext.replace('.', '').toUpperCase(),
    isRaw,
    isFastPreview: isRaw,
    fileSize: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    createdAt: stat.birthtime.toISOString(),
    width,
    height,
    megapixels: width && height ? ((width * height) / 1_000_000).toFixed(1) : null,
    colorSpace,
    channels,
    hasAlpha,
    cameraMake: exif.Make || null,
    cameraModel: exif.Model || null,
    lensModel: exif.LensModel || exif.Lens || null,
    iso: exif.ISO || exif.PhotographicSensitivity || null,
    aperture,
    shutterSpeed,
    focalLength,
    exposureBias: exif.ExposureCompensation != null ? `${Number(exif.ExposureCompensation).toFixed(1)} EV` : null,
    flash: exif.Flash || null,
    software: exif.Software || null,
    dateTaken: exif.DateTimeOriginal ? new Date(exif.DateTimeOriginal).toISOString() : null,
    gps: exif.latitude && exif.longitude ? { lat: exif.latitude, lng: exif.longitude } : null,
    dngVersion: exif.DNGVersion
      ? (Array.isArray(exif.DNGVersion) || ArrayBuffer.isView(exif.DNGVersion)
          ? Array.from(exif.DNGVersion).join('.')
          : String(exif.DNGVersion).replace(/,/g, '.'))
      : null
  };
}

module.exports = {
  NATIVE_WEB_EXTS,
  RAW_DNG_EXTS,
  SHARP_CONVERT_EXTS,
  CUSTOM_DECODE_EXTS,
  ALL_SUPPORTED_EXTS,
  extractDngFastPreview,
  generateThumbnail,
  getDisplayableImageBuffer,
  extractImageMetadata
};
