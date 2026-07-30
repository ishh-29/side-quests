const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggle-always-on-top'),

  spotifyLogin: () => ipcRenderer.invoke('spotify:login'),
  spotifyTryResume: () => ipcRenderer.invoke('spotify:try-resume'),
  spotifyRefresh: () => ipcRenderer.invoke('spotify:refresh'),
  spotifyLogout: () => ipcRenderer.invoke('spotify:logout'),
  spotifyHasSession: () => ipcRenderer.invoke('spotify:has-session'),
  spotifyClientStatus: () => ipcRenderer.invoke('spotify:get-client-status'),

  onSpotifyTokens: (cb) => ipcRenderer.on('spotify:tokens', (_e, tokens) => cb(tokens)),
  onSpotifyAuthError: (cb) => ipcRenderer.on('spotify:auth-error', (_e, msg) => cb(msg))
});
