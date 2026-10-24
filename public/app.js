function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

const NAMES = { me: 'Vinita', bae: 'Sharvin' };
const DAY_MS = 24 * 60 * 60 * 1000;
const nameOf = (p) => NAMES[p] || 'Us';

const personScreen = document.getElementById('person-screen');
const mainScreen = document.getElementById('main-screen');
const statusEl = document.getElementById('status');
const whoAmILabel = document.getElementById('who-am-i');
const enableBtn = document.getElementById('enable-notifications');
const heartsEl = document.getElementById('hearts-bg');

let person = localStorage.getItem('us-app-person');
let currentTab = 'ping';
let toastTimer = null;

function escapeHtml(str) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, (c) => entities[c]);
}

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', !!isError);
  statusEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => statusEl.classList.remove('show'), isError ? 5000 : 2500);
}

async function api(url, method = 'GET', body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Network error, try again');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function timeAgo(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDate(ms) {
  return new Date(ms).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kuala_Lumpur',
  });
}

function formatDateTime(ms) {
  return new Date(ms).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ---------- Person & notifications ---------- */

function showMainScreen() {
  personScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
  whoAmILabel.textContent = `${person === 'me' ? '💗' : '💛'} ${nameOf(person)}`;
}

document.querySelectorAll('.person-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    person = btn.dataset.person;
    localStorage.setItem('us-app-person', person);
    showMainScreen();
    loadMilestones();
    syncSubscription();
  });
});

const notificationsSupported =
  'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';

function setNotificationsOn() {
  enableBtn.textContent = '🔔 Notifications on';
  enableBtn.classList.add('on');
}

async function subscribeThisDevice() {
  const registration = await navigator.serviceWorker.register('/service-worker.js');
  await navigator.serviceWorker.ready;

  const publicKeyRes = await fetch('/api/vapid-public-key');
  const publicKey = await publicKeyRes.text();

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  await api('/api/subscribe', 'POST', { person, subscription });
}

async function registerAndSubscribe() {
  if (!notificationsSupported) {
    setStatus('This browser doesn\'t support notifications 😢', true);
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    setStatus('Notifications permission was not granted. Tap "Enable notifications" and allow it.', true);
    return;
  }
  await subscribeThisDevice();
  setNotificationsOn();
  setStatus('Notifications enabled! You\'ll get pinged 💌');
}

// Re-save this device's subscription on every open so a lost server copy heals itself.
async function syncSubscription() {
  if (!person || !notificationsSupported || Notification.permission !== 'granted') return;
  try {
    await subscribeThisDevice();
    setNotificationsOn();
  } catch (err) {
    console.error(err);
  }
}

enableBtn.addEventListener('click', () => {
  registerAndSubscribe().catch((err) => {
    console.error(err);
    setStatus(err.message || 'Something went wrong enabling notifications, please try again', true);
  });
});

/* ---------- Falling hearts ---------- */

const HEART_PATH =
  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';
const SPARKLE_PATH = 'M12 0l2.6 9.4L24 12l-9.4 2.6L12 24l-2.6-9.4L0 12l9.4-2.6z';
const HEART_COLORS = ['#d6345c', '#f08aa0', '#f2cf94', '#b3274f', '#ff9fb2', '#e8627c'];

const svgIcon = (path) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;
const between = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Three depths: small, blurry, slow hearts far away and big, bright, quicker ones up close.
const HEART_LAYERS = [
  { count: 9, size: [10, 16], duration: [20, 28], opacity: 0.28, blur: 1.5 },
  { count: 9, size: [16, 24], duration: [14, 20], opacity: 0.5, blur: 0 },
  { count: 6, size: [26, 38], duration: [10, 15], opacity: 0.7, blur: 0 },
];

