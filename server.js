require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const webpush = require('web-push');
const { Redis } = require('@upstash/redis');

const DATA_DIR = path.join(__dirname, 'data');
const PEOPLE = ['me', 'bae'];
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MYT_OFFSET_MS = 8 * HOUR_MS;

const SUBS_KEY = 'us-app:subscriptions';
const MESSAGES_KEY = 'us-app:messages';
const QUESTIONS_KEY = 'us-app:questions';
const PLACES_KEY = 'us-app:places';
const EVENTS_KEY = 'us-app:events';
const CHAT_KEY = 'us-app:chat';
const MAX_CHAT_MESSAGES = 1000;
const MILESTONE_NOTIFS_KEY = 'us-app:milestone-notifs';

const NAMES = { me: 'Vinita', bae: 'Sharvin' };

// Only the "together since" date (hero) sends day-count alerts at 100, 200, 300... and at
// 111, 222, 444, 555, 1111..., plus a reminder on the 12th of every month and each anniversary.
// Every other date is display only, apart from the big ones: 1000, 2000, 3000 days.
// A missed alert is still sent if it happened within the last CATCH_UP_DAYS days.
const CATCH_UP_DAYS = 2;

// Unanswered questions nudge the other person: first after 1h, then every 4h, up to 5 times.
const REMIND_FIRST_MS = HOUR_MS;
const REMIND_REPEAT_MS = 4 * HOUR_MS;
const MAX_REMINDERS = 5;

const EVENT_STEPS = [
  { key: '7d', ms: 7 * DAY_MS },
  { key: '1d', ms: DAY_MS },
];

const MILESTONES = [
  { label: 'He saw me first on Insta', date: '2023-02-10T00:00:00+08:00' },
  { label: 'He confessed his love to me', date: '2024-01-31T00:00:00+08:00' },
  { label: 'First meet up', date: '2024-11-15T00:00:00+08:00' },
  { label: 'First pic together', date: '2024-11-30T00:00:00+08:00' },
  { label: 'She accepted his love', date: '2025-04-12T00:00:00+08:00', hero: true },
  { label: 'First outing at KL', date: '2025-05-03T00:00:00+08:00' },
  { label: 'First kiss 😘', date: '2025-05-11T00:00:00+08:00' },
  { label: 'First naked day', date: '2026-05-27T00:00:00+08:00' },
  { label: 'First sleep over', date: '2026-07-14T00:00:00+08:00' },
];

const MESSAGES = {
  eating: { title: '🍽️ {name} is eating', body: 'Ask what is on the plate 😋' },
  sleepy: { title: '😴 {name} is sleepy', body: 'Maybe time to say goodnight 🌙' },
  miss: { title: '🥺 {name} misses you', body: 'Send some love back 💌' },
  love: { title: '❤️ {name} loves you', body: 'Always and forever 💛' },
  awake: { title: '☀️ {name} just woke up', body: 'Say good morning!' },
  night: { title: '🌙 {name} is going to sleep', body: 'Sweet dreams 💤' },
};

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

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

async function addMessage(from, title, body, kind = 'ping') {
  const messages = await loadData(MESSAGES_KEY, []);
  const now = Date.now();
  const fresh = messages.filter((m) => now - m.at < DAY_MS);
  fresh.push({ id: crypto.randomUUID(), from, title, body, kind, at: now });
  await saveData(MESSAGES_KEY, fresh);
}

async function getMessages() {
  const messages = await loadData(MESSAGES_KEY, []);
  const now = Date.now();
  return messages.filter((m) => now - m.at < DAY_MS).sort((a, b) => b.at - a.at);
}

// The chat is polled every few seconds, so it is kept in memory and written through to storage.
let chatCache = null;
let chatVersion = Date.now();

async function getChat() {
  if (!chatCache) chatCache = await loadData(CHAT_KEY, []);
  return chatCache;
}

async function setChat(messages) {
  chatCache = messages.slice(-MAX_CHAT_MESSAGES);
  chatVersion = Math.max(chatVersion + 1, Date.now());
  await saveData(CHAT_KEY, chatCache);
}

function isSpecialDay(n) {
  return n >= 100 && (n % 100 === 0 || /^(\d)\1{2,}$/.test(String(n)));
}

function nextSpecialDay(n) {
  let next = Math.max(n + 1, 100);
  while (!isSpecialDay(next)) next++;
  return next;
}

function isBigDay(n) {
  return n >= 1000 && n % 1000 === 0;
}

