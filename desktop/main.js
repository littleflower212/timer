const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  Notification,
  ipcMain,
} = require('electron');
const path = require('path');
const Store = require('electron-store');

const TYPES = ['water', 'bathroom'];

const REMINDERS = {
  water: {
    label: '喝水',
    title: '💧 该喝水啦！',
    message: '休息一下，喝杯水吧，保持身体水分充足～',
  },
  bathroom: {
    label: '上厕所',
    title: '🚻 该起来活动啦！',
    message: '久坐不利于健康，起来走走，上个厕所吧～',
  },
};

const DEFAULT_SETTINGS = {
  waterEnabled: true,
  waterInterval: 45,
  bathroomEnabled: true,
  bathroomInterval: 90,
  quietHoursEnabled: false,
  quietPeriods: [{ id: 'default', start: 1320, end: 480 }],
  launchAtLogin: true,
};

const store = new Store({
  defaults: {
    settings: DEFAULT_SETTINGS,
    waterNextFire: null,
    bathroomNextFire: null,
  },
});

const timers = { water: null, bathroom: null };
let tray = null;
let settingsWindow = null;
let trayUpdateTimer = null;

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...store.get('settings') };
}

function normalizeTime(value) {
  if (value < 24) return value * 60;
  return value;
}

function getQuietPeriods(settings) {
  const periods = (() => {
    if (Array.isArray(settings.quietPeriods) && settings.quietPeriods.length > 0) {
      return settings.quietPeriods;
    }
    if (settings.quietStart !== undefined) {
      return [{ id: 'legacy', start: settings.quietStart, end: settings.quietEnd }];
    }
    return DEFAULT_SETTINGS.quietPeriods;
  })();

  return periods.map((p) => ({
    ...p,
    start: normalizeTime(p.start),
    end: normalizeTime(p.end),
  }));
}

function getNowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function isTimeInPeriod(minute, start, end) {
  const s = normalizeTime(start);
  const e = normalizeTime(end);
  if (s < e) return minute >= s && minute < e;
  return minute >= s || minute < e;
}

function isQuietHour(settings) {
  if (!settings.quietHoursEnabled) return false;
  const now = getNowMinutes();
  return getQuietPeriods(settings).some((p) => isTimeInPeriod(now, p.start, p.end));
}

function minutesUntil(timestamp) {
  if (!timestamp) return null;
  const diff = timestamp - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / 60000);
}

function getNextFireInfo() {
  const settings = getSettings();
  const candidates = [];

  for (const type of TYPES) {
    if (!settings[`${type}Enabled`]) continue;
    const nextFire = store.get(`${type}NextFire`);
    if (nextFire) candidates.push({ type, nextFire });
  }

  if (candidates.length === 0) return null;

  return candidates.reduce((earliest, item) => {
    if (!earliest || item.nextFire < earliest.nextFire) return item;
    return earliest;
  }, null);
}

function updateTray() {
  if (!tray) return;

  const next = getNextFireInfo();
  if (!next) {
    tray.setTitle('');
    tray.setToolTip('健康提醒 · 所有提醒已关闭');
    return;
  }

  const minutes = minutesUntil(next.nextFire);
  const label = REMINDERS[next.type].label;
  const text = minutes <= 0 ? '!' : String(Math.min(minutes, 999));

  tray.setTitle(text);
  tray.setToolTip(`健康提醒 · ${label} ${text} 分钟后`);
}

function clearTimer(type) {
  if (timers[type]) {
    clearTimeout(timers[type]);
    timers[type] = null;
  }
}

function schedule(type) {
  clearTimer(type);

  const settings = getSettings();
  const enabledKey = `${type}Enabled`;
  const intervalKey = `${type}Interval`;
  const nextKey = `${type}NextFire`;

  if (!settings[enabledKey]) {
    store.set(nextKey, null);
    updateTray();
    return;
  }

  let nextFire = store.get(nextKey);
  if (!nextFire || nextFire <= Date.now()) {
    nextFire = Date.now() + settings[intervalKey] * 60_000;
    store.set(nextKey, nextFire);
  }

  const delay = Math.max(0, nextFire - Date.now());
  timers[type] = setTimeout(() => fireReminder(type), delay);
  updateTray();
}

