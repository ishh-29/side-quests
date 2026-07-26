const { app, BrowserWindow, Tray, Menu, ipcMain, shell, safeStorage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Config: put your own Spotify app's Client ID in config.json (copy from
// config.example.json). Redirect URI must be added to your Spotify app's
// dashboard exactly as: http://127.0.0.1:<redirectPort>/callback
// ---------------------------------------------------------------------------
const CONFIG_PATH = path.join(__dirname, 'config.json');
let config = { spotifyClientId: '', redirectPort: 8888 };
if (fs.existsSync(CONFIG_PATH)) {
  try { config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) }; }
  catch (e) { console.error('Could not parse config.json', e); }
} else if (process.env.SPOTIFY_CLIENT_ID) {
  config.spotifyClientId = process.env.SPOTIFY_CLIENT_ID;
}

const SESSION_PATH = path.join(app.getPath('userData'), 'session.bin');
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing'
].join(' ');

let mainWindow = null;
let tray = null;
let pkceVerifier = null;
let pkceState = null;
let oauthServer = null;

function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const winW = 360, winH = 660;

  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: screenW - winW - 24,
    y: screenH - winH - 24,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: false,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'icon-32.png'));
  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide', click: () => toggleWindow() },
    { label: 'Always on top', type: 'checkbox', click: (item) => mainWindow?.setAlwaysOnTop(item.checked) },
    { type: 'separator' },
    { label: 'Quit Synapse Player', click: () => app.quit() }
  ]);
  tray.setToolTip('Synapse Player');
  tray.setContextMenu(menu);
  tray.on('click', () => toggleWindow());
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else { mainWindow.show(); mainWindow.focus(); }
}

// ---------------------------------------------------------------------------
// Window chrome IPC (custom frameless titlebar controls)
// ---------------------------------------------------------------------------
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:close', () => mainWindow?.hide());
ipcMain.handle('window:toggle-always-on-top', () => {
  const next = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(next);
  return next;
});

// ---------------------------------------------------------------------------
// Encrypted session persistence (refresh token) via Electron safeStorage
// ---------------------------------------------------------------------------
function saveSession(data) {
  try {
    const json = JSON.stringify(data);
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(SESSION_PATH, safeStorage.encryptString(json));
    } else {
      fs.writeFileSync(SESSION_PATH, json, 'utf-8'); // fallback, unencrypted
    }
  } catch (e) { console.error('saveSession failed', e); }
}
function loadSession() {
  try {
    if (!fs.existsSync(SESSION_PATH)) return null;
    const buf = fs.readFileSync(SESSION_PATH);
    if (safeStorage.isEncryptionAvailable()) {
      return JSON.parse(safeStorage.decryptString(buf));
    }
    return JSON.parse(buf.toString('utf-8'));
  } catch (e) { return null; }
}
function clearSession() {
  try { if (fs.existsSync(SESSION_PATH)) fs.unlinkSync(SESSION_PATH); } catch (e) {}
}

ipcMain.handle('spotify:has-session', () => !!loadSession());
ipcMain.handle('spotify:logout', () => { clearSession(); return true; });

// ---------------------------------------------------------------------------
// Spotify PKCE Authorization Code flow.
// A tiny local HTTP server catches the redirect on 127.0.0.1:<port>/callback.
// No client secret is needed (PKCE), so it's safe to keep the client ID
// in this desktop app.
// ---------------------------------------------------------------------------
function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function startOAuthServer() {
  return new Promise((resolve, reject) => {
    if (oauthServer) { try { oauthServer.close(); } catch (e) {} }
    oauthServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${config.redirectPort}`);
      if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }

      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const errorParam = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (errorParam || !code || returnedState !== pkceState) {
        res.end(`<html><body style="font-family:sans-serif;background:#14161a;color:#e8eaf2;padding:40px;">
          <h2>Spotify login failed</h2><p>You can close this window and try again in Synapse Player.</p></body></html>`);
        mainWindow?.webContents.send('spotify:auth-error', errorParam || 'state_mismatch');
        closeOAuthServer();
        return;
      }

      res.end(`<html><body style="font-family:sans-serif;background:#14161a;color:#e8eaf2;padding:40px;">
        <h2>Connected 🎧</h2><p>You can close this window and go back to Synapse Player.</p></body></html>`);

      try {
        const tokens = await exchangeCodeForTokens(code);
        saveSession({ refresh_token: tokens.refresh_token });
        mainWindow?.webContents.send('spotify:tokens', tokens);
      } catch (e) {
        mainWindow?.webContents.send('spotify:auth-error', e.message);
      }
      closeOAuthServer();
    });
    oauthServer.listen(config.redirectPort, '127.0.0.1', () => resolve());
    oauthServer.on('error', reject);
  });
}
function closeOAuthServer() {
  if (oauthServer) { try { oauthServer.close(); } catch (e) {} oauthServer = null; }
}

async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `http://127.0.0.1:${config.redirectPort}/callback`,
    client_id: config.spotifyClientId,
    code_verifier: pkceVerifier
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error('token_exchange_failed_' + res.status);
  return res.json();
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.spotifyClientId
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error('refresh_failed_' + res.status);
  return res.json();
}

ipcMain.handle('spotify:login', async () => {
  if (!config.spotifyClientId) {
    return { error: 'missing_client_id' };
  }
  pkceVerifier = base64url(crypto.randomBytes(64));
  pkceState = base64url(crypto.randomBytes(16));
  const challenge = base64url(crypto.createHash('sha256').update(pkceVerifier).digest());

  await startOAuthServer();

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('client_id', config.spotifyClientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', `http://127.0.0.1:${config.redirectPort}/callback`);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('state', pkceState);

  await shell.openExternal(authUrl.toString());
  return { ok: true };
});

ipcMain.handle('spotify:try-resume', async () => {
  const session = loadSession();
  if (!session || !session.refresh_token) return { ok: false };
  try {
    const tokens = await refreshAccessToken(session.refresh_token);
    if (tokens.refresh_token) saveSession({ refresh_token: tokens.refresh_token });
    return { ok: true, tokens };
  } catch (e) {
    clearSession();
    return { ok: false };
  }
});

ipcMain.handle('spotify:refresh', async () => {
  const session = loadSession();
  if (!session || !session.refresh_token) return { error: 'no_session' };
  try {
    const tokens = await refreshAccessToken(session.refresh_token);
    if (tokens.refresh_token) saveSession({ refresh_token: tokens.refresh_token });
    return tokens;
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('spotify:get-client-status', () => ({
  hasClientId: !!config.spotifyClientId,
  redirectUri: `http://127.0.0.1:${config.redirectPort}/callback`
}));

// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  createWindow();
  createTray();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  // keep the tray icon alive on all platforms instead of quitting
  if (process.platform !== 'darwin') { /* no-op: tray keeps app running */ }
});

app.on('before-quit', () => { closeOAuthServer(); });