const shouldNotifyDay = (milestone, n) => (milestone.hero ? isSpecialDay(n) : isBigDay(n));

// Notifications only go out between 08:00 and 23:00 Malaysia time.
function isQuietHours(now = Date.now()) {
  const hour = new Date(now + MYT_OFFSET_MS).getUTCHours();
  return hour >= 23 || hour < 8;
}

function mytParts(ms) {
  const d = new Date(ms + MYT_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), date: d.getUTCDate() };
}

// The next "12th of the month" after now, counted in months since the hero date.
function nextMonthly(heroMs, now = Date.now()) {
  const start = mytParts(heroMs);
  let n = 1;
  let at = Date.UTC(start.year, start.month + n, start.date) - MYT_OFFSET_MS;
  while (at <= now) {
    n++;
    at = Date.UTC(start.year, start.month + n, start.date) - MYT_OFFSET_MS;
  }
  return { months: n, at };
}

async function checkMilestones(now = Date.now()) {
  const notified = await loadData(MILESTONE_NOTIFS_KEY, []);
  let sent = 0;

  async function announce(key, title, body) {
    if (notified.includes(key)) return;
    const results = await Promise.all(PEOPLE.map((p) => pushTo(p, title, body)));
    if (!results.some((r) => r.ok)) return;

    notified.push(key);
    await saveData(MILESTONE_NOTIFS_KEY, notified);
    await addMessage('us', title, body, 'milestone');
    sent++;
  }

  for (let i = 0; i < MILESTONES.length; i++) {
    const days = Math.floor((now - new Date(MILESTONES[i].date).getTime()) / DAY_MS);

    for (let d = days; d >= Math.max(100, days - CATCH_UP_DAYS); d--) {
      if (!shouldNotifyDay(MILESTONES[i], d)) continue;
      await announce(`${i}:${d}`, `🎉 ${d} days!`, `${d} days since "${MILESTONES[i].label}" 💛`);
    }
  }

  const hero = MILESTONES.find((m) => m.hero);
  const start = mytParts(new Date(hero.date).getTime());
  for (let back = 0; back <= CATCH_UP_DAYS; back++) {
    const day = mytParts(now - back * DAY_MS);
    if (day.date !== start.date) continue;

    const months = (day.year - start.year) * 12 + (day.month - start.month);
    if (months < 1) continue;

    const names = `${NAMES.me} & ${NAMES.bae}`;
    if (months % 12 === 0) {
      const years = months / 12;
      await announce(
        `anniversary:${years}`,
        `💍 ${years} ${years === 1 ? 'year' : 'years'} together!`,
        `Happy anniversary, ${names} 💛`
      );
    } else {
      await announce(`monthly:${months}`, `💞 ${months} months together!`, `Happy monthsary, ${names} 💛`);
    }
  }
  return sent;
}

async function remindQuestions(now = Date.now()) {
  const questions = await loadData(QUESTIONS_KEY, []);
  const due = questions.filter((q) => {
    if (q.answer) return false;
    const count = q.reminders || 0;
    if (count >= MAX_REMINDERS) return false;
    const wait = count === 0 ? REMIND_FIRST_MS : REMIND_REPEAT_MS;
    return now - (q.lastRemindedAt || q.askedAt) >= wait;
  });

  const reminded = [];
  for (const q of due) {
    const to = PEOPLE.find((p) => p !== q.askedBy);
    const result = await pushTo(to, `❓ ${NAMES[q.askedBy]} is waiting for your answer`, q.question.slice(0, 120));
    if (result.ok) reminded.push(q.id);
  }

  if (reminded.length) {
    const fresh = await loadData(QUESTIONS_KEY, []);
    for (const q of fresh) {
      if (!reminded.includes(q.id)) continue;
      q.reminders = (q.reminders || 0) + 1;
      q.lastRemindedAt = now;
    }
    await saveData(QUESTIONS_KEY, fresh);
  }
  return reminded.length;
}

function crossedEventSteps(left) {
  return EVENT_STEPS.filter((s) => left <= s.ms).map((s) => s.key);
}

