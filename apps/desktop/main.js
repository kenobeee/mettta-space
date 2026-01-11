const { app, BrowserWindow, session, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

const START_URL = process.env.MIRA_DESKTOP_URL;

// Allow custom app:// scheme for local packaged assets
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      allowServiceWorkers: false
    }
  }
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0b1220',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  if (START_URL) {
    win.loadURL(START_URL);
  } else {
    const localIndex = path.join(__dirname, 'web-dist', 'index.html');
    if (!fs.existsSync(localIndex)) {
      throw new Error('web-dist not found. Run web build before packaging desktop.');
    }
    // Serve built web assets via custom protocol to keep absolute paths working
    protocol.handle('app', async (request) => {
      const url = new URL(request.url);
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      const absPath = path.normalize(path.join(__dirname, 'web-dist', pathname));

      // security: ensure path inside web-dist
      const webDistRoot = path.join(__dirname, 'web-dist');
      if (!absPath.startsWith(webDistRoot)) {
        return new Response('Not Found', { status: 404 });
      }

      if (!fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
        return new Response('Not Found', { status: 404 });
      }

      const ext = path.extname(absPath).toLowerCase();
      const mime =
        ext === '.html'
          ? 'text/html'
          : ext === '.js'
          ? 'application/javascript'
          : ext === '.css'
          ? 'text/css'
          : ext === '.svg'
          ? 'image/svg+xml'
          : ext === '.png'
          ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.gif'
          ? 'image/gif'
          : ext === '.json'
          ? 'application/json'
          : 'application/octet-stream';

      return new Response(fs.readFileSync(absPath), {
        headers: { 'Content-Type': mime }
      });
    });
    win.loadURL('app://-/index.html');
  }

  // Optional: open devtools if env set
  if (process.env.MIRA_DEVTOOLS === '1') {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(async () => {
  // Improve audio capture/processing permissions for desktop
  const ses = session.defaultSession;
  await ses.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') return callback(true);
    callback(false);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