function createHearts() {
  if (heartsEl.childElementCount) return;

  HEART_LAYERS.forEach((layer) => {
    for (let i = 0; i < layer.count; i++) {
      const duration = between(...layer.duration);
      const heart = document.createElement('span');
      heart.className = 'heart';
      heart.innerHTML = svgIcon(HEART_PATH);
      heart.style.left = `${between(0, 96)}%`;
      heart.style.width = `${between(...layer.size)}px`;
      heart.style.color = pick(HEART_COLORS);
      heart.style.animationDuration = `${duration}s`;
      heart.style.animationDelay = `-${between(0, duration)}s`;
      heart.style.setProperty('--drift', `${Math.round(between(-70, 70))}px`);
      heart.style.setProperty('--rotate', `${Math.round(between(-300, 300))}deg`);
      heart.style.setProperty('--o', layer.opacity);
      if (layer.blur) heart.style.filter = `blur(${layer.blur}px)`;
      heartsEl.appendChild(heart);
    }
  });

  for (let i = 0; i < 16; i++) {
    const duration = between(2.5, 5);
    const sparkle = document.createElement('span');
    sparkle.className = 'sparkle';
    sparkle.innerHTML = svgIcon(SPARKLE_PATH);
    sparkle.style.left = `${between(2, 96)}%`;
    sparkle.style.top = `${between(3, 94)}%`;
    sparkle.style.width = `${between(6, 13)}px`;
    sparkle.style.animationDuration = `${duration}s`;
    sparkle.style.animationDelay = `-${between(0, duration)}s`;
    heartsEl.appendChild(sparkle);
  }
}

/* ---------- Tabs ---------- */

const tabLoaders = {
  history: loadHistory,
  dates: renderDates,
  ask: loadQuestions,
  places: loadPlaces,
  meet: loadEvents,
};

function showTab(name) {
  currentTab = name;
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach((c) => c.classList.toggle('active', c.id === `tab-${name}`));
  heartsEl.classList.toggle('visible', name === 'dates' || name === 'meet');
  window.scrollTo({ top: 0 });
  if (tabLoaders[name]) tabLoaders[name]();
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !person || !tabLoaders[currentTab]) return;
  if (currentTab === 'places' && editingLinkId) return;
  tabLoaders[currentTab]();
});

/* ---------- Live counters ---------- */

function elapsedText(from, to) {
  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  let days = to.getDate() - from.getDate();
  if (days < 0) {
    months--;
    days += new Date(to.getFullYear(), to.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years--;
    months += 12;
  }
  const parts = [];
  if (years) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
  if (months) parts.push(`${months} ${months === 1 ? 'month' : 'months'}`);
  parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  return parts.join(' · ');
}

function tickAll() {
  const now = Date.now();

  document.querySelectorAll('.tick').forEach((el) => {
    const ts = Number(el.dataset.ts);
    const until = el.dataset.dir === 'until';
    const diff = until ? ts - now : now - ts;
    if (diff < 0) {
      el.innerHTML = `<span class="days-label">${until ? 'It\'s time! 🎉' : 'Coming up ✨'}</span>`;
      return;
    }
    const total = Math.floor(diff / 1000);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    el.innerHTML =
      `<span class="days-big">${days}</span>` +
      `<span class="days-label">${el.dataset.label || (days === 1 ? 'day' : 'days')}</span>` +
      `<span class="sub-time">${hours}h ${mins}m ${secs}s</span>`;
  });

  document.querySelectorAll('.ymd').forEach((el) => {
    el.textContent = elapsedText(new Date(Number(el.dataset.ts)), new Date());
  });
}

setInterval(tickAll, 1000);

/* ---------- Ping ---------- */

async function sendPing(body, controls) {
  controls.forEach((c) => (c.disabled = true));
  setStatus('Sending...');
  try {
    await api('/api/notify', 'POST', { from: person, ...body });
    setStatus('Sent 💌');
    return true;
  } catch (err) {
    setStatus(err.message, true);
    return false;
  } finally {
    controls.forEach((c) => (c.disabled = false));
  }
}

document.querySelectorAll('.ping-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (person) sendPing({ type: btn.dataset.type }, [btn]);
  });
});

