(() => {
  const api = window.imageViewAPI;
  const dict = window.I18N_DICTIONARY || {};

  const UI_THEMES = ['ui-liquid-glass', 'ui-dark', 'ui-light'];
  const BG_THEMES = [
    'bg-checkerboard',
    'bg-checkerboard-light',
    'bg-liquid-glass',
    'bg-pure-black',
    'bg-pure-white',
    'bg-neutral-gray',
    'bg-midnight-blue'
  ];

  // Application State
  const state = {
    lang: 'en',
    uiTheme: 'ui-liquid-glass',
    bgTheme: 'bg-checkerboard',
    directory: null,
    files: [],
    currentIndex: -1,
    compareIndex: -1,
    isCompareMode: false,
    syncCompareZoom: true,
    isLoupeMode: false,
    isZenMode: false,
    isFullScreen: false,
    showFilmstrip: true,
    showExif: false,
    wheelMode: 'zoom', // 'zoom' | 'nav'

    // Transform state (Primary)
    scale: 1,
    fitScale: 1,
    panX: 0,
    panY: 0,
    rotation: 0,
    flipH: 1,
    flipV: 1,
    naturalWidth: 0,
    naturalHeight: 0,

    // Transform state (Compare secondary when unlocked)
    compScale: 1,
    compFitScale: 1,
    compPanX: 0,
    compPanY: 0,

    // Slideshow
    slideshowTimer: null,
    slideshowProgressTimer: null,
    slideshowIntervalMs: 3000,

    // Prefetch Cache
    prefetchMap: new Map()
  };

  // DOM Elements
  const el = {
    body: document.body,
    titlebar: document.getElementById('titlebar'),
    brandTrigger: document.getElementById('brand-trigger'),
    brandLogoImg: document.getElementById('brand-logo-img'),
    emptyLogoImg: document.getElementById('empty-logo-img'),
    aboutLogoImg: document.getElementById('about-logo-img'),
    uiThemeBtn: document.getElementById('btn-ui-theme'),
    uiThemeLabel: document.getElementById('ui-theme-label'),
    langSelect: document.getElementById('lang-select'),

    filePill: document.getElementById('file-info-pill'),
    counterBadge: document.getElementById('counter-badge'),
    filenameLabel: document.getElementById('filename-label'),
    formatBadge: document.getElementById('format-badge'),
    zoomBadge: document.getElementById('zoom-badge'),
    perfBadge: document.getElementById('perf-badge'),
    assocDot: document.getElementById('assoc-status-dot'),

    viewport: document.getElementById('viewport'),
    emptyState: document.getElementById('empty-state'),
    stagePrimary: document.getElementById('stage-primary'),
    mainImage: document.getElementById('main-image'),
    primaryTag: document.getElementById('primary-tag'),

    stageCompare: document.getElementById('stage-compare'),
    compareImage: document.getElementById('compare-image'),
    compareFilename: document.getElementById('compare-filename'),
    btnSyncZoom: document.getElementById('btn-sync-zoom'),
    btnSwapCompare: document.getElementById('btn-swap-compare'),
    btnCloseCompare: document.getElementById('btn-close-compare'),

    loupeLens: document.getElementById('loupe-lens'),
    navPrev: document.getElementById('nav-prev'),
    navNext: document.getElementById('nav-next'),
    minimap: document.getElementById('minimap'),
    minimapImg: document.getElementById('minimap-img'),
    minimapRect: document.getElementById('minimap-rect'),
    zenHint: document.getElementById('zen-hint'),

    floatingToolbar: document.getElementById('floating-toolbar'),
    filmstripBar: document.getElementById('filmstrip-bar'),
    filmstripTrack: document.getElementById('filmstrip-track'),

    exifPanel: document.getElementById('exif-panel'),
    histogramCanvas: document.getElementById('histogram-canvas'),

    slideshowBar: document.getElementById('slideshow-bar'),
    slideshowFill: document.getElementById('slideshow-fill'),

    modalAssoc: document.getElementById('modal-assoc'),
    assocModalStatus: document.getElementById('assoc-modal-status'),
    modalHelp: document.getElementById('modal-help'),
    toastContainer: document.getElementById('toast-container')
  };

  // ==================== LOCALIZATION (10 LANGUAGES) ====================
  function t(key) {
    const langTable = dict[state.lang] || dict.en || {};
    return langTable[key] || (dict.en && dict.en[key]) || key;
  }

  function applyLanguage(langCode, persist = false) {
    const validLang = dict[langCode] ? langCode : 'en';
    state.lang = validLang;
    el.langSelect.value = validLang;
    document.documentElement.lang = validLang;

    document.querySelectorAll('[data-i18n]').forEach((node) => {
      const key = node.getAttribute('data-i18n');
      if (key) node.textContent = t(key);
    });

    updateUiThemeButtonLabel();
    updateWheelModeLabel();

    if (persist) {
      api.saveSettings({ language: validLang });
    }
  }

  // ==================== UI THEME & CANVAS BACKGROUND ====================
  function applyUiTheme(themeClass, persist = false, notify = false) {
    const normalized = UI_THEMES.includes(themeClass) ? themeClass : 'ui-liquid-glass';
    UI_THEMES.forEach(c => el.body.classList.remove(c));
    el.body.classList.add(normalized);
    state.uiTheme = normalized;
    updateUiThemeButtonLabel();

    if (persist) {
      api.saveSettings({ uiTheme: normalized });
    }
    if (notify) {
      showToast(`${t('toastThemeChanged')} ${el.uiThemeLabel.textContent}`);
    }
  }

  function updateUiThemeButtonLabel() {
    if (state.uiTheme === 'ui-liquid-glass') {
      el.uiThemeLabel.textContent = t('themeLiquid');
    } else if (state.uiTheme === 'ui-dark') {
      el.uiThemeLabel.textContent = t('themeDark');
    } else {
      el.uiThemeLabel.textContent = t('themeLight');
    }
  }

  function cycleUiTheme() {
    const idx = UI_THEMES.indexOf(state.uiTheme);
    const next = UI_THEMES[(idx + 1) % UI_THEMES.length];
    applyUiTheme(next, true, true);
  }

  function applyBgTheme(bgClass, persist = false, notify = false) {
    const normalized = BG_THEMES.includes(bgClass) ? bgClass : 'bg-checkerboard';
    BG_THEMES.forEach(c => el.body.classList.remove(c));
    el.body.classList.add(normalized);
    state.bgTheme = normalized;

    if (persist) {
      api.saveSettings({ bgTheme: normalized });
    }
    if (notify) {
      const bgKeyMap = {
        'bg-checkerboard': 'bgCheckerDark',
        'bg-checkerboard-light': 'bgCheckerLight',
        'bg-liquid-glass': 'bgLiquidGlass',
        'bg-pure-black': 'bgPureBlack',
        'bg-pure-white': 'bgPureWhite',
        'bg-neutral-gray': 'bgNeutralGray',
        'bg-midnight-blue': 'bgMidnightBlue'
      };
      showToast(`${t('toastBgChanged')} ${t(bgKeyMap[normalized] || 'bgCheckerDark')}`);
    }
  }

  function cycleBgTheme() {
    const idx = BG_THEMES.indexOf(state.bgTheme);
    const next = BG_THEMES[(idx + 1) % BG_THEMES.length];
    applyBgTheme(next, true, true);
  }

  function updateWheelModeLabel() {
    const wheelBtn = document.getElementById('dock-wheel-mode');
    if (wheelBtn) {
      wheelBtn.textContent = state.wheelMode === 'zoom' ? t('wheelZoom') : t('wheelNav');
    }
  }

  // ==================== LOGO LOADER ====================
  function refreshLogoImages(customUrl) {
    const url = customUrl || api.getLogoUrl();
    [el.brandLogoImg, el.emptyLogoImg, el.aboutLogoImg].forEach((img) => {
      if (img) img.src = url;
    });
  }

  // ==================== UTILITIES ====================
  function showToast(msg, duration = 2300) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    el.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s ease';
      setTimeout(() => toast.remove(), 220);
    }, duration);
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
  }

  function formatDateLocalized(isoStr) {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      return d.toLocaleString(state.lang, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoStr;
    }
  }

  // ==================== PREFETCH ENGINE (0ms Transitions) ====================
  function prefetchNeighbors(centerIdx) {
    if (!state.files.length) return;
    const offsets = [1, -1, 2, -2, 3];
    for (const off of offsets) {
      const idx = (centerIdx + off + state.files.length) % state.files.length;
      const item = state.files[idx];
      if (!item || state.prefetchMap.has(item.path)) continue;

      if (state.prefetchMap.size >= 14) {
        const oldestKey = state.prefetchMap.keys().next().value;
        state.prefetchMap.delete(oldestKey);
      }

      const preImg = new Image();
      preImg.decoding = 'async';
      preImg.src = api.getViewUrl(item.path);
      if (preImg.decode) {
        preImg.decode().catch(() => {});
      }
      state.prefetchMap.set(item.path, preImg);
    }
  }

  // ==================== FOLDER & IMAGE LOADING ====================
  function applyFolderContext(ctx) {
    if (!ctx || !ctx.files || ctx.files.length === 0) return;

    state.directory = ctx.directory;
    state.files = ctx.files;
    state.prefetchMap.clear();

    el.emptyState.classList.add('hidden');
    el.stagePrimary.classList.remove('hidden');
    el.filePill.classList.remove('hidden');
    el.floatingToolbar.classList.remove('hidden');

    if (state.files.length > 1) {
      el.navPrev.classList.remove('hidden');
      el.navNext.classList.remove('hidden');
    } else {
      el.navPrev.classList.add('hidden');
      el.navNext.classList.add('hidden');
    }

    el.filmstripBar.classList.toggle('hidden', !state.showFilmstrip);
    el.exifPanel.classList.toggle('hidden', !state.showExif);

    renderFilmstrip();
    selectImageByIndex(ctx.currentIndex || 0);
  }

  async function selectImageByIndex(index) {
    if (!state.files.length) return;
    const count = state.files.length;
    const normalizedIdx = ((index % count) + count) % count;
    state.currentIndex = normalizedIdx;
    const currentFile = state.files[normalizedIdx];

    const t0 = performance.now();
    const viewUrl = api.getViewUrl(currentFile.path);

    state.rotation = 0;
    state.flipH = 1;
    state.flipV = 1;

    el.counterBadge.textContent = `${normalizedIdx + 1} / ${count}`;
    el.filenameLabel.textContent = currentFile.name;
    el.filenameLabel.title = currentFile.path;
    el.formatBadge.textContent = currentFile.isRaw ? `${currentFile.ext} RAW` : currentFile.ext;
    el.formatBadge.classList.toggle('raw', Boolean(currentFile.isRaw));
    document.title = `${currentFile.name} — ImageView+ v1.2`;

    updateActiveFilmstripItem();

    const prefetched = state.prefetchMap.get(currentFile.path);
    if (prefetched && prefetched.complete && prefetched.naturalWidth > 0) {
      el.mainImage.src = prefetched.src;
      onMainImageLoaded(t0, true);
    } else {
      el.mainImage.onload = () => onMainImageLoaded(t0, false);
      el.mainImage.src = viewUrl;
    }

    prefetchNeighbors(normalizedIdx);

    if (state.isCompareMode) {
      if (state.compareIndex === -1 || state.compareIndex === normalizedIdx) {
        const nextIdx = (normalizedIdx + 1) % count;
        setCompareImageByIndex(nextIdx);
      }
    }

    refreshMetadataAndHistogram(currentFile.path);
  }

  function onMainImageLoaded(startTime, wasPrefetched) {
    const elapsed = Math.max(0.2, performance.now() - startTime);
    el.perfBadge.textContent = wasPrefetched
      ? `${elapsed.toFixed(1)} ms ⚡`
      : `${Math.round(elapsed)} ms`;

    state.naturalWidth = el.mainImage.naturalWidth || 1;
    state.naturalHeight = el.mainImage.naturalHeight || 1;
    el.minimapImg.src = el.mainImage.src;

    fitImageToStage();

    if (state.showExif) {
      requestAnimationFrame(() => drawLiveHistogram(el.mainImage));
    }
  }

  function setCompareImageByIndex(idx) {
    if (!state.files.length) return;
    const count = state.files.length;
    const norm = ((idx % count) + count) % count;
    state.compareIndex = norm;
    const compFile = state.files[norm];
    el.compareFilename.textContent = `${compFile.name} (${compFile.ext})`;
    el.compareImage.onload = () => {
      fitCompareImageToStage();
    };
    el.compareImage.src = api.getViewUrl(compFile.path);
    updateActiveFilmstripItem();
  }

  // ==================== ZOOM, PAN & TRANSFORM ENGINE ====================
  function computeStageFitScale(stageEl, imgW, imgH, rotationDeg) {
    const rect = stageEl.getBoundingClientRect();
    const pad = state.isFullScreen || state.isZenMode ? 8 : 44;
    const availW = Math.max(64, rect.width - pad);
    const availH = Math.max(64, rect.height - pad);

    const isRotated90 = Math.abs(rotationDeg % 180) === 90;
    const effW = isRotated90 ? imgH : imgW;
    const effH = isRotated90 ? imgW : imgH;

    if (!effW || !effH) return 1;
    return Math.min(availW / effW, availH / effH, 1);
  }

  function fitImageToStage() {
    if (!state.naturalWidth || !state.naturalHeight) return;
    state.fitScale = computeStageFitScale(
      el.stagePrimary,
      state.naturalWidth,
      state.naturalHeight,
      state.rotation
    );
    state.scale = state.fitScale;
    state.panX = 0;
    state.panY = 0;
    applyTransforms();
  }

  function fitCompareImageToStage() {
    const w = el.compareImage.naturalWidth || 1;
    const h = el.compareImage.naturalHeight || 1;
    state.compFitScale = computeStageFitScale(el.stageCompare, w, h, 0);
    state.compScale = state.syncCompareZoom ? state.scale : state.compFitScale;
    state.compPanX = state.syncCompareZoom ? state.panX : 0;
    state.compPanY = state.syncCompareZoom ? state.panY : 0;
    applyTransforms();
  }

  function setActualSize1to1() {
    state.scale = 1;
    state.panX = 0;
    state.panY = 0;
    if (state.syncCompareZoom) {
      state.compScale = 1;
      state.compPanX = 0;
      state.compPanY = 0;
    }
    applyTransforms();
    showToast('1:1 (100%)');
  }

  function zoomAtPoint(factor, clientX, clientY, isSecondaryStage = false) {
    if (!state.files.length) return;
    const targetStage = isSecondaryStage && !state.syncCompareZoom ? el.stageCompare : el.stagePrimary;
    const rect = targetStage.getBoundingClientRect();
    const cx = clientX != null ? clientX - (rect.left + rect.width / 2) : 0;
    const cy = clientY != null ? clientY - (rect.top + rect.height / 2) : 0;

    if (isSecondaryStage && !state.syncCompareZoom) {
      const prev = state.compScale;
      const next = Math.min(40, Math.max(0.05, prev * factor));
      const ratio = next / prev;
      state.compPanX = cx - (cx - state.compPanX) * ratio;
      state.compPanY = cy - (cy - state.compPanY) * ratio;
      state.compScale = next;
    } else {
      const prev = state.scale;
      const next = Math.min(40, Math.max(0.05, prev * factor));
      const ratio = next / prev;
      state.panX = cx - (cx - state.panX) * ratio;
      state.panY = cy - (cy - state.panY) * ratio;
      state.scale = next;

      if (state.syncCompareZoom) {
        state.compScale = next;
        state.compPanX = state.panX;
        state.compPanY = state.panY;
      }
    }

    applyTransforms();
  }

  function applyTransforms() {
    const { scale, panX, panY, rotation, flipH, flipV } = state;
    el.mainImage.style.transform =
      `translate3d(${panX}px, ${panY}px, 0) scale(${scale}) rotate(${rotation}deg) scale(${flipH}, ${flipV})`;
    el.mainImage.classList.toggle('pixelated', scale >= 3);

    const pct = Math.round(scale * 100);
    el.zoomBadge.textContent = `${pct}%`;

    if (state.isCompareMode) {
      const cs = state.syncCompareZoom ? scale : state.compScale;
      const cx = state.syncCompareZoom ? panX : state.compPanX;
      const cy = state.syncCompareZoom ? panY : state.compPanY;
      el.compareImage.style.transform =
        `translate3d(${cx}px, ${cy}px, 0) scale(${cs})`;
      el.compareImage.classList.toggle('pixelated', cs >= 3);
    }

    updateMinimap();
  }

  function updateMinimap() {
    if (!state.files.length || state.scale <= state.fitScale * 1.35 || state.isZenMode || state.isFullScreen) {
      el.minimap.classList.add('hidden');
      return;
    }
    el.minimap.classList.remove('hidden');

    const stageRect = el.stagePrimary.getBoundingClientRect();
    const imgW = state.naturalWidth * state.scale;
    const imgH = state.naturalHeight * state.scale;

    const visW = Math.min(1, stageRect.width / imgW);
    const visH = Math.min(1, stageRect.height / imgH);

    const centerOffX = -state.panX / imgW;
    const centerOffY = -state.panY / imgH;

    const boxW = Math.max(12, visW * 120);
    const boxH = Math.max(12, visH * 84);
    const leftPct = Math.min(88, Math.max(2, (0.5 + centerOffX - visW / 2) * 100));
    const topPct = Math.min(85, Math.max(2, (0.5 + centerOffY - visH / 2) * 100));

    el.minimapRect.style.width = `${boxW}px`;
    el.minimapRect.style.height = `${boxH}px`;
    el.minimapRect.style.left = `${leftPct}%`;
    el.minimapRect.style.top = `${topPct}%`;
  }

  // ==================== LOUPE / MAGNIFIER (L Key) ====================
  function toggleLoupeMode() {
    state.isLoupeMode = !state.isLoupeMode;
    document.getElementById('btn-loupe-mode').classList.toggle('active', state.isLoupeMode);
    if (!state.isLoupeMode) {
      el.loupeLens.classList.add('hidden');
    }
  }

  function updateLoupePosition(e) {
    if (!state.isLoupeMode || !state.files.length) {
      el.loupeLens.classList.add('hidden');
      return;
    }
    const imgRect = el.mainImage.getBoundingClientRect();
    if (
      e.clientX < imgRect.left ||
      e.clientX > imgRect.right ||
      e.clientY < imgRect.top ||
      e.clientY > imgRect.bottom
    ) {
      el.loupeLens.classList.add('hidden');
      return;
    }

    el.loupeLens.classList.remove('hidden');
    const lensSize = 210;
    const zoomMult = 3;

    el.loupeLens.style.left = `${e.clientX - lensSize / 2}px`;
    el.loupeLens.style.top = `${e.clientY - lensSize / 2}px`;
    el.loupeLens.style.backgroundImage = `url("${el.mainImage.src}")`;

    const relX = (e.clientX - imgRect.left) / imgRect.width;
    const relY = (e.clientY - imgRect.top) / imgRect.height;

    const bgW = imgRect.width * zoomMult;
    const bgH = imgRect.height * zoomMult;
    const bgPosX = -(relX * bgW - lensSize / 2);
    const bgPosY = -(relY * bgH - lensSize / 2);

    el.loupeLens.style.backgroundSize = `${bgW}px ${bgH}px`;
    el.loupeLens.style.backgroundPosition = `${bgPosX}px ${bgPosY}px`;
  }

  // ==================== SIDE-BY-SIDE COMPARE MODE (C Key) ====================
  function toggleCompareMode() {
    if (!state.files.length) return;
    state.isCompareMode = !state.isCompareMode;
    document.getElementById('btn-compare-mode').classList.toggle('active', state.isCompareMode);
    el.stageCompare.classList.toggle('hidden', !state.isCompareMode);
    el.primaryTag.classList.toggle('hidden', !state.isCompareMode);

    if (state.isCompareMode) {
      const nextIdx = (state.currentIndex + 1) % state.files.length;
      setCompareImageByIndex(nextIdx);
    }
    requestAnimationFrame(() => {
      fitImageToStage();
      if (state.isCompareMode) fitCompareImageToStage();
    });
  }

  // ==================== FILMSTRIP RENDERING ====================
  function renderFilmstrip() {
    el.filmstripTrack.innerHTML = '';
    const fragment = document.createDocumentFragment();

    state.files.forEach((file, idx) => {
      const item = document.createElement('div');
      item.className = 'thumb-item';
      item.dataset.index = String(idx);
      item.title = file.name;

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = api.getThumbUrl(file.path);

      const badge = document.createElement('span');
      badge.className = `thumb-ext ${file.isRaw ? 'raw' : ''}`;
      badge.textContent = file.ext;

      item.appendChild(img);
      item.appendChild(badge);

      item.addEventListener('click', () => {
        selectImageByIndex(idx);
      });

      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!state.isCompareMode) {
          toggleCompareMode();
        }
        setCompareImageByIndex(idx);
      });

      fragment.appendChild(item);
    });

    el.filmstripTrack.appendChild(fragment);
    updateActiveFilmstripItem();
  }

  function updateActiveFilmstripItem() {
    const items = el.filmstripTrack.querySelectorAll('.thumb-item');
    items.forEach((node, idx) => {
      const isMain = idx === state.currentIndex;
      const isComp = state.isCompareMode && idx === state.compareIndex;
      node.classList.toggle('active', isMain);
      node.classList.toggle('compare-selected', isComp);
      if (isMain) {
        node.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    });
  }

  // ==================== EXIF & LIVE RGB HISTOGRAM ====================
  async function refreshMetadataAndHistogram(filePath) {
    try {
      const meta = await api.getMetadata(filePath);
      if (!meta) return;

      const camStr = [meta.cameraMake, meta.cameraModel].filter(Boolean).join(' ') || t('noCameraInfo');
      document.getElementById('meta-camera').textContent = camStr;
      document.getElementById('meta-lens').textContent = meta.lensModel || (meta.isRaw ? t('rawSensorData') : t('standardImage'));

      document.getElementById('meta-aperture').textContent = meta.aperture || 'f/—';
      document.getElementById('meta-shutter').textContent = meta.shutterSpeed || '—s';
      document.getElementById('meta-iso').textContent = meta.iso ? `ISO ${meta.iso}` : 'ISO —';
      document.getElementById('meta-focal').textContent = meta.focalLength || '—mm';

      document.getElementById('meta-filename').textContent = meta.fileName;
      document.getElementById('meta-format').textContent = meta.isRaw
        ? `${meta.extension} (Fast Preview ⚡)`
        : meta.extension;

      const w = meta.width || state.naturalWidth;
      const h = meta.height || state.naturalHeight;
      const mp = w && h ? `${((w * h) / 1_000_000).toFixed(1)} MP` : '';
      document.getElementById('meta-dimensions').textContent = w && h ? `${w} × ${h} (${mp})` : '—';
      document.getElementById('meta-filesize').textContent = formatBytes(meta.fileSize);
      document.getElementById('meta-colorspace').textContent = meta.colorSpace || 'sRGB';
      document.getElementById('meta-date').textContent = formatDateLocalized(meta.dateTaken || meta.modifiedAt);
      document.getElementById('meta-software').textContent = meta.dngVersion
        ? `DNG v${meta.dngVersion}${meta.software ? ' · ' + meta.software : ''}`
        : (meta.software || '—');

      const fpEl = document.getElementById('meta-filepath');
      fpEl.textContent = meta.filePath;
      fpEl.onclick = async () => {
        await api.copyFilePath(meta.filePath);
        showToast(t('toastPathCopied'));
      };
    } catch (err) {
      console.error('EXIF error:', err);
    }
  }

  function drawLiveHistogram(imgElement) {
    if (!imgElement || !imgElement.naturalWidth) return;
    const canvas = el.histogramCanvas;
    const ctx = canvas.getContext('2d');
    const cw = canvas.width;
    const ch = canvas.height;

    const sampleCanvas = document.createElement('canvas');
    const sw = 192;
    const sh = 144;
    sampleCanvas.width = sw;
    sampleCanvas.height = sh;
    const sCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    sCtx.drawImage(imgElement, 0, 0, sw, sh);

    const { data } = sCtx.getImageData(0, 0, sw, sh);
    const rBins = new Uint32Array(256);
    const gBins = new Uint32Array(256);
    const bBins = new Uint32Array(256);
    const lBins = new Uint32Array(256);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      rBins[r]++;
      gBins[g]++;
      bBins[b]++;
      const luma = Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b));
      lBins[luma]++;
    }

    let maxVal = 1;
    for (let i = 2; i < 254; i++) {
      maxVal = Math.max(maxVal, rBins[i], gBins[i], bBins[i], lBins[i]);
    }

    ctx.clearRect(0, 0, cw, ch);

    const drawChannel = (bins, strokeColor, fillColor) => {
      ctx.beginPath();
      ctx.moveTo(0, ch);
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * cw;
        const norm = Math.min(1, bins[i] / maxVal);
        const y = ch - norm * (ch - 8);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(cw, ch);
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    };

    ctx.globalCompositeOperation = 'screen';
    drawChannel(rBins, 'rgba(244, 63, 94, 0.9)', 'rgba(244, 63, 94, 0.25)');
    drawChannel(gBins, 'rgba(52, 211, 153, 0.9)', 'rgba(52, 211, 153, 0.25)');
    drawChannel(bBins, 'rgba(56, 189, 248, 0.9)', 'rgba(56, 189, 248, 0.25)');
    drawChannel(lBins, 'rgba(248, 250, 252, 0.7)', 'rgba(248, 250, 252, 0.1)');
    ctx.globalCompositeOperation = 'source-over';
  }

  // ==================== SLIDESHOW (S Key) ====================
  function toggleSlideshow() {
    if (!state.files.length) return;
    if (state.slideshowTimer) {
      stopSlideshow();
      showToast(t('toastSlideStop'));
    } else {
      startSlideshow();
      showToast(t('toastSlideStart'));
    }
  }

  function startSlideshow() {
    el.slideshowBar.classList.remove('hidden');
    document.getElementById('dock-slideshow').classList.add('active');
    let elapsed = 0;
    const step = 100;

    state.slideshowProgressTimer = setInterval(() => {
      elapsed += step;
      const pct = Math.min(100, (elapsed / state.slideshowIntervalMs) * 100);
      el.slideshowFill.style.width = `${pct}%`;
    }, step);

    state.slideshowTimer = setInterval(() => {
      elapsed = 0;
      el.slideshowFill.style.width = '0%';
      selectImageByIndex(state.currentIndex + 1);
    }, state.slideshowIntervalMs);
  }

  function stopSlideshow() {
    if (state.slideshowTimer) clearInterval(state.slideshowTimer);
    if (state.slideshowProgressTimer) clearInterval(state.slideshowProgressTimer);
    state.slideshowTimer = null;
    state.slideshowProgressTimer = null;
    el.slideshowBar.classList.add('hidden');
    el.slideshowFill.style.width = '0%';
    document.getElementById('dock-slideshow').classList.remove('active');
  }

  // ==================== TRUE FULLSCREEN & ZEN FRAMELESS MODE ====================
  async function toggleFullScreenMode() {
    const winState = await api.toggleFullScreen();
    state.isFullScreen = winState.isFullScreen;
    updateZenAndFullscreenChrome();
    setTimeout(() => fitImageToStage(), 70);
  }

  function toggleZenMode() {
    state.isZenMode = !state.isZenMode;
    document.getElementById('btn-zen-mode').classList.toggle('active', state.isZenMode);
    updateZenAndFullscreenChrome();
    setTimeout(() => fitImageToStage(), 60);
  }

  function updateZenAndFullscreenChrome() {
    el.body.classList.toggle('fullscreen-mode', state.isFullScreen);
    el.body.classList.toggle('zen-mode', state.isZenMode);
    el.zenHint.classList.toggle('hidden', !(state.isZenMode || state.isFullScreen));
    document.getElementById('dock-fullscreen').classList.toggle('active', state.isFullScreen);
  }

  // ==================== WINDOWS FILE ASSOCIATION MODAL ====================
  async function refreshAssociationStatus() {
    const status = await api.checkAssociation();
    el.assocDot.classList.toggle('registered', Boolean(status && status.registered));
    if (status && status.registered) {
      el.assocModalStatus.textContent = t('assocStatusOk');
    } else {
      el.assocModalStatus.textContent = t('assocStatusNone');
    }
  }

  // ==================== EVENT LISTENERS ====================
  function bindEvents() {
    document.getElementById('win-min').onclick = () => api.minimizeWindow();
    document.getElementById('win-max').onclick = () => api.toggleMaximizeWindow();
    document.getElementById('win-close').onclick = () => api.closeWindow();

    // UI Theme & Language selectors
    el.uiThemeBtn.onclick = cycleUiTheme;
    el.langSelect.onchange = (e) => {
      applyLanguage(e.target.value, true);
      if (state.files[state.currentIndex]) {
        refreshMetadataAndHistogram(state.files[state.currentIndex].path);
      }
      refreshAssociationStatus();
    };

    // File / Folder Open
    const handleOpenFile = async () => {
      const ctx = await api.openFileDialog();
      if (ctx) applyFolderContext(ctx);
    };
    const handleOpenFolder = async () => {
      const ctx = await api.openFolderDialog();
      if (ctx) applyFolderContext(ctx);
    };

    document.getElementById('btn-open-file').onclick = handleOpenFile;
    document.getElementById('btn-empty-open-file').onclick = handleOpenFile;
    document.getElementById('btn-open-folder').onclick = handleOpenFolder;
    document.getElementById('btn-empty-open-folder').onclick = handleOpenFolder;

    // Navigation buttons
    const goPrev = () => selectImageByIndex(state.currentIndex - 1);
    const goNext = () => selectImageByIndex(state.currentIndex + 1);
    el.navPrev.onclick = goPrev;
    el.navNext.onclick = goNext;
    document.getElementById('dock-prev').onclick = goPrev;
    document.getElementById('dock-next').onclick = goNext;
    document.getElementById('dock-slideshow').onclick = toggleSlideshow;

    // Zoom & Fit buttons
    document.getElementById('dock-zoom-in').onclick = () => zoomAtPoint(1.25);
    document.getElementById('dock-zoom-out').onclick = () => zoomAtPoint(0.8);
    document.getElementById('dock-zoom-fit').onclick = () => fitImageToStage();
    document.getElementById('dock-zoom-1to1').onclick = () => setActualSize1to1();

    const wheelModeBtn = document.getElementById('dock-wheel-mode');
    wheelModeBtn.onclick = () => {
      state.wheelMode = state.wheelMode === 'zoom' ? 'nav' : 'zoom';
      updateWheelModeLabel();
      api.saveSettings({ wheelMode: state.wheelMode });
    };

    // Transform & Background buttons
    document.getElementById('dock-rot-left').onclick = () => {
      state.rotation = (state.rotation - 90) % 360;
      applyTransforms();
    };
    document.getElementById('dock-rot-right').onclick = () => {
      state.rotation = (state.rotation + 90) % 360;
      applyTransforms();
    };
    document.getElementById('dock-flip-h').onclick = () => {
      state.flipH *= -1;
      applyTransforms();
    };
    document.getElementById('dock-bg-cycle').onclick = cycleBgTheme;

    // System & Quick Actions
    document.getElementById('dock-copy').onclick = async () => {
      const f = state.files[state.currentIndex];
      if (!f) return;
      await api.copyImageToClipboard(f.path);
      showToast(t('toastCopied'));
    };

    document.getElementById('dock-wallpaper').onclick = async () => {
      const f = state.files[state.currentIndex];
      if (!f) return;
      try {
        await api.setAsWallpaper(f.path);
        showToast(t('toastWallpaperOk'));
      } catch (err) {
        showToast(`Error: ${err.message}`);
      }
    };

    document.getElementById('dock-explorer').onclick = () => {
      const f = state.files[state.currentIndex];
      if (f) api.revealInExplorer(f.path);
    };

    document.getElementById('dock-delete').onclick = async () => {
      const f = state.files[state.currentIndex];
      if (!f) return;
      await api.deleteToTrash(f.path);
      showToast(`${t('toastDeleted')} ${f.name}`);
      state.files.splice(state.currentIndex, 1);
      if (state.files.length === 0) {
        el.stagePrimary.classList.add('hidden');
        el.emptyState.classList.remove('hidden');
        el.filmstripBar.classList.add('hidden');
      } else {
        renderFilmstrip();
        selectImageByIndex(state.currentIndex);
      }
    };

    // Panels & Modes (persisted!)
    const toggleFilmstrip = () => {
      state.showFilmstrip = !state.showFilmstrip;
      el.filmstripBar.classList.toggle('hidden', !state.showFilmstrip || !state.files.length);
      document.getElementById('dock-filmstrip').classList.toggle('active', state.showFilmstrip);
      api.saveSettings({ showFilmstrip: state.showFilmstrip });
      setTimeout(() => fitImageToStage(), 50);
    };

    const toggleExifPanel = () => {
      state.showExif = !state.showExif;
      el.exifPanel.classList.toggle('hidden', !state.showExif);
      document.getElementById('dock-info').classList.toggle('active', state.showExif);
      api.saveSettings({ showExif: state.showExif });
      if (state.showExif) {
        drawLiveHistogram(el.mainImage);
      }
      setTimeout(() => fitImageToStage(), 50);
    };

    document.getElementById('dock-filmstrip').onclick = toggleFilmstrip;
    document.getElementById('dock-info').onclick = toggleExifPanel;
    document.getElementById('btn-close-exif').onclick = toggleExifPanel;

    document.getElementById('btn-fullscreen-top').onclick = toggleFullScreenMode;
    document.getElementById('dock-fullscreen').onclick = toggleFullScreenMode;
    document.getElementById('btn-exit-fullscreen-pill').onclick = async () => {
      if (state.isFullScreen) await api.setFullScreen(false);
      if (state.isZenMode) state.isZenMode = false;
      state.isFullScreen = false;
      updateZenAndFullscreenChrome();
      fitImageToStage();
    };

    document.getElementById('btn-zen-mode').onclick = toggleZenMode;
    document.getElementById('btn-loupe-mode').onclick = toggleLoupeMode;
    document.getElementById('btn-compare-mode').onclick = toggleCompareMode;
    el.btnCloseCompare.onclick = toggleCompareMode;

    el.btnSyncZoom.onclick = () => {
      state.syncCompareZoom = !state.syncCompareZoom;
      el.btnSyncZoom.classList.toggle('active', state.syncCompareZoom);
      el.btnSyncZoom.textContent = state.syncCompareZoom ? t('syncZoom') : t('independentZoom');
    };

    el.btnSwapCompare.onclick = () => {
      if (!state.isCompareMode || state.compareIndex < 0) return;
      const oldPrimary = state.currentIndex;
      const oldComp = state.compareIndex;
      selectImageByIndex(oldComp);
      setCompareImageByIndex(oldPrimary);
    };

    // Default Viewer Modal
    const openAssocModal = async () => {
      await refreshAssociationStatus();
      el.modalAssoc.classList.remove('hidden');
    };
    document.getElementById('btn-default-viewer').onclick = openAssocModal;
    document.getElementById('btn-empty-assoc').onclick = openAssocModal;
    document.getElementById('btn-close-assoc-modal').onclick = () => el.modalAssoc.classList.add('hidden');

    document.getElementById('btn-do-register').onclick = async () => {
      try {
        await api.registerAssociation({ openWindowsSettings: false });
        await refreshAssociationStatus();
        showToast(t('assocStatusOk'), 3200);
      } catch (err) {
        el.assocModalStatus.textContent = `Error: ${err.message}`;
      }
    };

    document.getElementById('btn-open-win-settings').onclick = () => {
      api.openWinDefaultAppsSettings();
    };

    document.getElementById('btn-do-unregister').onclick = async () => {
      await api.unregisterAssociation();
      await refreshAssociationStatus();
    };

    // Help / Guide / Shortcuts / About Modal
    const openHelpModal = () => {
      refreshLogoImages();
      el.modalHelp.classList.remove('hidden');
    };
    document.getElementById('btn-help').onclick = openHelpModal;
    el.brandTrigger.onclick = openHelpModal;
    document.getElementById('btn-close-help-modal').onclick = () => el.modalHelp.classList.add('hidden');

    // Help Modal Tabs
    document.querySelectorAll('.help-tab').forEach((tabBtn) => {
      tabBtn.onclick = () => {
        document.querySelectorAll('.help-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.help-tab-pane').forEach(p => p.classList.add('hidden'));
        tabBtn.classList.add('active');
        const targetId = tabBtn.getAttribute('data-tab');
        const pane = document.getElementById(targetId);
        if (pane) pane.classList.remove('hidden');
      };
    });

    // External Website Link (www.markadestek.com)
    document.getElementById('link-markadestek').onclick = (e) => {
      e.preventDefault();
      api.openExternalUrl('https://www.markadestek.com');
    };

    // Mouse Wheel on Viewport
    el.viewport.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (!state.files.length) return;
        if (state.wheelMode === 'nav' && !e.ctrlKey) {
          if (e.deltaY > 0) selectImageByIndex(state.currentIndex + 1);
          else if (e.deltaY < 0) selectImageByIndex(state.currentIndex - 1);
          return;
        }
        const isSecondary = el.stageCompare.contains(e.target);
        const factor = e.deltaY < 0 ? 1.16 : 1 / 1.16;
        zoomAtPoint(factor, e.clientX, e.clientY, isSecondary);
      },
      { passive: false }
    );

    // Double-Click on Image Stage -> True Fullscreen (or Ctrl+DoubleClick -> 1:1)
    const handleStageDoubleClick = (e) => {
      if (e.target.closest('button') || e.target.closest('.floating-dock')) return;
      if (e.ctrlKey) {
        if (Math.abs(state.scale - 1) < 0.05) fitImageToStage();
        else setActualSize1to1();
      } else {
        toggleFullScreenMode();
      }
    };
    el.stagePrimary.addEventListener('dblclick', handleStageDoubleClick);
    el.stageCompare.addEventListener('dblclick', handleStageDoubleClick);

    // Mouse Drag Panning + Side Mouse Buttons
    let isDragging = false;
    let dragSecondary = false;
    let startX = 0;
    let startY = 0;

    el.viewport.addEventListener('mousedown', (e) => {
      if (e.button === 3) {
        selectImageByIndex(state.currentIndex - 1);
        return;
      }
      if (e.button === 4) {
        selectImageByIndex(state.currentIndex + 1);
        return;
      }
      if (e.button !== 0) return;
      if (e.target.closest('button') || e.target.closest('.floating-dock')) return;
      if (!state.files.length) return;

      isDragging = true;
      dragSecondary = el.stageCompare.contains(e.target) && !state.syncCompareZoom;
      startX = e.clientX - (dragSecondary ? state.compPanX : state.panX);
      startY = e.clientY - (dragSecondary ? state.compPanY : state.panY);
    });

    window.addEventListener('mousemove', (e) => {
      if (state.isLoupeMode) {
        updateLoupePosition(e);
      }
      if (!isDragging) return;
      if (dragSecondary) {
        state.compPanX = e.clientX - startX;
        state.compPanY = e.clientY - startY;
      } else {
        state.panX = e.clientX - startX;
        state.panY = e.clientY - startY;
        if (state.syncCompareZoom) {
          state.compPanX = state.panX;
          state.compPanY = state.panY;
        }
      }
      applyTransforms();
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Drag & Drop Files or Folders
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const files = e.dataTransfer?.files;
      if (!files || !files.length) return;
      const droppedPath = api.getDroppedFilePath(files[0]);
      if (droppedPath) {
        const ctx = await api.openFromPath(droppedPath);
        if (ctx) applyFolderContext(ctx);
      }
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', async (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      if (e.key === 'Escape') {
        if (!el.modalAssoc.classList.contains('hidden')) {
          el.modalAssoc.classList.add('hidden');
          return;
        }
        if (!el.modalHelp.classList.contains('hidden')) {
          el.modalHelp.classList.add('hidden');
          return;
        }
        if (state.isLoupeMode) {
          toggleLoupeMode();
          return;
        }
        if (state.isCompareMode) {
          toggleCompareMode();
          return;
        }
        if (state.isZenMode) {
          toggleZenMode();
          return;
        }
        if (state.isFullScreen) {
          await api.setFullScreen(false);
          state.isFullScreen = false;
          updateZenAndFullscreenChrome();
          fitImageToStage();
          return;
        }
        api.closeWindow();
        return;
      }

      if (e.key === 'F1' || e.key === '?') {
        e.preventDefault();
        el.modalHelp.classList.toggle('hidden');
        return;
      }

      if (e.ctrlKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        if (e.shiftKey) handleOpenFolder();
        else handleOpenFile();
        return;
      }

      if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        const f = state.files[state.currentIndex];
        if (!f) return;
        if (e.shiftKey) {
          await api.copyFilePath(f.path);
          showToast(t('toastPathCopied'));
        } else {
          await api.copyImageToClipboard(f.path);
          showToast(t('toastCopied'));
        }
        return;
      }

      if (e.ctrlKey && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        document.getElementById('dock-wallpaper').click();
        return;
      }

      switch (e.key) {
        case 'ArrowRight':
        case 'd':
        case 'D':
        case ' ':
          e.preventDefault();
          selectImageByIndex(state.currentIndex + 1);
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
        case 'Backspace':
          e.preventDefault();
          selectImageByIndex(state.currentIndex - 1);
          break;
        case 'Home':
          e.preventDefault();
          selectImageByIndex(0);
          break;
        case 'End':
          e.preventDefault();
          selectImageByIndex(state.files.length - 1);
          break;
        case 'f':
        case 'F':
        case 'F11':
          e.preventDefault();
          toggleFullScreenMode();
          break;
        case 'z':
        case 'Z':
        case 'Tab':
          e.preventDefault();
          toggleZenMode();
          break;
        case '1':
          e.preventDefault();
          setActualSize1to1();
          break;
        case '0':
        case 'w':
        case 'W':
          e.preventDefault();
          fitImageToStage();
          break;
        case '+':
        case '=':
          e.preventDefault();
          zoomAtPoint(1.25);
          break;
        case '-':
        case '_':
          e.preventDefault();
          zoomAtPoint(0.8);
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          state.rotation = (state.rotation + (e.shiftKey ? -90 : 90)) % 360;
          applyTransforms();
          break;
        case 'h':
        case 'H':
          e.preventDefault();
          state.flipH *= -1;
          applyTransforms();
          break;
        case 'v':
        case 'V':
          e.preventDefault();
          state.flipV *= -1;
          applyTransforms();
          break;
        case 'i':
        case 'I':
          e.preventDefault();
          toggleExifPanel();
          break;
        case 't':
        case 'T':
          e.preventDefault();
          toggleFilmstrip();
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          toggleCompareMode();
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          toggleLoupeMode();
          break;
        case 's':
        case 'S':
          e.preventDefault();
          toggleSlideshow();
          break;
        case 'b':
        case 'B':
          e.preventDefault();
          cycleBgTheme();
          break;
        case 'u':
        case 'U':
          e.preventDefault();
          cycleUiTheme();
          break;
        case 'e':
        case 'E':
          e.preventDefault();
          document.getElementById('dock-explorer').click();
          break;
        case 'Delete':
          e.preventDefault();
          document.getElementById('dock-delete').click();
          break;
      }
    });

    window.addEventListener('resize', () => {
      if (state.files.length) {
        fitImageToStage();
        if (state.isCompareMode) fitCompareImageToStage();
      }
    });

    api.onOpenContext((ctx) => {
      if (ctx) applyFolderContext(ctx);
    });

    api.onWindowStateChanged((winState) => {
      state.isFullScreen = Boolean(winState.isFullScreen);
      updateZenAndFullscreenChrome();
      setTimeout(() => fitImageToStage(), 60);
    });

    api.onLogoUpdated((logoUrl) => {
      refreshLogoImages(logoUrl);
    });
  }

  // ==================== INITIALIZATION ====================
  async function init() {
    refreshLogoImages();

    // Load saved user settings (or auto-detected Windows language on first launch)
    const saved = await api.getSettings();
    if (saved) {
      applyLanguage(saved.language || 'en', false);
      const savedUi = saved.uiTheme && saved.uiTheme.startsWith('ui-')
        ? saved.uiTheme
        : `ui-${saved.uiTheme || 'liquid-glass'}`;
      applyUiTheme(savedUi, false, false);
      applyBgTheme(saved.bgTheme || 'bg-checkerboard', false, false);

      state.showFilmstrip = saved.showFilmstrip !== false;
      state.showExif = Boolean(saved.showExif);
      state.wheelMode = saved.wheelMode === 'nav' ? 'nav' : 'zoom';

      document.getElementById('dock-filmstrip').classList.toggle('active', state.showFilmstrip);
      document.getElementById('dock-info').classList.toggle('active', state.showExif);
      updateWheelModeLabel();
    }

    bindEvents();
    await refreshAssociationStatus();

    const initialCtx = await api.getInitialContext();
    if (initialCtx && initialCtx.files && initialCtx.files.length > 0) {
      applyFolderContext(initialCtx);
    }
  }

  init();
})();