function formatMyt(ms) {
  return new Date(ms).toLocaleString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

async function checkEvents(now = Date.now()) {
  const events = await loadData(EVENTS_KEY, []);
  const updates = {};

  for (const ev of events) {
    const notified = ev.notified || [];
    const left = ev.at - now;
    let title;
    let keys;

    if (left <= 0) {
      if (notified.includes('start') || -left > 12 * HOUR_MS) continue;
      title = `🎉 It's today! ${ev.title}`;
      keys = ['start'];
    } else {
      keys = crossedEventSteps(left).filter((k) => !notified.includes(k));
      if (!keys.length) continue;
      const days = Math.ceil(left / DAY_MS);
      title = `✈️ ${days} ${days === 1 ? 'day' : 'days'} to go`;
    }

    const results = await Promise.all(PEOPLE.map((p) => pushTo(p, title, ev.title)));
    if (results.some((r) => r.ok)) updates[ev.id] = keys;
  }

  const ids = Object.keys(updates);
  if (ids.length) {
    const fresh = await loadData(EVENTS_KEY, []);
    for (const ev of fresh) {
      if (updates[ev.id]) ev.notified = [...(ev.notified || []), ...updates[ev.id]];
    }
    await saveData(EVENTS_KEY, fresh);
  }
  return ids.length;
}

async function safely(name, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`${name} failed:`, err.message);
    return null;
  }
}

let checking = null;
function runScheduledChecks() {
  if (!checking) {
    checking = (async () => {
      const now = Date.now();
      if (isQuietHours(now)) return { skipped: 'quiet hours' };
      return {
        milestones: await safely('milestones', () => checkMilestones(now)),
        reminders: await safely('reminders', () => remindQuestions(now)),
        events: await safely('events', () => checkEvents(now)),
      };
    })().finally(() => {
      checking = null;
    });
  }
  return checking;
}

const BLOCKED_FOLDER_NAMES = ['__proto__', 'constructor', 'prototype'];

function cleanFolderName(value) {
  const name = typeof value === 'string' ? value.trim().slice(0, 40) : '';
  return BLOCKED_FOLDER_NAMES.includes(name) ? '' : name;
}

