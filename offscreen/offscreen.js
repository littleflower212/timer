const TICK_MS = 10_000;

function requestBadgeUpdate() {
  chrome.runtime.sendMessage({ type: 'UPDATE_BADGE' }).catch(() => {});
}

requestBadgeUpdate();
setInterval(requestBadgeUpdate, TICK_MS);
