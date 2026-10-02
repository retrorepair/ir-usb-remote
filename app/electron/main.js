/*
 * Electron main process.
 *
 * Plain CommonJS, so there is no build step for the main process at all --
 * only the renderer goes through Vite.
 *
 * The important part here is the WebHID plumbing. Chromium will not hand a
 * HID device to a page without an explicit grant, and in Electron that grant
 * is the application's decision rather than a user prompt. The handlers below
 * restrict it to HID, and to our vendor configuration interface specifically.
 */
const { app, BrowserWindow, session, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

/* Must match board_config.h and the vendor usage page in usb_descriptors.c. */
const CONFIG_USAGE_PAGE = 0xff00;

/*
 * USB vendor IDs this app is willing to talk to.
 *
 * 0x1209 is the pid.codes range the firmware defaults to. If you rebuild the
 * firmware with your own allocation (see docs/branding.md), add it here as
 * well, or the configurator will refuse to open your hardware.
 */
const ALLOWED_VENDOR_IDS = new Set([0x1209]);

const isDev = !app.isPackaged && !!process.env.VITE_DEV_SERVER_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#14161a',
    title: 'IR Remote Configurator',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const ses = win.webContents.session;

  /*
   * Only ever grant 'hid'. Everything else -- camera, microphone, geolocation,
   * notifications -- is refused, because a configuration tool has no business
   * asking and a blanket allow would be the easy mistake to make here.
   */
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'hid');
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'hid'));

  /*
   * Remember the grant so the device reconnects silently next launch.
   *
   * This handler CANNOT inspect collections. Electron passes only name,
   * vendorId, productId and serialNumber here -- verified by logging it --
   * so a usagePage test silently evaluates to undefined and denies every
   * device, including ours. The precise interface choice is therefore made
   * in select-hid-device below, which does receive collections; this gate
   * only decides which devices are eligible at all.
   */
  ses.setDevicePermissionHandler((details) => {
    if (details.deviceType !== 'hid') return false;
    return ALLOWED_VENDOR_IDS.has(details.device?.vendorId);
  });

  /*
   * navigator.hid.requestDevice() lands here. Rather than showing a chooser,
   * pick our configuration interface directly: the firmware's keyboard and
   * consumer interfaces appear in this list too, and asking a user to tell
   * three identically-named entries apart would be a poor first experience.
   */
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const match = details.deviceList.find((d) =>
      d.collections?.some((c) => c.usagePage === CONFIG_USAGE_PAGE)
    );
    callback(match ? match.deviceId : undefined);
  });

  /* A unit unplugged and replugged mid-session should just work again. */
  ses.on('hid-device-added', () => win.webContents.send('hid-changed'));
  ses.on('hid-device-removed', () => win.webContents.send('hid-changed'));

  /* External links open in the real browser, never inside the app shell. */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  return win;
}

// --- File dialogs for profile import/export ------------------------------
ipcMain.handle('save-file', async (_e, { defaultName, contents }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'IR Remote configuration', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false };
  await fs.writeFile(filePath, contents, 'utf8');
  return { ok: true, filePath };
});

ipcMain.handle('open-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'IR Remote configuration', extensions: ['json'] }],
  });
  if (canceled || !filePaths.length) return { ok: false };
  return { ok: true, contents: await fs.readFile(filePaths[0], 'utf8') };
});

ipcMain.handle('app-version', () => app.getVersion());

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
