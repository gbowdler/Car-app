# DriveDash

A driving dashboard web app for a phone cradle, with a hands-free voice
assistant built in. No app store install - open it in a mobile browser.

## What's here

- **Dashboard** (`index.html`, `app.js`, `style.css`) - clock, GPS speedometer,
  navigate home, find open fuel stations, voice-dictated WhatsApp message,
  voice notes log, what3words location sharing. Unchanged from before, still
  fully usable without the assistant.
- **Voice assistant** (`assistant.js` + `api/chat.js`) - push-to-talk button
  that lets you talk to Claude, with real tool access to the actions above
  plus optional Gmail draft creation. The Anthropic API key lives only in
  the backend; the browser never sees it.

## How the assistant works

1. Tap **TALK**, speak one utterance (stops automatically after a pause or 8s).
2. The transcript is sent to `/api/chat`, a serverless function that calls
   Claude with a fixed set of tools.
3. If Claude wants to run a browser-only action (navigate, share location,
   compose a WhatsApp message, save/read a voice note), the backend hands
   that request back to the browser, which executes it via
   `DriveDashApp.actions` and reports the result back. This loop can repeat
   automatically without you speaking again.
4. If Claude wants to create a Gmail draft, the backend does that itself
   (server-side tool, needs Gmail set up - see below).
5. Claude's final reply is short by design and gets spoken aloud. Anything
   long (note lists, drafts, location data) goes to the on-screen
   **TRANSCRIPT** panel instead of being read out.

## Setup

```
npm install
```

### 1. Deploy to Vercel

This repo is zero-config for Vercel: static files at the root, the API
route at `api/chat.js`.

1. Import the repo at vercel.com (or `vercel` via the CLI).
2. In Project Settings -> Environment Variables, set at minimum:
   - `ANTHROPIC_API_KEY` - required.
   - `ASSISTANT_SHARED_SECRET` - strongly recommended. Any random string.
     Without this, anyone who finds your deployed URL can run up your
     Anthropic bill (and, if Gmail is configured, create drafts in your
     inbox). With it, the app will prompt you once for the same passphrase
     and remember it on that device.
3. Deploy. The dashboard and assistant share the same URL.

### 2. Local development

Use the Vercel CLI so the static files and the API function are served from
the same origin (the frontend calls the relative path `/api/chat`, which
won't resolve correctly if you serve the static files separately):

```
npx vercel dev
```

Create a `.env` file locally (see `.env.example`) for `vercel dev` to pick up.

### 3. Gmail draft setup (optional)

Only needed if you want the `create_email_draft` tool. Without it, Claude
will just say drafting isn't set up yet if you ask for a real draft - it can
still compose the text conversationally.

The app's OAuth scope is `gmail.compose`, which can create/edit drafts but
cannot read your inbox or send mail by itself - the code only ever calls the
"create draft" endpoint.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   project and enable the **Gmail API**.
2. Configure the OAuth consent screen (External is fine; add your own
   Google account as a test user - no need to publish the app).
3. Create an OAuth Client ID of type **Desktop app**. Copy the client ID
   and secret.
4. Run the one-time local helper (on your own machine, never on the
   server):
   ```
   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run gmail:auth
   ```
   Open the printed URL, sign in, approve. The script prints a
   `GOOGLE_REFRESH_TOKEN`.
5. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN`
   to the Vercel project's environment variables and redeploy.

## Voice tools available today

| Tool | What it does | Confirmation |
|---|---|---|
| `navigate_home` | Opens directions to your saved home address | n/a (read-only nav) |
| `find_fuel` | Opens a search for nearby open petrol stations | n/a |
| `share_location` | Gets GPS + a what3words link, shown on screen | n/a |
| `compose_whatsapp_message` | Pre-fills WhatsApp to your saved contact | **You** still tap send |
| `add_voice_note` | Saves a timestamped note locally | n/a (deletable later in VIEW LOGS) |
| `get_recent_notes` | Reads back recent notes (summarized, not recited) | n/a |
| `create_email_draft` | Creates a Gmail draft (if configured) | **You** still review & send |

## Guardrails (by design, not yet wired up)

These are intentionally **not** voice-triggerable in v1, because they're
either irreversible or because a misheard word could trigger them while
driving:

- **Sending** the WhatsApp message or the email - both tools only ever
  prepare a draft/pre-filled message; a manual tap is always required to
  actually send.
- **Deleting** voice notes or resetting saved settings (home address,
  WhatsApp contact) - still manual-only actions behind the existing
  `VIEW LOGS` screen (which already requires a `confirm()` tap).
- Anything outside this tool list (calls, payments, other apps/accounts) -
  the system prompt explicitly tells Claude to say it's unsupported rather
  than improvise.

If you want to add a new action later that *is* destructive, give it a
manual confirmation step (a tap, not a spoken "yes") before wiring it into
a tool.

## Known limitations

- **Push-to-talk only**, no wake word - avoids continuous mic listening,
  battery drain, and accidental triggers while driving.
- **No persistent conversation** - the chat history lives in memory and
  resets on page reload (no account system, nothing to log into).
- **iOS Safari speech quirk** - `assistant.js` "primes" speech synthesis
  on each tap to work around iOS's stricter autoplay rules, but TTS
  reliability on iOS Safari is worth verifying on your actual device.
- **`navigate_home`/`find_fuel`/`compose_whatsapp_message`** still do a
  full-page navigation (`window.location.href`), same as the original
  manual buttons - this was kept deliberately rather than switched to
  `window.open()`, since a `window.open()` call several async steps removed
  from the original tap is likely to be blocked by mobile popup blockers.
  The assistant speaks its short reply first, then navigates.
- The `ASSISTANT_SHARED_SECRET` passphrase is a single shared secret, not
  per-user auth - adequate for a personal app, not for multiple users.
