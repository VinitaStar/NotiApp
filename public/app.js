function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

const personScreen = document.getElementById('person-screen');
const mainScreen = document.getElementById('main-screen');
const statusEl = document.getElementById('status');
const whoAmILabel = document.getElementById('who-am-i');
const enableBtn = document.getElementById('enable-notifications');

let person = localStorage.getItem('us-app-person');

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? '#c0392b' : '#666';
}

function showMainScreen() {
  personScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
  whoAmILabel.textContent = person === 'me' ? 'You are: Me 💗' : 'You are: Bae 💛';
}

document.querySelectorAll('.person-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    person = btn.dataset.person;
    localStorage.setItem('us-app-person', person);
    showMainScreen();
  });
});

async function registerAndSubscribe() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    setStatus('This browser doesn\'t support notifications 😢', true);
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    setStatus('Notifications permission was not granted. Tap "Enable notifications" and allow it.', true);
    return;
  }

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

  const subscribeRes = await fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ person, subscription }),
  });

  if (!subscribeRes.ok) {
    setStatus('Could not save your subscription, please try again 😢', true);
    return;
  }

  setStatus('Notifications enabled! You\'ll get pinged 💌');
  enableBtn.textContent = '✅ Notifications on';
}

enableBtn.addEventListener('click', () => {
  registerAndSubscribe().catch((err) => {
    console.error(err);
    setStatus('Something went wrong enabling notifications, please try again', true);
  });
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js');
}

/* ---------- Tabs ---------- */

const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

const tabLoaders = {
  history: loadHistory,
  dates: renderDates,
  ask: loadQuestions,
  places: loadPlaces,
};

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabButtons.forEach((b) => b.classList.remove('active'));
    tabContents.forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (tabLoaders[btn.dataset.tab]) tabLoaders[btn.dataset.tab]();
  });
});

/* ---------- Ping ---------- */

document.querySelectorAll('.ping-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (!person) return;
    btn.disabled = true;
    setStatus('Sending...');
    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: person, type: btn.dataset.type }),
      });
      const data = await res.json();
      setStatus(res.ok ? 'Sent 💌' : data.error || 'Could not send', !res.ok);
    } catch (err) {
      setStatus('Network error, try again', true);
    } finally {
      btn.disabled = false;
    }
  });
});

const customInput = document.getElementById('custom-input');
const customSendBtn = document.getElementById('custom-send');

async function sendCustomMessage() {
  const message = customInput.value.trim();
  if (!person || !message) return;
  customSendBtn.disabled = true;
  setStatus('Sending...');
  try {
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: person, customMessage: message }),
    });
    const data = await res.json();
    if (res.ok) {
      setStatus('Sent 💌');
      customInput.value = '';
    } else {
      setStatus(data.error || 'Could not send', true);
    }
  } catch (err) {
    setStatus('Network error, try again', true);
  } finally {
    customSendBtn.disabled = false;
  }
}

customSendBtn.addEventListener('click', sendCustomMessage);
customInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendCustomMessage();
});

/* ---------- History ---------- */

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function loadHistory() {
  const listEl = document.getElementById('history-list');
  listEl.innerHTML = '<div class="empty-note">Loading...</div>';
  try {
    const res = await fetch('/api/messages');
    const messages = await res.json();
    if (!messages.length) {
      listEl.innerHTML = '<div class="empty-note">No messages in the last 24 hours yet</div>';
      return;
    }
    listEl.innerHTML = messages
      .map((m) => {
        const fromLabel = m.from === 'me' ? 'Me' : m.from === 'bae' ? 'Bae' : '🎉 Us';
        return `<div class="item-card">
          <div><strong>${fromLabel}</strong> — ${escapeHtml(m.title)}</div>
          <div>${escapeHtml(m.body)}</div>
          <div class="meta">${timeAgo(m.at)}</div>
        </div>`;
      })
      .join('');
  } catch (err) {
    listEl.innerHTML = '<div class="empty-note">Could not load history</div>';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------- Dates ---------- */

let milestones = [];
let datesInterval = null;

async function loadMilestones() {
  try {
    const res = await fetch('/api/milestones');
    milestones = await res.json();
  } catch (err) {
    milestones = [];
  }
}

function formatElapsed(fromDate) {
  const diff = Date.now() - fromDate.getTime();
  const totalMins = Math.floor(diff / 60000);
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;
  return `${days}d ${hours}h ${mins}m ago`;
}

async function renderDates() {
  const listEl = document.getElementById('dates-list');
  if (!milestones.length) {
    listEl.innerHTML = '<div class="empty-note">Loading...</div>';
    await loadMilestones();
  }
  listEl.innerHTML = milestones
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((m) => `<div class="item-card date-card" data-date="${m.date}">
      <div class="label">${escapeHtml(m.label)}</div>
      <div class="counter"></div>
      <div class="date">${new Date(m.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</div>
    </div>`)
    .join('');
  updateDateCounters();
  if (datesInterval) clearInterval(datesInterval);
  datesInterval = setInterval(updateDateCounters, 60000);
}

function updateDateCounters() {
  document.querySelectorAll('.date-card').forEach((card) => {
    const d = new Date(card.dataset.date);
    card.querySelector('.counter').textContent = formatElapsed(d);
  });
}

/* ---------- Ask ---------- */

const questionInput = document.getElementById('question-input');
const questionSendBtn = document.getElementById('question-send');

questionSendBtn.addEventListener('click', async () => {
  const q = questionInput.value.trim();
  if (!person || !q) return;
  questionSendBtn.disabled = true;
  try {
    const res = await fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: person, question: q }),
    });
    if (res.ok) {
      questionInput.value = '';
      setStatus('Question sent 💌');
      loadQuestions();
    } else {
      const data = await res.json();
      setStatus(data.error || 'Could not send question', true);
    }
  } catch (err) {
    setStatus('Network error, try again', true);
  } finally {
    questionSendBtn.disabled = false;
  }
});