const customInput = document.getElementById('custom-input');
const customSendBtn = document.getElementById('custom-send');

async function sendCustomMessage() {
  const message = customInput.value.trim();
  if (!person || !message) return;
  if (await sendPing({ customMessage: message }, [customSendBtn])) customInput.value = '';
}

customSendBtn.addEventListener('click', sendCustomMessage);
customInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendCustomMessage();
});

/* ---------- History ---------- */

async function loadHistory() {
  const listEl = document.getElementById('history-list');
  if (!listEl.innerHTML) listEl.innerHTML = '<div class="empty-note">Loading...</div>';
  try {
    const messages = await api('/api/messages');
    if (!messages.length) {
      listEl.innerHTML = '<div class="empty-note">Nothing in the last 24 hours yet 🕰️</div>';
      return;
    }
    listEl.innerHTML =
      '<div class="section-title">Last 24 hours</div>' +
      messages
        .map((m) => {
          const side = m.from === person ? 'mine' : m.from === 'us' ? 'us' : 'theirs';
          const who = side === 'us' ? '🎉 Us' : nameOf(m.from);
          const title = m.kind === 'custom' ? '' : `<div class="bubble-title">${escapeHtml(m.title)}</div>`;
          return `<div class="bubble ${side}">
            <div class="bubble-name">${escapeHtml(who)}</div>
            ${title}
            <div class="bubble-body">${escapeHtml(m.body)}</div>
            <div class="meta">${timeAgo(m.at)}</div>
          </div>`;
        })
        .join('');
  } catch (err) {
    listEl.innerHTML = '<div class="empty-note">Could not load history</div>';
  }
}

/* ---------- Us (dates) ---------- */

let milestones = [];

async function loadMilestones() {
  try {
    milestones = await api('/api/milestones');
  } catch {
    milestones = [];
  }
}

const MILESTONE_ICONS = [
  { match: /insta/i, icon: '📸' },
  { match: /confess/i, icon: '💌' },
  { match: /meet/i, icon: '🤝' },
  { match: /pic/i, icon: '🖼️' },
  { match: /accept/i, icon: '💍' },
  { match: /outing/i, icon: '🌆' },
  { match: /kiss/i, icon: '😘' },
  { match: /naked/i, icon: '🌙' },
  { match: /sleep/i, icon: '🛌' },
];

function iconFor(label) {
  const found = MILESTONE_ICONS.find((m) => m.match.test(label));
  return found ? found.icon : '💛';
}

function nextLine(m) {
  const left = Math.max(0, Math.ceil((m.nextAt - Date.now()) / DAY_MS));
  return `<div class="next-line">✨ Next: <b>${m.next} days</b> · ${formatDate(m.nextAt)} · in ${left} ${left === 1 ? 'day' : 'days'}</div>`;
}

function monthlyLine(n) {
  const left = Math.max(0, Math.ceil((n.at - Date.now()) / DAY_MS));
  const years = n.months / 12;
  const label = Number.isInteger(years) ? `${years} ${years === 1 ? 'year' : 'years'} anniversary 💍` : `${n.months} months`;
  return `<div class="next-line sub">💞 <b>${label}</b> · ${formatDate(n.at)} · in ${left} ${left === 1 ? 'day' : 'days'}</div>`;
}

function heroCardHtml(m) {
  const ts = new Date(m.date).getTime();
  return `<div class="hero-card">
    <div class="hero-heart">${svgIcon(HEART_PATH)}</div>
    <div class="hero-kicker">${escapeHtml(NAMES.me)} &amp; ${escapeHtml(NAMES.bae)}</div>
    <div class="hero-sub">Together since ${formatDate(ts)}</div>
    <div class="tick" data-ts="${ts}" data-dir="since" data-label="days together"></div>
    <div class="ymd" data-ts="${ts}"></div>
    ${nextLine(m)}
    ${m.nextMonthly ? monthlyLine(m.nextMonthly) : ''}
  </div>`;
}

