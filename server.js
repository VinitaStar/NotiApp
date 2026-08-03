require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const webpush = require('web-push');
const { Redis } = require('@upstash/redis');

const DATA_DIR = path.join(__dirname, 'data');
const PEOPLE = ['me', 'bae'];
const DAY_MS = 24 * 60 * 60 * 1000;

const SUBS_KEY = 'us-app:subscriptions';
const MESSAGES_KEY = 'us-app:messages';
const QUESTIONS_KEY = 'us-app:questions';
const PLACES_KEY = 'us-app:places';
const MILESTONE_NOTIFS_KEY = 'us-app:milestone-notifs';

const NAMES = { me: 'Vinita', bae: 'Sharvin' };

const MILESTONES = [
  { label: 'He saw me first on Insta', date: '2023-02-10T00:00:00' },
  { label: 'He confessed his love to me', date: '2024-01-31T00:00:00' },
  { label: 'First meet up', date: '2024-11-15T00:00:00' },
  { label: 'First pic together', date: '2024-11-30T00:00:00' },
  { label: 'She accepted his love', date: '2025-04-12T00:00:00' },
  { label: 'First outing at KL', date: '2025-05-03T00:00:00' },
  { label: 'First kiss 😘', date: '2025-05-11T00:00:00' },
  { label: 'First naked day', date: '2026-05-27T00:00:00' },
  { label: 'First sleep over', date: '2026-07-14T00:00:00' },
];

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

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