function normalizeUrl(value) {
  const link = typeof value === 'string' ? value.trim() : '';
  if (link && !/^https?:\/\//i.test(link)) return `https://${link}`;
  return link;
}

const hasFolder = (places, name) => Object.prototype.hasOwnProperty.call(places, name);

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
  const name = NAMES[from];
  const notification = trimmedCustom
    ? { title: `💬 ${name}`, body: trimmedCustom.slice(0, 200), kind: 'custom' }
    : { title: MESSAGES[type].title.replace('{name}', name), body: MESSAGES[type].body, kind: 'ping' };

  try {
    await addMessage(from, notification.title, notification.body, notification.kind);
    const result = await pushTo(to, notification.title, notification.body);
    if (!result.ok) {
      if (result.reason === 'not-subscribed') {
        return res.status(404).json({ error: `${NAMES[to]} has not enabled notifications yet` });
      }
      return res.status(500).json({ error: 'failed to send notification' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Notify failed:', err.message);
    res.status(500).json({ error: 'failed to send notification' });
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

app.get('/api/milestones', (req, res) => {
  runScheduledChecks().catch((err) => console.error('Scheduled checks failed:', err.message));
  const now = Date.now();
  res.json(
    MILESTONES.map((m) => {
      const days = Math.floor((now - new Date(m.date).getTime()) / DAY_MS);
      const next = nextSpecialDay(days);
      const entry = { ...m, next, nextAt: new Date(m.date).getTime() + next * DAY_MS };
      if (m.hero) entry.nextMonthly = nextMonthly(new Date(m.date).getTime(), now);
      return entry;
    })
  );
});

app.get('/api/cron/check', async (req, res) => {
  try {
    res.json(await runScheduledChecks());
  } catch (err) {
    console.error('Scheduled checks failed:', err.message);
    res.status(500).json({ error: 'scheduled checks failed' });
  }
});

app.get('/api/chat', async (req, res) => {
  try {
    if (chatCache && String(chatVersion) === req.query.v) return res.json({ unchanged: true, v: chatVersion });
    const messages = await getChat();
    res.json({ v: chatVersion, messages: messages.slice(-300) });
  } catch (err) {
    console.error('Failed to load chat:', err.message);
    res.status(500).json({ error: 'failed to load chat' });
  }
});

app.get('/api/chat/unread', async (req, res) => {
  const { person } = req.query;
  if (!PEOPLE.includes(person)) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  try {
    const messages = await getChat();
    res.json({ count: messages.filter((m) => m.from !== person && !m.seenAt).length });
  } catch (err) {
    console.error('Failed to count unread:', err.message);
    res.status(500).json({ error: 'failed to count unread' });
  }
});

app.post('/api/chat', async (req, res) => {
  const { from } = req.body;
  const text = typeof req.body.text === 'string' ? req.body.text.trim().slice(0, 1000) : '';
  if (!PEOPLE.includes(from) || !text) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  try {
    const messages = await getChat();
    const entry = { id: crypto.randomUUID(), from, text, at: Date.now(), seenAt: null };
    await setChat([...messages, entry]);
    const to = PEOPLE.find((p) => p !== from);
    pushTo(to, `💬 ${NAMES[from]}`, text.slice(0, 120)).catch((err) => console.error('Chat push failed:', err.message));
    res.json({ ok: true, message: entry });
  } catch (err) {
    console.error('Failed to send chat message:', err.message);
    res.status(500).json({ error: 'failed to send message' });
  }
});

app.post('/api/chat/seen', async (req, res) => {
  const { person } = req.body;
  if (!PEOPLE.includes(person)) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  try {
    const messages = await getChat();
    const now = Date.now();
    let changed = false;
    for (const m of messages) {
      if (m.from !== person && !m.seenAt) {
        m.seenAt = now;
        changed = true;
      }
    }
    if (changed) await setChat(messages);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to mark chat as seen:', err.message);
    res.status(500).json({ error: 'failed to mark as seen' });
  }
});

app.delete('/api/chat/:id', async (req, res) => {
  const { from } = req.query;
  if (!PEOPLE.includes(from)) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  try {
    const messages = await getChat();
    const entry = messages.find((m) => m.id === req.params.id);
    if (!entry) return res.json({ ok: true });
    if (entry.from !== from) return res.status(403).json({ error: 'you can only delete your own messages' });
    await setChat(messages.filter((m) => m.id !== entry.id));
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete chat message:', err.message);
    res.status(500).json({ error: 'failed to delete message' });
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
      reminders: 0,
      lastRemindedAt: null,
    };
    questions.push(entry);
    await saveData(QUESTIONS_KEY, questions);
    const to = PEOPLE.find((p) => p !== from);
    await pushTo(to, `❓ ${NAMES[from]} asked you something`, q.slice(0, 120));
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
    await pushTo(entry.askedBy, `💬 ${NAMES[from]} answered`, a.slice(0, 120));
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
  const name = cleanFolderName(req.body.folder);
  if (!name) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  try {
    const places = await loadData(PLACES_KEY, {});
    if (!hasFolder(places, name)) places[name] = [];
    await saveData(PLACES_KEY, places);
    res.json({ ok: true, places });
  } catch (err) {
    console.error('Failed to create folder:', err.message);
    res.status(500).json({ error: 'failed to create folder' });
  }
});

app.put('/api/places/folders/:name', async (req, res) => {
  const oldName = req.params.name;
  const newName = cleanFolderName(req.body.name);
  if (!newName) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  try {
    const places = await loadData(PLACES_KEY, {});
    if (!hasFolder(places, oldName)) return res.status(404).json({ error: 'folder not found' });
    if (newName !== oldName && hasFolder(places, newName)) {
      return res.status(409).json({ error: 'a folder with that name already exists' });
    }
    const renamed = {};
    for (const [name, links] of Object.entries(places)) {
      renamed[name === oldName ? newName : name] = links;
    }
    await saveData(PLACES_KEY, renamed);
    res.json({ ok: true, places: renamed });
  } catch (err) {
    console.error('Failed to rename folder:', err.message);
    res.status(500).json({ error: 'failed to rename folder' });
  }
});

app.delete('/api/places/folders/:name', async (req, res) => {
  try {
    const places = await loadData(PLACES_KEY, {});
    if (hasFolder(places, req.params.name)) {
      delete places[req.params.name];
      await saveData(PLACES_KEY, places);
    }
    res.json({ ok: true, places });
  } catch (err) {
    console.error('Failed to delete folder:', err.message);
    res.status(500).json({ error: 'failed to delete folder' });
  }
});

app.post('/api/places/links', async (req, res) => {
  const { from, title } = req.body;
  const folderName = cleanFolderName(req.body.folder);
  const link = normalizeUrl(req.body.url);
  if (!PEOPLE.includes(from) || !folderName || !link) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  try {
    const places = await loadData(PLACES_KEY, {});
    if (!hasFolder(places, folderName)) places[folderName] = [];
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

app.put('/api/places/links/:folder/:id', async (req, res) => {
  const targetFolder = cleanFolderName(req.body.folder) || req.params.folder;
  const link = normalizeUrl(req.body.url);
  if (!link) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  try {
    const places = await loadData(PLACES_KEY, {});
    const links = hasFolder(places, req.params.folder) ? places[req.params.folder] : [];
    const entry = links.find((l) => l.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'link not found' });

    entry.url = link;
    entry.title = typeof req.body.title === 'string' && req.body.title.trim() ? req.body.title.trim().slice(0, 100) : link;

    if (targetFolder !== req.params.folder) {
      places[req.params.folder] = links.filter((l) => l.id !== entry.id);
      if (!hasFolder(places, targetFolder)) places[targetFolder] = [];
      places[targetFolder].push(entry);
    }
    await saveData(PLACES_KEY, places);
    res.json({ ok: true, places });
  } catch (err) {
    console.error('Failed to update link:', err.message);
    res.status(500).json({ error: 'failed to update link' });
  }
});

app.delete('/api/places/links/:folder/:id', async (req, res) => {
  try {
    const places = await loadData(PLACES_KEY, {});
    if (hasFolder(places, req.params.folder)) {
      places[req.params.folder] = places[req.params.folder].filter((l) => l.id !== req.params.id);
      await saveData(PLACES_KEY, places);
    }
    res.json({ ok: true, places });
  } catch (err) {
    console.error('Failed to delete link:', err.message);
    res.status(500).json({ error: 'failed to delete link' });
  }
});

function cleanEventTitle(value) {
  return typeof value === 'string' ? value.trim().slice(0, 80) : '';
}

app.get('/api/events', async (req, res) => {
  try {
    const events = await loadData(EVENTS_KEY, []);
    res.json(events.sort((a, b) => a.at - b.at));
  } catch (err) {
    console.error('Failed to load events:', err.message);
    res.status(500).json({ error: 'failed to load events' });
  }
});

app.post('/api/events', async (req, res) => {
  const { from } = req.body;
  const title = cleanEventTitle(req.body.title);
  const at = Number(req.body.at);
  if (!PEOPLE.includes(from) || !title || !Number.isFinite(at) || at <= 0) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  try {
    const events = await loadData(EVENTS_KEY, []);
    const entry = {
      id: crypto.randomUUID(),
      title,
      at,
      createdBy: from,
      createdAt: Date.now(),
      notified: crossedEventSteps(at - Date.now()),
    };
    events.push(entry);
    await saveData(EVENTS_KEY, events);
    const to = PEOPLE.find((p) => p !== from);
    await pushTo(to, `📅 ${NAMES[from]} added a countdown`, `${title} · ${formatMyt(at)}`);
    res.json({ ok: true, event: entry });
  } catch (err) {
    console.error('Failed to save event:', err.message);
    res.status(500).json({ error: 'failed to save event' });
  }
});

app.put('/api/events/:id', async (req, res) => {
  const { from } = req.body;
  const title = cleanEventTitle(req.body.title);
  const at = Number(req.body.at);
  if (!PEOPLE.includes(from) || !title || !Number.isFinite(at) || at <= 0) {
    return res.status(400).json({ error: 'invalid payload' });
  }
  try {
    const events = await loadData(EVENTS_KEY, []);
    const entry = events.find((ev) => ev.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'event not found' });

    const timeChanged = entry.at !== at;
    entry.title = title;
    entry.at = at;
    if (timeChanged) entry.notified = crossedEventSteps(at - Date.now());
    await saveData(EVENTS_KEY, events);

    if (timeChanged) {
      const to = PEOPLE.find((p) => p !== from);
      await pushTo(to, `🗓️ ${NAMES[from]} changed a plan`, `${title} · ${formatMyt(at)}`);
    }
    res.json({ ok: true, event: entry });
  } catch (err) {
    console.error('Failed to update event:', err.message);
    res.status(500).json({ error: 'failed to update event' });
  }
});

app.delete('/api/events/:id', async (req, res) => {
  try {
    const events = await loadData(EVENTS_KEY, []);
    await saveData(EVENTS_KEY, events.filter((ev) => ev.id !== req.params.id));
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete event:', err.message);
    res.status(500).json({ error: 'failed to delete event' });
  }
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`us-app listening on port ${port}`));
}

module.exports = {
  isSpecialDay,
  nextSpecialDay,
  isQuietHours,
  checkMilestones,
  remindQuestions,
  checkEvents,
  loadData,
  saveData,
};