function rescheduleAll() {
  for (const type of TYPES) {
    schedule(type);
  }
}

function showNotification(type) {
  const reminder = REMINDERS[type];
  if (!Notification.isSupported()) return;

  const notification = new Notification({
    title: reminder.title,
    body: reminder.message,
    silent: false,
  });
  notification.show();
}

function showReminderWindow(type) {
  const win = new BrowserWindow({
    width: 420,
    height: 360,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    center: true,
    title: '健康提醒',
    webPreferences: {
      preload: path.join(__dirname, 'reminder-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'reminder.html'), {
    query: { type },
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function fireReminder(type, { force = false } = {}) {
  const settings = getSettings();
  const intervalKey = `${type}Interval`;
  const nextKey = `${type}NextFire`;

  if (!force && isQuietHour(settings)) {
    store.set(nextKey, Date.now() + settings[intervalKey] * 60_000);
    schedule(type);
    return;
  }

  showReminderWindow(type);
  showNotification(type);

  store.set(nextKey, Date.now() + settings[intervalKey] * 60_000);
  schedule(type);
  notifyStatusChanged();
}

function notifyStatusChanged() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('status-changed');
  }
}

function applyLoginItemSettings() {
  const settings = getSettings();
  app.setLoginItemSettings({
    openAtLogin: settings.launchAtLogin,
    openAsHidden: true,
  });
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 340,
    height: 640,
    show: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: '健康提醒',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray.png');
  const image = nativeImage.createFromPath(iconPath);
  image.setTemplateImage(true);

  tray = new Tray(image);
  tray.setToolTip('健康提醒');

  const contextMenu = Menu.buildFromTemplate([
    { label: '打开设置', click: createSettingsWindow },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', createSettingsWindow);

  updateTray();
  trayUpdateTimer = setInterval(updateTray, 10_000);
}

function buildStatus() {
  const settings = getSettings();
  const status = {};
  const badge = getNextFireInfo();

  for (const type of TYPES) {
    const nextFire = store.get(`${type}NextFire`);
    status[type] = settings[`${type}Enabled`] && nextFire
      ? { scheduledTime: nextFire }
      : null;
  }

  return {
    settings,
    status,
    badge: badge
      ? {
          name: badge.type,
          scheduledTime: badge.nextFire,
          minutes: minutesUntil(badge.nextFire),
        }
      : null,
  };
}

ipcMain.handle('get-status', () => buildStatus());

ipcMain.handle('save-settings', (_event, newSettings) => {
  const current = getSettings();
  const merged = { ...current, ...newSettings };
  store.set('settings', merged);

  for (const type of TYPES) {
    const intervalKey = `${type}Interval`;
    const enabledKey = `${type}Enabled`;
    if (newSettings[intervalKey] !== undefined || newSettings[enabledKey] !== undefined) {
      store.set(`${type}NextFire`, Date.now() + merged[intervalKey] * 60_000);
    }
  }

  applyLoginItemSettings();
  rescheduleAll();
  return buildStatus();
});

ipcMain.handle('remind-now', (_event, type) => {
  fireReminder(type, { force: true });
  return { ok: true };
});

ipcMain.handle('snooze', (_event, type) => {
  store.set(`${type}NextFire`, Date.now() + 10 * 60_000);
  schedule(type);
  notifyStatusChanged();
  return { ok: true };
});

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  createTray();
  applyLoginItemSettings();
  rescheduleAll();
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

app.on('before-quit', () => {
  if (trayUpdateTimer) clearInterval(trayUpdateTimer);
  for (const type of TYPES) clearTimer(type);
});
