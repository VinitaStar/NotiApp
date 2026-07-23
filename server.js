require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const webpush = require('web-push');

const DATA_FILE = path.join(__dirname, 'data', 'subscriptions.json');
const PEOPLE = ['me', 'bae'];

const MESSAGES = {
  eating: { title: '🍽️ Eating', body: 'is eating right now' },
  sleepy: { title: '😴 Sleepy', body: 'is getting sleepy' },
  miss: { title: '🥺 Miss you', body: 'misses you right now' },
  love: { title: '❤️ Love you', body: 'loves you' },
  awake: { title: '☀️ Good morning', body: 'just woke up' },
  night: { title: '🌙 Goodnight', body: 'is going to sleep' },
};

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

function loadSubscriptions() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveSubscriptions(subs) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(subs, null, 2));
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/vapid-public-key', (req, res) => {
  res.send(process.env.VAPID_PUBLIC_KEY);
});

app.post('/api/subscribe', (req, res) => {
  const { person, subscription } = req.body;
  if (!PEOPLE.includes(person) || !subscription) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  const subs = loadSubscriptions();
  subs[person] = subscription;
  saveSubscriptions(subs);
  res.json({ ok: true });
});

app.post('/api/notify', async (req, res) => {
  const { from, type, customMessage } = req.body;
  const trimmedCustom = typeof customMessage === 'string' ? customMessage.trim() : '';

  if (!PEOPLE.includes(from) || (!MESSAGES[type] && !trimmedCustom)) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  const to = PEOPLE.find((p) => p !== from);
  const subs = loadSubscriptions();
  const targetSub = subs[to];

  if (!targetSub) {
    return res.status(404).json({ error: `${to} has not enabled notifications yet` });
  }

  const notification = trimmedCustom
    ? { title: '💬 New message', body: trimmedCustom.slice(0, 200) }
    : MESSAGES[type];

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
  });

  try {
    await webpush.sendNotification(targetSub, payload);
    res.json({ ok: true });
  } catch (err) {
    console.error('Push failed:', err.message);
    if (err.statusCode === 404 || err.statusCode === 410) {
      delete subs[to];
      saveSubscriptions(subs);
    }
    res.status(500).json({ error: 'failed to send notification' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`us-app listening on port ${port}`));
