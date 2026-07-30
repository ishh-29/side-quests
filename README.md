# Synapse Player — Desktop

A frameless, always-on-desktop, neuromorphic dark music widget built with Electron, with
real Spotify playback control via the Spotify Web API.

It runs in two modes:
- **Demo mode** (default): generates its own ambient audio locally, so every control
  actually works with no setup.
- **Spotify mode**: log in with your Spotify account (Premium required) and control
  whatever's playing on any of your active devices — real album art, real track info,
  play/pause/skip/seek/volume/search.

## 1. Install

You need [Node.js](https://nodejs.org) (18+) installed.

```bash
cd synapse-desktop
npm install
```

## 2. Connect it to your own Spotify app (one-time)

Spotify requires every app to have its own registered Client ID — you can't reuse someone
else's. This takes about 2 minutes:

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and
   log in, then **Create app**.
2. Give it any name/description. For **Redirect URI**, add exactly:
   ```
   http://127.0.0.1:8888/callback
   ```
3. Save, then open the app and copy the **Client ID** shown on its settings page.
4. In this project folder, copy `config.example.json` to `config.json` and paste your
   Client ID in:
   ```json
   {
     "spotifyClientId": "paste-your-client-id-here",
     "redirectPort": 8888
   }
   ```
   (No client secret needed — the app uses the PKCE flow, which is safe for a desktop app.)

## 3. Run it

```bash
npm start
```

The widget opens pinned to the bottom-right of your screen, frameless and always visible.
Click the gear icon → **Connect with Spotify** to log in. It opens your normal browser for
the Spotify login/consent screen, then hands control back to the widget automatically.

Your session is remembered (encrypted on disk via Electron's `safeStorage`) so you won't
have to log in again next launch.

**Playback control needs an active Spotify device** — have the official Spotify app (or
spotify.com in a browser) open and playing something on the account you logged in with;
this widget then becomes the remote for it.

## 4. Package it into an installable app

```bash
npm run dist:mac      # .dmg
npm run dist:win      # installer .exe
npm run dist:linux    # .AppImage
```

Output lands in `dist/`. Swap in your own icon by replacing the files in `assets/` if
you'd like a custom look (they're currently the neon "synapse" mark generated for this
widget).

## Notes / things you can extend

- **Tray icon**: click it to show/hide the widget, or quit from its right-click menu.
  Closing the window (red dot) hides it to the tray rather than quitting, so playback
  polling keeps running in the background.
- **Always-on-top**: toggle it from the tray menu if you want the widget to float above
  other windows.
- **Window position/size**: set in `main.js` → `createWindow()`.
- Scopes requested are the minimum needed for read/control:
  `user-read-playback-state`, `user-modify-playback-state`, `user-read-currently-playing`.
  Add more (e.g. `user-library-modify` to make the like button save real Spotify likes)
  in `main.js` → `SCOPES`, and wire the extra endpoint in `renderer/index.html`.
