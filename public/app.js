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
      if (res.ok) {
        setStatus('Sent 💌');
      } else {
        setStatus(data.error || 'Could not send', true);
      }
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

if (person) {
  showMainScreen();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js');
}
