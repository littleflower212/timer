const CONTENT = {
  water: {
    emoji: '💧',
    title: '该喝水啦！',
    message: '休息一下，喝杯水吧，保持身体水分充足～',
  },
  bathroom: {
    emoji: '🚻',
    title: '该起来活动啦！',
    message: '久坐不利于健康，起来走走，上个厕所吧～',
  },
};

const type = new URLSearchParams(location.search).get('type') || 'water';
const info = CONTENT[type] || CONTENT.water;

document.getElementById('emoji').textContent = info.emoji;
document.getElementById('title').textContent = info.title;
document.getElementById('message').textContent = info.message;
document.title = info.title;

document.getElementById('done').addEventListener('click', () => window.close());

document.getElementById('snooze').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'SNOOZE', alarmName: type, minutes: 10 });
  window.close();
});
