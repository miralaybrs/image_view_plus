const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('imageViewAPI', {
  // Persistent Settings & Localization
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (partial) => ipcRenderer.invoke('settings:save', partial),
  openExternalUrl: (url) => ipcRenderer.invoke('shell:open-external', url),

  // Initial & CLI / Explorer launch context
  getInitialContext: () => ipcRenderer.invoke('app:get-initial-context'),
  onOpenContext: (callback) => {
    const handler = (_event, ctx) => callback(ctx);
    ipcRenderer.on('app:open-context', handler);
    return () => ipcRenderer.removeListener('app:open-context', handler);
  },

  // Logo & Brand Icon
  getLogoUrl: () => `imgplus://logo?t=${Date.now()}`,
  onLogoUpdated: (callback) => {
    const handler = (_event, logoUrl) => callback(logoUrl);
    ipcRenderer.on('app:logo-updated', handler);
    return () => ipcRenderer.removeListener('app:logo-updated', handler);
  },

  // File & Folder Navigation
  openFromPath: (targetPath) => ipcRenderer.invoke('folder:open-from-path', targetPath),
  openFileDialog: () => ipcRenderer.invoke('dialog:open-file'),
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),
  getDroppedFilePath: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return file.path || null;
    }
  },

  // Image URLs (via custom high-speed imgplus:// protocol)
  getViewUrl: (filePath) => `imgplus://view?path=${encodeURIComponent(filePath)}`,
  getThumbUrl: (filePath) => `imgplus://thumb?path=${encodeURIComponent(filePath)}`,

  // EXIF & Metadata
  getMetadata: (filePath) => ipcRenderer.invoke('image:get-metadata', filePath),

  // Quick Actions
  copyImageToClipboard: (filePath) => ipcRenderer.invoke('image:copy-to-clipboard', filePath),
  copyFilePath: (filePath) => ipcRenderer.invoke('image:copy-path', filePath),
  setAsWallpaper: (filePath) => ipcRenderer.invoke('image:set-wallpaper', filePath),
  revealInExplorer: (filePath) => ipcRenderer.invoke('image:reveal-in-explorer', filePath),
  deleteToTrash: (filePath) => ipcRenderer.invoke('image:delete-to-trash', filePath),

  // Windows Default Viewer & File Associations
  checkAssociation: () => ipcRenderer.invoke('assoc:check'),
  registerAssociation: (options) => ipcRenderer.invoke('assoc:register', options),
  unregisterAssociation: () => ipcRenderer.invoke('assoc:unregister'),
  openWinDefaultAppsSettings: () => ipcRenderer.invoke('assoc:open-win-settings'),

  // Window Management
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  toggleFullScreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  setFullScreen: (flag) => ipcRenderer.invoke('window:set-fullscreen', flag),
  getWindowState: () => ipcRenderer.invoke('window:get-state'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onWindowStateChanged: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('window:state-changed', handler);
    return () => ipcRenderer.removeListener('window:state-changed', handler);
  }
});
