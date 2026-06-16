const ALARM_WATER = 'water';
const ALARM_BATHROOM = 'bathroom';

const DEFAULT_SETTINGS = {
  waterEnabled: true,
  waterInterval: 45,
  bathroomEnabled: true,
  bathroomInterval: 90,
  quietHoursEnabled: false,
  quietStart: 22,
  quietEnd: 8,
};

const ALARM_LABELS = {
  [ALARM_WATER]: '喝水',
  [ALARM_BATHROOM]: '上厕所',
};

const elements = {
  waterEnabled: document.getElementById('water-enabled'),
  waterInterval: document.getElementById('water-interval'),
  waterIntervalLabel: document.getElementById('water-interval-label'),
  waterCountdown: document.getElementById('water-countdown'),
  waterNow: document.getElementById('water-now'),
  waterCard: document.getElementById('water-card'),
  bathroomEnabled: document.getElementById('bathroom-enabled'),
  bathroomInterval: document.getElementById('bathroom-interval'),
  bathroomIntervalLabel: document.getElementById('bathroom-interval-label'),
  bathroomCountdown: document.getElementById('bathroom-countdown'),
  bathroomNow: document.getElementById('bathroom-now'),
  bathroomCard: document.getElementById('bathroom-card'),
  quietEnabled: document.getElementById('quiet-enabled'),
  quietStart: document.getElementById('quiet-start'),
  quietEnd: document.getElementById('quiet-end'),
  quietBody: document.getElementById('quiet-body'),
  statusText: document.getElementById('status-text'),
  badgeHint: document.getElementById('badge-hint'),
};

let countdownTimer = null;
let tickTimer = null;
let cachedStatus = null;

function minutesUntil(scheduledTime) {
  if (!scheduledTime) return null;
  const diff = scheduledTime - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / 60000);
}

function formatCountdown(scheduledTime) {
  if (!scheduledTime) return '未启用';
  const minutes = minutesUntil(scheduledTime);
  if (minutes <= 0) return '即将提醒…';
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h} 小时 ${m} 分钟后提醒` : `${h} 小时后提醒`;
  }
  return `${minutes} 分钟后提醒`;
}

function updateBadgeHint(badge) {
  if (!badge) {
    elements.badgeHint.textContent = '图标数字为距下次提醒的剩余分钟数';
    return;
  }
  const label = ALARM_LABELS[badge.name] || '提醒';
  elements.badgeHint.textContent = `图标数字：${label} · ${badge.minutes} 分钟后`;
}

function formatInterval(minutes) {
  if (minutes >= 60 && minutes % 60 === 0) {
    return `${minutes / 60} 小时`;
  }
  return `${minutes} 分钟`;
}

function populateHourSelects() {
  for (let h = 0; h < 24; h++) {
    const label = `${String(h).padStart(2, '0')}:00`;
    elements.quietStart.appendChild(new Option(label, h));
    elements.quietEnd.appendChild(new Option(label, h));
  }
}

function applySettings(settings) {
  elements.waterEnabled.checked = settings.waterEnabled;
  elements.waterInterval.value = settings.waterInterval;
  elements.waterIntervalLabel.textContent = formatInterval(settings.waterInterval);
  elements.waterCard.classList.toggle('disabled', !settings.waterEnabled);

  elements.bathroomEnabled.checked = settings.bathroomEnabled;
  elements.bathroomInterval.value = settings.bathroomInterval;
  elements.bathroomIntervalLabel.textContent = formatInterval(settings.bathroomInterval);
  elements.bathroomCard.classList.toggle('disabled', !settings.bathroomEnabled);

  elements.quietEnabled.checked = settings.quietHoursEnabled;
  elements.quietStart.value = settings.quietStart;
  elements.quietEnd.value = settings.quietEnd;
  elements.quietBody.style.opacity = settings.quietHoursEnabled ? '1' : '0.5';

  const anyEnabled = settings.waterEnabled || settings.bathroomEnabled;
  elements.statusText.textContent = anyEnabled ? '提醒运行中' : '所有提醒已关闭';
}

function updateCountdowns(status) {
  if (!status) return;

  const waterText = formatCountdown(status[ALARM_WATER]?.scheduledTime);
  const bathroomText = formatCountdown(status[ALARM_BATHROOM]?.scheduledTime);

  elements.waterCountdown.textContent = elements.waterEnabled.checked ? waterText : '已关闭';
  elements.bathroomCountdown.textContent = elements.bathroomEnabled.checked ? bathroomText : '已关闭';

  elements.waterCountdown.classList.toggle('active', elements.waterEnabled.checked && status[ALARM_WATER]);
  elements.bathroomCountdown.classList.toggle('active', elements.bathroomEnabled.checked && status[ALARM_BATHROOM]);
}

function tickCountdowns() {
  if (cachedStatus) {
    updateCountdowns(cachedStatus);
  }
}

async function saveSettings() {
  const settings = {
    waterEnabled: elements.waterEnabled.checked,
    waterInterval: Number(elements.waterInterval.value),
    bathroomEnabled: elements.bathroomEnabled.checked,
    bathroomInterval: Number(elements.bathroomInterval.value),
    quietHoursEnabled: elements.quietEnabled.checked,
    quietStart: Number(elements.quietStart.value),
    quietEnd: Number(elements.quietEnd.value),
  };
  await chrome.storage.sync.set(settings);
  applySettings(settings);
}

async function refreshStatus() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
  if (response) {
    cachedStatus = response.status;
    applySettings(response.settings);
    updateCountdowns(cachedStatus);
    updateBadgeHint(response.badge);
  }
}

function bindEvents() {
  const saveAndRefresh = () => {
    saveSettings().then(refreshStatus);
  };

  elements.waterEnabled.addEventListener('change', saveAndRefresh);
  elements.bathroomEnabled.addEventListener('change', saveAndRefresh);
  elements.quietEnabled.addEventListener('change', saveAndRefresh);
  elements.quietStart.addEventListener('change', saveAndRefresh);
  elements.quietEnd.addEventListener('change', saveAndRefresh);

  elements.waterInterval.addEventListener('input', () => {
    elements.waterIntervalLabel.textContent = formatInterval(Number(elements.waterInterval.value));
  });
  elements.waterInterval.addEventListener('change', saveAndRefresh);

  elements.bathroomInterval.addEventListener('input', () => {
    elements.bathroomIntervalLabel.textContent = formatInterval(Number(elements.bathroomInterval.value));
  });
  elements.bathroomInterval.addEventListener('change', saveAndRefresh);

  async function remindNow(alarmName, countdownEl) {
    countdownEl.textContent = '发送中…';
    try {
      const response = await chrome.runtime.sendMessage({ type: 'REMIND_NOW', alarmName });
      if (response?.ok) {
        countdownEl.textContent = '已弹出提醒窗口 ✓';
        setTimeout(refreshStatus, 1500);
      } else {
        countdownEl.textContent = response?.error || '发送失败，请重试';
      }
    } catch {
      countdownEl.textContent = '发送失败，请重试';
    }
  }

  elements.waterNow.addEventListener('click', () => {
    remindNow(ALARM_WATER, elements.waterCountdown);
  });

  elements.bathroomNow.addEventListener('click', () => {
    remindNow(ALARM_BATHROOM, elements.bathroomCountdown);
  });
}

populateHourSelects();
bindEvents();
refreshStatus();

tickTimer = setInterval(tickCountdowns, 10_000);
countdownTimer = setInterval(refreshStatus, 60_000);

window.addEventListener('unload', () => {
  clearInterval(countdownTimer);
  clearInterval(tickTimer);
});
