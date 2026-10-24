# Us 💛

A small two-person app for Vinita and Sharvin: quick pings, a 24-hour history,
a live "days together" page, questions for each other, saved places, and
countdowns to the next time they meet. Everything that matters sends a push
notification to the other person's phone.

## Deploying to Render (free)

1. Push this folder to a GitHub repo.
2. Go to https://render.com, sign in with GitHub, click **New +** → **Web Service**.
3. Pick this repo. Set:
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
   - **Instance type:** Free
4. Under **Environment**, add these variables (never commit them):
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (e.g. `mailto:you@example.com`)
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (a free Upstash Redis database; Render's free disk is wiped whenever the app sleeps, so everything is stored in Redis)
5. Click **Create Web Service**.

Without the Upstash variables the app falls back to JSON files in `data/`, which is fine for local development.

## Scheduled checks

`.github/workflows/scheduled-checks.yml` calls `/api/cron/check` every 30 minutes
(and wakes the sleeping Render app). That endpoint sends, between 08:00 and 23:00 Malaysia time:

- **"Together since" alerts** (12 Apr 2025) at 100, 200, 300… days or a repeating number such as 111, 222, 444, 555, 1111, plus a reminder on the 12th of every month and each yearly anniversary
- **Big milestones** on every other date, only at 1000, 2000, 3000… days (the other dates just show their counters)
- **Question reminders** to whoever hasn't answered yet (after 1 hour, then every 4 hours, up to 5 times)
- **Countdown reminders** 7 days and 1 day before a meet-up, and on the day

If the app's URL changes, update it in that workflow file. GitHub pauses scheduled
workflows on a repo with no activity for 60 days, so push any small change to wake it again.

## Using it

1. On each phone, open the app link in the browser.
2. Tap "I'm Vinita" or "I'm Sharvin" (remembered on that phone only).
3. Tap **Enable notifications** and allow the permission prompt.
4. (iPhone only) Tap Share → **Add to Home Screen** first, then open the app from the home screen icon and enable notifications from there.
