# Us 💛

A tiny two-person notification app. Each of you opens the page once, picks
"It's me" or "It's bae", and taps a button to ping the other person's phone
with a push notification (eating, sleepy, miss you, love you, etc).

## Deploying to Render (free)

1. Push this folder to a new GitHub repo.
2. Go to https://render.com, sign in with GitHub, click **New +** → **Web Service**.
3. Pick this repo. Set:
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
   - **Instance type:** Free
4. Under **Environment**, add these variables (values are in your local `.env` file, not committed to git):
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT` (e.g. `mailto:you@example.com`)
5. Click **Create Web Service**. Render gives you a URL like `https://us-app-xxxx.onrender.com`.

## Using it

1. On each phone, open the Render URL in the browser.
2. Tap "It's me" or "It's bae" (one each — this is remembered on that phone only).
3. Tap **Enable notifications** and allow the permission prompt.
4. (iPhone only) For notifications to work reliably, tap Share → **Add to Home Screen** first, then open the app from the home screen icon and enable notifications from there.
5. Tap any button to ping the other person.

Note: Render's free tier sleeps after inactivity, so the very first ping after
a quiet period may take 20-30 seconds to arrive while the server wakes up.
