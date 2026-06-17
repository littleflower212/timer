const ALARM_WATER = 'water';
const ALARM_BATHROOM = 'bathroom';
const OFFSCREEN_URL = 'offscreen/offscreen.html';

const ALARM_LABELS = {
  [ALARM_WATER]: '喝水',
  [ALARM_BATHROOM]: '上厕所',
};

const DEFAULT_SETTINGS = {
  waterEnabled: true,
  waterInterval: 45,
  bathroomEnabled: true,
  bathroomInterval: 90,
  quietHoursEnabled: false,
  quietPeriods: [{ id: 'default', start: 1320, end: 480 }],
};

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

const REMINDERS = {
  [ALARM_WATER]: {
    title: '💧 该喝水啦！',
    message: '休息一下，喝杯水吧，保持身体水分充足～',
    icon: 'icons/icon128.png',
  },
  [ALARM_BATHROOM]: {
    title: '🚻 该起来活动啦！',
    message: '久坐不利于健康，起来走走，上个厕所吧～',
    icon: 'icons/icon128.png',
  },
};

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function scheduleAlarm(name, intervalMinutes) {
  await chrome.alarms.clear(name);
  if (intervalMinutes > 0) {
    chrome.alarms.create(name, { delayInMinutes: intervalMinutes });
  }
}

async function rescheduleAll() {
  const settings = await getSettings();

  if (settings.waterEnabled) {
    await scheduleAlarm(ALARM_WATER, settings.waterInterval);
  } else {
    await chrome.alarms.clear(ALARM_WATER);
  }

  if (settings.bathroomEnabled) {
    await scheduleAlarm(ALARM_BATHROOM, settings.bathroomInterval);
  } else {
    await chrome.alarms.clear(ALARM_BATHROOM);
  }

  await updateBadge();
}

function minutesUntil(scheduledTime) {
  const diff = scheduledTime - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / 60000);
}

function getEarliestAlarm(alarms) {
  const active = alarms.filter((a) => a.name === ALARM_WATER || a.name === ALARM_BATHROOM);
  if (active.length === 0) return null;
  return active.reduce((earliest, alarm) => {
    if (!earliest || alarm.scheduledTime < earliest.scheduledTime) return alarm;
    return earliest;
  }, null);
}

function formatBadgeText(scheduledTime) {
  const minutesLeft = minutesUntil(scheduledTime);
  if (minutesLeft <= 0) return '!';
  return String(Math.min(minutesLeft, 999));
}

async function setupOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) return false;

  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });
  if (existing.length > 0) return true;

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['BLOBS'],
      justification: '定时刷新插件角标倒计时',
    });
    return true;
  } catch (err) {
    console.warn('无法创建 offscreen 文档:', err);
    return false;
  }
}

async function updateBadge() {
  const alarms = await chrome.alarms.getAll();
  const next = getEarliestAlarm(alarms);

  if (!next) {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: '健康提醒' });
    return null;
  }

  const text = formatBadgeText(next.scheduledTime);
  const label = ALARM_LABELS[next.name] || '提醒';

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
  await chrome.action.setTitle({ title: `健康提醒 · ${label} ${text} 分钟后` });

  return { name: next.name, scheduledTime: next.scheduledTime, minutes: minutesUntil(next.scheduledTime) };
}

async function init() {
  await setupOffscreenDocument();
  await updateBadge();
}

async function openReminderWindow(alarmName) {
  const url = chrome.runtime.getURL(`reminder/reminder.html?type=${alarmName}`);
  await chrome.windows.create({
    url,
    type: 'popup',
    width: 420,
    height: 360,
    focused: true,
  });
}

async function showSystemNotification(alarmName) {
  const reminder = REMINDERS[alarmName];
  const notificationId = `${alarmName}-${Date.now()}`;
  const iconUrl = chrome.runtime.getURL(reminder.icon);

  try {
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl,
      title: reminder.title,
      message: reminder.message,
      priority: 2,
      requireInteraction: true,
    });
  } catch (err) {
    console.warn('系统通知发送失败（弹窗提醒仍可用）:', err);
  }
}

async function showNotification(alarmName, { force = false } = {}) {
  const settings = await getSettings();
  if (!force && isQuietHour(settings)) {
    await scheduleAlarm(alarmName, alarmName === ALARM_WATER ? settings.waterInterval : settings.bathroomInterval);
    await updateBadge();
    return;
  }

  if (!REMINDERS[alarmName]) {
    throw new Error(`未知提醒类型: ${alarmName}`);
  }

  await openReminderWindow(alarmName);
  await showSystemNotification(alarmName);

  const interval = alarmName === ALARM_WATER ? settings.waterInterval : settings.bathroomInterval;
  await scheduleAlarm(alarmName, interval);
  await updateBadge();
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_WATER || alarm.name === ALARM_BATHROOM) {
    await showNotification(alarm.name);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await rescheduleAll();
  await init();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    rescheduleAll();
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await rescheduleAll();
  await init();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'UPDATE_BADGE') {
    setupOffscreenDocument()
      .then(() => updateBadge())
      .then((badge) => sendResponse({ ok: true, badge }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'GET_STATUS') {
    setupOffscreenDocument()
      .then(() => Promise.all([getSettings(), chrome.alarms.getAll()]))
      .then(async ([settings, alarms]) => {
        const badge = await updateBadge();
        const status = {};
        for (const name of [ALARM_WATER, ALARM_BATHROOM]) {
          const alarm = alarms.find((a) => a.name === name);
          status[name] = alarm ? { scheduledTime: alarm.scheduledTime } : null;
        }
        sendResponse({ settings, status, badge });
      });
    return true;
  }

  if (message.type === 'REMIND_NOW') {
    showNotification(message.alarmName, { force: true })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('通知发送失败:', err);
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (message.type === 'SNOOZE') {
    scheduleAlarm(message.alarmName, message.minutes).then(async () => {
      await updateBadge();
      sendResponse({ ok: true });
    });
    return true;
  }
});

init();