function milestoneCardHtml(m) {
  const ts = new Date(m.date).getTime();
  return `<div class="item-card date-card">
    <div class="icon">${iconFor(m.label)}</div>
    <div class="body">
      <div class="label">${escapeHtml(m.label)}</div>
      <div class="tick" data-ts="${ts}" data-dir="since"></div>
      <div class="date">${formatDate(ts)}</div>
      ${nextLine(m)}
    </div>
  </div>`;
}

async function renderDates() {
  const listEl = document.getElementById('dates-list');
  if (!listEl.innerHTML) listEl.innerHTML = '<div class="empty-note">Loading...</div>';
  await loadMilestones();
  if (!milestones.length) {
    listEl.innerHTML = '<div class="empty-note">Could not load your dates</div>';
    return;
  }
  const hero = milestones.find((m) => m.hero);
  const others = milestones.filter((m) => !m.hero).sort((a, b) => new Date(a.date) - new Date(b.date));
  listEl.innerHTML =
    (hero ? heroCardHtml(hero) : '') +
    '<div class="section-title">Our moments</div>' +
    others.map(milestoneCardHtml).join('');
  tickAll();
}

/* ---------- Ask ---------- */

const questionInput = document.getElementById('question-input');
const questionSendBtn = document.getElementById('question-send');
const questionsListEl = document.getElementById('questions-list');

questionSendBtn.addEventListener('click', async () => {
  const q = questionInput.value.trim();
  if (!person || !q) return;
  questionSendBtn.disabled = true;
  try {
    await api('/api/questions', 'POST', { from: person, question: q });
    questionInput.value = '';
    setStatus('Question sent 💌');
    loadQuestions();
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    questionSendBtn.disabled = false;
  }
});

function renderQuestionCard(q) {
  const other = person === 'me' ? 'bae' : 'me';
  const canAnswer = !q.answer && q.askedBy !== person;
  let html = `<div class="item-card question-card">
    <div class="q-row">
      <div>
        <div class="q">${escapeHtml(q.question)}</div>
        <div class="meta">asked by ${escapeHtml(nameOf(q.askedBy))} · ${timeAgo(q.askedAt)}</div>
      </div>
      <button class="icon-btn danger" data-action="delete-question" data-id="${q.id}" title="Delete">✕</button>
    </div>`;

  if (q.answer) {
    html += `<div class="a"><strong>${escapeHtml(nameOf(q.answeredBy))}:</strong> ${escapeHtml(q.answer)}</div>`;
  } else if (canAnswer) {
    html += `<form class="answer-form" data-id="${q.id}">
      <input class="text-input" type="text" placeholder="Your answer..." maxlength="500" />
      <button type="submit" class="primary-btn small">Reply</button>
    </form>`;
  } else {
    html += `<div class="waiting">Waiting for ${escapeHtml(nameOf(other))}'s answer… they'll get a reminder 🔔</div>`;
  }
  return `${html}</div>`;
}

async function loadQuestions() {
  if (!questionsListEl.innerHTML) questionsListEl.innerHTML = '<div class="empty-note">Loading...</div>';
  try {
    const questions = await api('/api/questions');
    questionsListEl.innerHTML = questions.length
      ? questions.map(renderQuestionCard).join('')
      : '<div class="empty-note">No questions yet, ask something! 💭</div>';
  } catch (err) {
    questionsListEl.innerHTML = '<div class="empty-note">Could not load questions</div>';
  }
}

questionsListEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-question"]');
  if (!btn || !confirm('Delete this question?')) return;
  try {
    await api(`/api/questions/${btn.dataset.id}`, 'DELETE');
    loadQuestions();
  } catch (err) {
    setStatus(err.message, true);
  }
});

questionsListEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target.closest('.answer-form');
  if (!form) return;
  const answer = form.querySelector('input').value.trim();
  if (!answer) return;
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    await api(`/api/questions/${form.dataset.id}/answer`, 'POST', { from: person, answer });
    loadQuestions();
  } catch (err) {
    setStatus(err.message, true);
    btn.disabled = false;
  }
});

/* ---------- Places ---------- */

const placeFolderInput = document.getElementById('place-folder');
const placeTitleInput = document.getElementById('place-title');
const placeUrlInput = document.getElementById('place-url');
const placeSendBtn = document.getElementById('place-send');
const folderCreateBtn = document.getElementById('folder-create');
const placesListEl = document.getElementById('places-list');

let placesData = {};
let editingLinkId = null;

folderCreateBtn.addEventListener('click', async () => {
  const folder = placeFolderInput.value.trim();
  if (!folder) {
    setStatus('Type a folder name first', true);
    return;
  }
  folderCreateBtn.disabled = true;
  try {
    const data = await api('/api/places/folders', 'POST', { folder });
    placesData = data.places;
    renderPlaces();
    setStatus(`Folder "${folder}" ready 📁`);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    folderCreateBtn.disabled = false;
  }
});

placeSendBtn.addEventListener('click', async () => {
  const folder = placeFolderInput.value.trim();
  const url = placeUrlInput.value.trim();
  const title = placeTitleInput.value.trim();
  if (!person || !folder || !url) {
    setStatus('Please fill in a folder name and a link', true);
    return;
  }
  placeSendBtn.disabled = true;
  try {
    const data = await api('/api/places/links', 'POST', { from: person, folder, url, title });
    placesData = data.places;
    placeTitleInput.value = '';
    placeUrlInput.value = '';
    renderPlaces();
    setStatus('Place added 📍');
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    placeSendBtn.disabled = false;
  }
});

function linkTitle(l) {
  if (l.title !== l.url) return l.title;
  try {
    return new URL(l.url).hostname.replace(/^www\./, '');
  } catch {
    return l.url;
  }
}

function linkItemHtml(folder, l) {
  if (l.id === editingLinkId) {
    return `<div class="link-item">
      <form class="link-edit" data-folder="${escapeHtml(folder)}" data-id="${l.id}">
        <input class="text-input" name="title" placeholder="Name (optional)" maxlength="100" value="${escapeHtml(l.title === l.url ? '' : l.title)}" />
        <input class="text-input" name="url" placeholder="Link" value="${escapeHtml(l.url)}" />
        <input class="text-input" name="folder" list="folder-options" placeholder="Folder" maxlength="40" value="${escapeHtml(folder)}" />
        <div class="row">
          <button type="submit" class="primary-btn small">Save</button>
          <button type="button" class="ghost-btn" data-action="cancel-edit">Cancel</button>
        </div>
      </form>
    </div>`;
  }
  return `<div class="link-item">
    <div class="link-info">
      <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkTitle(l))}</a>
      <div class="meta">added by ${escapeHtml(nameOf(l.addedBy))} · ${timeAgo(l.addedAt)}</div>
    </div>
    <div class="link-actions">
      <button class="icon-btn" data-action="edit-link" data-id="${l.id}" title="Edit">✎</button>
      <button class="icon-btn danger" data-action="delete-link" data-folder="${escapeHtml(folder)}" data-id="${l.id}" title="Delete">✕</button>
    </div>
  </div>`;
}