async function loadQuestions() {
  const listEl = document.getElementById('questions-list');
  listEl.innerHTML = '<div class="empty-note">Loading...</div>';
  try {
    const res = await fetch('/api/questions');
    const questions = await res.json();
    if (!questions.length) {
      listEl.innerHTML = '<div class="empty-note">No questions yet — ask something!</div>';
      return;
    }
    listEl.innerHTML = questions.map(renderQuestionCard).join('');

    listEl.querySelectorAll('.answer-form').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = form.querySelector('input');
        const answer = input.value.trim();
        if (!answer) return;
        const id = form.dataset.id;
        const btn = form.querySelector('button');
        btn.disabled = true;
        try {
          const res = await fetch(`/api/questions/${id}/answer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: person, answer }),
          });
          if (res.ok) {
            loadQuestions();
          } else {
            const data = await res.json();
            setStatus(data.error || 'Could not send answer', true);
          }
        } catch (err) {
          setStatus('Network error, try again', true);
        } finally {
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = '<div class="empty-note">Could not load questions</div>';
  }
}

function renderQuestionCard(q) {
  const askerLabel = q.askedBy === 'me' ? 'Me' : 'Bae';
  const canAnswer = !q.answer && q.askedBy !== person;
  let html = `<div class="item-card question-card">
    <div class="q">${escapeHtml(q.question)}</div>
    <div class="q-meta">asked by ${askerLabel} · ${timeAgo(q.askedAt)}</div>`;

  if (q.answer) {
    const answererLabel = q.answeredBy === 'me' ? 'Me' : 'Bae';
    html += `<div class="a"><strong>${answererLabel}:</strong> ${escapeHtml(q.answer)}</div>`;
  } else if (canAnswer) {
    html += `<form class="answer-form" data-id="${q.id}">
      <input type="text" placeholder="Your answer..." maxlength="500" />
      <button type="submit">Reply</button>
    </form>`;
  } else {
    html += `<div class="a" style="color:#999;">Waiting for their answer...</div>`;
  }

  html += `</div>`;
  return html;
}

/* ---------- Places ---------- */

const placeFolderInput = document.getElementById('place-folder');
const placeTitleInput = document.getElementById('place-title');
const placeUrlInput = document.getElementById('place-url');
const placeSendBtn = document.getElementById('place-send');

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
    const res = await fetch('/api/places/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: person, folder, url, title }),
    });
    if (res.ok) {
      placeTitleInput.value = '';
      placeUrlInput.value = '';
      setStatus('Place added 📍');
      loadPlaces();
    } else {
      const data = await res.json();
      setStatus(data.error || 'Could not add place', true);
    }
  } catch (err) {
    setStatus('Network error, try again', true);
  } finally {
    placeSendBtn.disabled = false;
  }
});

async function loadPlaces() {
  const listEl = document.getElementById('places-list');
  const folderOptions = document.getElementById('folder-options');
  listEl.innerHTML = '<div class="empty-note">Loading...</div>';
  try {
    const res = await fetch('/api/places');
    const places = await res.json();
    const folders = Object.keys(places);

    folderOptions.innerHTML = folders.map((f) => `<option value="${escapeHtml(f)}"></option>`).join('');

    if (!folders.length) {
      listEl.innerHTML = '<div class="empty-note">No places saved yet</div>';
      return;
    }

    listEl.innerHTML = folders
      .map((folder) => {
        const links = places[folder];
        if (!links.length) return '';
        const linkItems = links
          .map(
            (l) => `<div class="link-item">
              <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.title)}</a>
              <button class="del-btn" data-folder="${escapeHtml(folder)}" data-id="${l.id}">✕</button>
            </div>`
          )
          .join('');
        return `<div class="folder-block">
          <div class="folder-title">${escapeHtml(folder)}</div>
          ${linkItems}
        </div>`;
      })
      .join('');

    listEl.querySelectorAll('.del-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await fetch(`/api/places/links/${encodeURIComponent(btn.dataset.folder)}/${btn.dataset.id}`, {
            method: 'DELETE',
          });
          loadPlaces();
        } catch (err) {
          setStatus('Could not remove that place', true);
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = '<div class="empty-note">Could not load places</div>';
  }
}

/* ---------- Init ---------- */

if (person) {
  showMainScreen();
  loadMilestones();
}