async function loadData(key, fallback) {
  if (redis) {
    const data = await redis.get(key);
    return data ?? fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${key.replace(/:/g, '_')}.json`), 'utf8'));
  } catch {
    return fallback;
  }
}

async function saveData(key, value) {
  if (redis) {
    await redis.set(key, value);
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, `${key.replace(/:/g, '_')}.json`), JSON.stringify(value, null, 2));
}

const loadSubscriptions = () => loadData(SUBS_KEY, {});
const saveSubscriptions = (subs) => saveData(SUBS_KEY, subs);

async function pushTo(person, title, body) {
  const subs = await loadSubscriptions();
  const sub = subs[person];
  if (!sub) return { ok: false, reason: 'not-subscribed' };

  try {
    await webpush.sendNotification(sub, JSON.stringify({ title, body }));
    return { ok: true };
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      delete subs[person];
      await saveSubscriptions(subs);
    }
    return { ok: false, reason: 'push-failed', error: err.message };
  }
}

async function addMessage(from, title, body) {
  const messages = await loadData(MESSAGES_KEY, []);
  const now = Date.now();
  const fresh = messages.filter((m) => now - m.at < DAY_MS);
  fresh.push({ id: crypto.randomUUID(), from, title, body, at: now });
  await saveData(MESSAGES_KEY, fresh);
}

async function getMessages() {
  const messages = await loadData(MESSAGES_KEY, []);
  const now = Date.now();
  return messages.filter((m) => now - m.at < DAY_MS).sort((a, b) => b.at - a.at);
}

async function checkMilestones() {
  const notified = await loadData(MILESTONE_NOTIFS_KEY, []);
  const now = Date.now();
  let changed = false;

  for (let i = 0; i < MILESTONES.length; i++) {
    const days = Math.floor((now - new Date(MILESTONES[i].date).getTime()) / DAY_MS);
    if (days <= 0 || days % 100 !== 0) continue;

    const key = `${i}:${days}`;
    if (notified.includes(key)) continue;

    const title = `🎉 ${days} days!`;
    const body = `${days} days since ${MILESTONES[i].label.toLowerCase()} — ${NAMES.me} & ${NAMES.bae} 💛`;
    await Promise.all(PEOPLE.map((p) => pushTo(p, title, body)));
    await addMessage('us', title, body);
    notified.push(key);
    changed = true;
  }

  if (changed) await saveData(MILESTONE_NOTIFS_KEY, notified);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/vapid-public-key', (req, res) => {
  res.send(process.env.VAPID_PUBLIC_KEY);
});

app.post('/api/subscribe', async (req, res) => {
  const { person, subscription } = req.body;
  if (!PEOPLE.includes(person) || !subscription) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  try {
    const subs = await loadSubscriptions();
    subs[person] = subscription;
    await saveSubscriptions(subs);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to save subscription:', err.message);
    res.status(500).json({ error: 'failed to save subscription' });
  }
});

app.post('/api/notify', async (req, res) => {
  const { from, type, customMessage } = req.body;
  const trimmedCustom = typeof customMessage === 'string' ? customMessage.trim() : '';

  if (!PEOPLE.includes(from) || (!MESSAGES[type] && !trimmedCustom)) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  const to = PEOPLE.find((p) => p !== from);
  const notification = trimmedCustom
    ? { title: '💬 New message', body: trimmedCustom.slice(0, 200) }
    : MESSAGES[type];

  try {
    await addMessage(from, notification.title, notification.body);
    const result = await pushTo(to, notification.title, notification.body);
    if (!result.ok) {
      if (result.reason === 'not-subscribed') {
        return res.status(404).json({ error: `${to} has not enabled notifications yet` });
      }
      return res.status(500).json({ error: 'failed to send notification' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Notify failed:', err.message);
    res.status(500).json({ error: 'failed to send notification' });
  }
});

app.get('/api/milestones', async (req, res) => {
  try {
    checkMilestones().catch((err) => console.error('Milestone check failed:', err.message));
    res.json(MILESTONES);
  } catch (err) {
    console.error('Failed to load milestones:', err.message);
    res.status(500).json({ error: 'failed to load milestones' });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    res.json(await getMessages());
  } catch (err) {
    console.error('Failed to load messages:', err.message);
    res.status(500).json({ error: 'failed to load messages' });
  }
});

app.get('/api/questions', async (req, res) => {
  try {
    const questions = await loadData(QUESTIONS_KEY, []);
    res.json(questions.sort((a, b) => b.askedAt - a.askedAt));
  } catch (err) {
    console.error('Failed to load questions:', err.message);
    res.status(500).json({ error: 'failed to load questions' });
  }
});

app.post('/api/questions', async (req, res) => {
  const { from, question } = req.body;
  const q = typeof question === 'string' ? question.trim() : '';
  if (!PEOPLE.includes(from) || !q) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  try {
    const questions = await loadData(QUESTIONS_KEY, []);
    const entry = {
      id: crypto.randomUUID(),
      question: q.slice(0, 300),
      askedBy: from,
      askedAt: Date.now(),
      answer: null,
      answeredBy: null,
      answeredAt: null,
    };
    questions.push(entry);
    await saveData(QUESTIONS_KEY, questions);
    const to = PEOPLE.find((p) => p !== from);
    await pushTo(to, '❓ New question', q.slice(0, 120));
    res.json({ ok: true, question: entry });
  } catch (err) {
    console.error('Failed to save question:', err.message);
    res.status(500).json({ error: 'failed to save question' });
  }
});

app.post('/api/questions/:id/answer', async (req, res) => {
  const { from, answer } = req.body;
  const a = typeof answer === 'string' ? answer.trim() : '';
  if (!PEOPLE.includes(from) || !a) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  try {
    const questions = await loadData(QUESTIONS_KEY, []);
    const entry = questions.find((item) => item.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'question not found' });

    entry.answer = a.slice(0, 500);
    entry.answeredBy = from;
    entry.answeredAt = Date.now();
    await saveData(QUESTIONS_KEY, questions);
    await pushTo(entry.askedBy, '💬 They answered!', a.slice(0, 120));
    res.json({ ok: true, question: entry });
  } catch (err) {
    console.error('Failed to save answer:', err.message);
    res.status(500).json({ error: 'failed to save answer' });
  }
});

app.delete('/api/questions/:id', async (req, res) => {
  try {
    const questions = await loadData(QUESTIONS_KEY, []);
    const filtered = questions.filter((item) => item.id !== req.params.id);
    await saveData(QUESTIONS_KEY, filtered);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete question:', err.message);
    res.status(500).json({ error: 'failed to delete question' });
  }
});

app.get('/api/places', async (req, res) => {
  try {
    res.json(await loadData(PLACES_KEY, {}));
  } catch (err) {
    console.error('Failed to load places:', err.message);
    res.status(500).json({ error: 'failed to load places' });
  }
});

app.post('/api/places/folders', async (req, res) => {
  const { folder } = req.body;
  const name = typeof folder === 'string' ? folder.trim().slice(0, 40) : '';
  if (!name) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  try {
    const places = await loadData(PLACES_KEY, {});
    if (!places[name]) places[name] = [];
    await saveData(PLACES_KEY, places);
    res.json({ ok: true, places });
  } catch (err) {
    console.error('Failed to create folder:', err.message);
    res.status(500).json({ error: 'failed to create folder' });
  }
});

app.post('/api/places/links', async (req, res) => {
  const { from, folder, url, title } = req.body;
  const folderName = typeof folder === 'string' ? folder.trim().slice(0, 40) : '';
  let link = typeof url === 'string' ? url.trim() : '';
  if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
  if (!PEOPLE.includes(from) || !folderName || !link) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  try {
    const places = await loadData(PLACES_KEY, {});
    if (!places[folderName]) places[folderName] = [];
    places[folderName].push({
      id: crypto.randomUUID(),
      url: link,
      title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 100) : link,
      addedBy: from,
      addedAt: Date.now(),
    });
    await saveData(PLACES_KEY, places);
    res.json({ ok: true, places });
  } catch (err) {
    console.error('Failed to save link:', err.message);
    res.status(500).json({ error: 'failed to save link' });
  }
});

app.delete('/api/places/links/:folder/:id', async (req, res) => {
  try {
    const places = await loadData(PLACES_KEY, {});
    const folder = places[req.params.folder];
    if (folder) {
      places[req.params.folder] = folder.filter((l) => l.id !== req.params.id);
      await saveData(PLACES_KEY, places);
    }
    res.json({ ok: true, places });
  } catch (err) {
    console.error('Failed to delete link:', err.message);
    res.status(500).json({ error: 'failed to delete link' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`us-app listening on port ${port}`));