function renderPlaces() {
  const folders = Object.keys(placesData);
  document.getElementById('folder-options').innerHTML = folders
    .map((f) => `<option value="${escapeHtml(f)}"></option>`)
    .join('');

  if (!folders.length) {
    placesListEl.innerHTML = '<div class="empty-note">No folders yet, create one above 📁</div>';
    return;
  }

  placesListEl.innerHTML = folders
    .map((folder) => {
      const links = placesData[folder];
      const items = links.length
        ? links.map((l) => linkItemHtml(folder, l)).join('')
        : '<div class="empty-note">No links in this folder yet</div>';
      return `<div class="folder-block">
        <div class="folder-head">
          <div class="folder-title">📁 ${escapeHtml(folder)}</div>
          <div class="folder-actions">
            <button class="icon-btn" data-action="rename-folder" data-folder="${escapeHtml(folder)}" title="Rename folder">✎</button>
            <button class="icon-btn danger" data-action="delete-folder" data-folder="${escapeHtml(folder)}" title="Delete folder">🗑</button>
          </div>
        </div>
        ${items}
      </div>`;
    })
    .join('');
}

async function loadPlaces() {
  if (!placesListEl.innerHTML) placesListEl.innerHTML = '<div class="empty-note">Loading...</div>';
  try {
    placesData = await api('/api/places');
    renderPlaces();
  } catch (err) {
    placesListEl.innerHTML = '<div class="empty-note">Could not load places</div>';
  }
}

placesListEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, folder, id } = btn.dataset;

  try {
    if (action === 'edit-link') {
      editingLinkId = id;
      renderPlaces();
    } else if (action === 'cancel-edit') {
      editingLinkId = null;
      renderPlaces();
    } else if (action === 'delete-link') {
      if (!confirm('Remove this link?')) return;
      const data = await api(`/api/places/links/${encodeURIComponent(folder)}/${id}`, 'DELETE');
      placesData = data.places;
      renderPlaces();
    } else if (action === 'rename-folder') {
      const name = (prompt('Rename folder', folder) || '').trim();
      if (!name || name === folder) return;
      const data = await api(`/api/places/folders/${encodeURIComponent(folder)}`, 'PUT', { name });
      placesData = data.places;
      renderPlaces();
    } else if (action === 'delete-folder') {
      const count = (placesData[folder] || []).length;
      if (!confirm(`Delete the folder "${folder}"${count ? ` and its ${count} link${count === 1 ? '' : 's'}` : ''}?`)) return;
      const data = await api(`/api/places/folders/${encodeURIComponent(folder)}`, 'DELETE');
      placesData = data.places;
      renderPlaces();
    }
  } catch (err) {
    setStatus(err.message, true);
  }
});

placesListEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target.closest('.link-edit');
  if (!form) return;
  const fields = new FormData(form);
  try {
    const data = await api(`/api/places/links/${encodeURIComponent(form.dataset.folder)}/${form.dataset.id}`, 'PUT', {
      title: fields.get('title'),
      url: fields.get('url'),
      folder: fields.get('folder'),
    });
    placesData = data.places;
    editingLinkId = null;
    renderPlaces();
    setStatus('Saved ✏️');
  } catch (err) {
    setStatus(err.message, true);
  }
});

/* ---------- Meet (countdowns) ---------- */

const eventTitleInput = document.getElementById('event-title');
const eventAtInput = document.getElementById('event-at');
const eventSaveBtn = document.getElementById('event-save');
const eventCancelBtn = document.getElementById('event-cancel');
const eventFormTitle = document.getElementById('event-form-title');
const meetHeroEl = document.getElementById('meet-hero');
const eventsListEl = document.getElementById('events-list');
const meetTabEl = document.getElementById('tab-meet');

let eventsData = [];
let editingEventId = null;

