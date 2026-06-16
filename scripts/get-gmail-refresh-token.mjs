// One-time local helper: run this on your own machine to obtain a Gmail
// refresh token for the create_email_draft tool. Never deploy or run this
// on the server - it's only meant to be run once, interactively, by you.
//
// Usage:
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run gmail:auth
//
// See README.md "Gmail draft setup" for how to create the OAuth client.

import http from 'node:http';
import { google } from 'googleapis';

const PORT = 8765;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first, e.g.:');
  console.error('  GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run gmail:auth');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  // Draft-only scope: this app can never read your inbox or send mail on its own.
  scope: ['https://www.googleapis.com/auth/gmail.compose']
});

console.log('\nOpen this URL and sign in with the Google account you want drafts created in:\n');
console.log(authUrl);
console.log(`\nWaiting for the redirect to ${REDIRECT_URI} ...\n`);

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) {
    res.writeHead(404).end();
    return;
  }

  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/plain' }).end(`Authorization failed: ${error}`);
    console.error(`Authorization failed: ${error}`);
    server.close();
    process.exit(1);
    return;
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Missing authorization code.');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/plain' })
      .end('Done - you can close this tab and return to the terminal.');

    if (!tokens.refresh_token) {
      console.error(
        '\nNo refresh token returned. Revoke prior access at ' +
        'https://myaccount.google.com/permissions and run this again so the consent screen shows fresh.'
      );
      process.exit(1);
      return;
    }

    console.log('\nSuccess! Add this to your Vercel project environment variables:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('\n(along with the GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET you already have.)\n');
  } catch (e) {
    console.error('Failed to exchange authorization code:', e.message);
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Token exchange failed, check the terminal.');
  } finally {
    server.close();
  }
});

server.listen(PORT);