function toLocalInputValue(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function resetEventForm() {
  editingEventId = null;
  eventTitleInput.value = '';
  eventAtInput.value = '';
  eventFormTitle.textContent = 'Add a countdown';
  eventSaveBtn.textContent = 'Add countdown ✈️';
  eventCancelBtn.classList.add('hidden');
}

function eventActionsHtml(id) {
  return `<button class="icon-btn" data-action="edit-event" data-id="${id}" title="Edit">✎</button>
    <button class="icon-btn danger" data-action="delete-event" data-id="${id}" title="Delete">✕</button>`;
}

function heroEventHtml(e) {
  return `<div class="hero-card">
    <div class="hero-kicker"><span class="plane">✈️</span> Next time we meet</div>
    <div class="hero-title">${escapeHtml(e.title)}</div>
    <div class="hero-sub">${formatDateTime(e.at)}</div>
    <div class="tick" data-ts="${e.at}" data-dir="until" data-label="days to go"></div>
    <div class="hero-actions">${eventActionsHtml(e.id)}</div>
  </div>`;
}

function eventCardHtml(e, past) {
  return `<div class="item-card event-card${past ? ' past' : ''}">
    <div class="info">
      <div class="label">${escapeHtml(e.title)}</div>
      <div class="date">${formatDateTime(e.at)}</div>
      <div class="tick" data-ts="${e.at}" data-dir="${past ? 'since' : 'until'}" data-label="${past ? 'days ago' : 'days to go'}"></div>
    </div>
    <div class="actions">${eventActionsHtml(e.id)}</div>
  </div>`;
}

function renderEvents() {
  const now = Date.now();
  const upcoming = eventsData.filter((e) => e.at > now).sort((a, b) => a.at - b.at);
  const past = eventsData.filter((e) => e.at <= now).sort((a, b) => b.at - a.at);

  meetHeroEl.innerHTML = upcoming.length
    ? heroEventHtml(upcoming[0])
    : `<div class="hero-card">
        <div class="hero-kicker"><span class="plane">✈️</span> When do we meet next?</div>
        <div class="hero-sub">Add the day below and watch the countdown begin</div>
      </div>`;

  const rest = upcoming.slice(1);
  eventsListEl.innerHTML =
    (rest.length ? `<div class="section-title">Coming up</div>${rest.map((e) => eventCardHtml(e, false)).join('')}` : '') +
    (past.length ? `<div class="section-title">Memories</div>${past.map((e) => eventCardHtml(e, true)).join('')}` : '');
  tickAll();
}

async function loadEvents() {
  try {
    eventsData = await api('/api/events');
    renderEvents();
  } catch (err) {
    eventsListEl.innerHTML = '<div class="empty-note">Could not load countdowns</div>';
  }
}

eventSaveBtn.addEventListener('click', async () => {
  const title = eventTitleInput.value.trim();
  const at = new Date(eventAtInput.value).getTime();
  if (!person || !title || !eventAtInput.value || Number.isNaN(at)) {
    setStatus('Add a title and a date', true);
    return;
  }
  eventSaveBtn.disabled = true;
  try {
    if (editingEventId) {
      await api(`/api/events/${editingEventId}`, 'PUT', { from: person, title, at });
      setStatus('Countdown updated ✏️');
    } else {
      await api('/api/events', 'POST', { from: person, title, at });
      setStatus('Countdown added ✈️');
    }
    resetEventForm();
    loadEvents();
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    eventSaveBtn.disabled = false;
  }
});

eventCancelBtn.addEventListener('click', resetEventForm);

meetTabEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const entry = eventsData.find((ev) => ev.id === btn.dataset.id);
  if (!entry) return;

  if (btn.dataset.action === 'edit-event') {
    editingEventId = entry.id;
    eventTitleInput.value = entry.title;
    eventAtInput.value = toLocalInputValue(entry.at);
    eventFormTitle.textContent = 'Edit countdown';
    eventSaveBtn.textContent = 'Save changes 💾';
    eventCancelBtn.classList.remove('hidden');
    eventTitleInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (btn.dataset.action === 'delete-event') {
    if (!confirm(`Delete "${entry.title}"?`)) return;
    try {
      await api(`/api/events/${entry.id}`, 'DELETE');
      if (editingEventId === entry.id) resetEventForm();
      loadEvents();
    } catch (err) {
      setStatus(err.message, true);
    }
  }
});

/* ---------- Init ---------- */

createHearts();

if (person) {
  showMainScreen();
  loadMilestones();
  syncSubscription();
}
