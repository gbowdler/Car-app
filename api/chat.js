import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const MAX_TOOL_ITERATIONS = 6;
const MAX_MESSAGES = 60;
const MAX_PAYLOAD_CHARS = 60000;

const SERVER_TOOL_NAMES = new Set(['create_email_draft']);

const SYSTEM_PROMPT = `You are "Dash", a hands-free voice assistant built into a driver's dashboard app. The user is very likely driving or sitting in traffic and interacting with you by voice, glancing at the screen briefly at most.

Rules:
- Keep replies to 1-2 short, natural sentences. Never read out code, JSON, URLs, or raw tool output aloud, and never recite long lists - summarize them instead. Full detail is shown on screen separately, so you do not need to repeat it.
- Be direct and conversational. No filler like "Sure, I can help with that!" - just do it or answer.
- Use the available tools when the user asks for an action you can actually perform. If no tool fits, answer conversationally (general questions, brainstorming, drafting text).
- If a tool reports ok:false, briefly explain the issue in plain language and suggest a fix (e.g. "set that up in the app first"). Don't retry blindly.
- You can draft email text in conversation any time. If the create_email_draft tool is available, use it to create a real Gmail draft when asked - but NEVER claim to have sent an email. Drafts only, the user always sends it themselves.
- Composing a WhatsApp message only pre-fills it - the user still taps send themselves. Never imply it has already been sent.
- Never invent actions you don't have a tool for (e.g. you cannot make calls, send texts beyond the WhatsApp draft tool, read someone else's messages, access calendars, or control the car). If asked, say it's not supported yet.
- Only ask a clarifying question if you truly cannot proceed without it; otherwise make a reasonable assumption and briefly say what you assumed.`;

const BASE_TOOLS = [
  {
    name: 'navigate_home',
    description: "Open turn-by-turn navigation to the user's saved home address.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'find_fuel',
    description: 'Open a search for nearby open petrol stations.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'share_location',
    description: "Get the user's current GPS location and a what3words link, shown on screen.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'compose_whatsapp_message',
    description: "Pre-fill WhatsApp with a message to the user's saved contact. The user must still tap send themselves - this never sends automatically.",
    input_schema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'The message text to pre-fill.' } },
      required: ['message']
    }
  },
  {
    name: 'add_voice_note',
    description: "Save a short note to the driver's local voice log.",
    input_schema: {
      type: 'object',
      properties: { note: { type: 'string', description: 'The note text to save.' } },
      required: ['note']
    }
  },
  {
    name: 'get_recent_notes',
    description: 'Retrieve the most recently saved voice notes.',
    input_schema: {
      type: 'object',
      properties: { count: { type: 'integer', description: 'How many recent notes to retrieve. Defaults to 5.' } }
    }
  }
];

const EMAIL_TOOL = {
  name: 'create_email_draft',
  description: "Create a draft email in the user's Gmail account. This only saves a draft - it never sends the email.",
  input_schema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address.' },
      subject: { type: 'string', description: 'Email subject line.' },
      body: { type: 'string', description: 'Email body text.' }
    },
    required: ['to', 'subject', 'body']
  }
};

function isGmailConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN
  );
}

function getGmailClient() {
  if (!isGmailConfigured()) return null;
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

function encodeEmailRaw({ to, subject, body }) {
  const lines = [
    `To: ${to}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    `Subject: ${subject}`,
    '',
    body
  ];
  return Buffer.from(lines.join('\r\n'), 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function createEmailDraft({ to, subject, body } = {}) {
  try {
    const gmail = getGmailClient();
    if (!gmail) {
      return { ok: false, error: 'Gmail integration is not configured on the server.' };
    }
    if (!to || !subject || !body) {
      return { ok: false, error: 'Missing recipient, subject, or body.' };
    }
    await gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw: encodeEmailRaw({ to, subject, body }) } }
    });
    return { ok: true };
  } catch (e) {
    console.error('Gmail draft creation failed:', e);
    return { ok: false, error: 'Failed to create the email draft.' };
  }
}

async function executeServerTool(name, input) {
  if (name === 'create_email_draft') return createEmailDraft(input);
  return { ok: false, error: `Unknown server tool: ${name}` };
}

function toolResultBlock(toolUseId, result) {
  return { type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify(result) };
}

function checkSharedSecret(req) {
  const required = process.env.ASSISTANT_SHARED_SECRET;
  if (!required) return true; // not configured: no gate
  return req.headers['x-assistant-key'] === required;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!checkSharedSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Server is not configured with an Anthropic API key.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
  }

  const incomingMessages = body && body.messages;
  if (!Array.isArray(incomingMessages) || incomingMessages.length === 0) {
    res.status(400).json({ error: 'messages must be a non-empty array' });
    return;
  }
  if (incomingMessages.length > MAX_MESSAGES) {
    res.status(400).json({ error: 'Conversation is too long for this session, please start a new one.' });
    return;
  }
  if (JSON.stringify(incomingMessages).length > MAX_PAYLOAD_CHARS) {
    res.status(400).json({ error: 'Request payload too large.' });
    return;
  }

  const tools = isGmailConfigured() ? [...BASE_TOOLS, EMAIL_TOOL] : BASE_TOOLS;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages = [...incomingMessages];

  try {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools,
        messages
      });

      if (response.stop_reason !== 'tool_use') {
        const text = response.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(' ')
          .trim();

        res.status(200).json({
          type: 'final',
          text: text || "I didn't catch a response for that, can you try again?",
          assistantMessage: { role: response.role, content: response.content }
        });
        return;
      }

      const toolUseBlocks = response.content.filter((block) => block.type === 'tool_use');
      const serverBlocks = toolUseBlocks.filter((b) => SERVER_TOOL_NAMES.has(b.name));
      const clientBlocks = toolUseBlocks.filter((b) => !SERVER_TOOL_NAMES.has(b.name));

      const serverResults = await Promise.all(
        serverBlocks.map(async (b) => toolResultBlock(b.id, await executeServerTool(b.name, b.input)))
      );

      if (clientBlocks.length > 0) {
        res.status(200).json({
          type: 'tool_calls',
          assistantMessage: { role: response.role, content: response.content },
          toolCalls: clientBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input })),
          pendingToolResults: serverResults
        });
        return;
      }

      // Only server tools were requested - resolve them now and keep looping.
      messages.push({ role: response.role, content: response.content });
      messages.push({ role: 'user', content: serverResults });
    }

    res.status(200).json({
      type: 'final',
      text: "That's taking a few too many steps, let's try that again in a moment."
    });
  } catch (e) {
    console.error('Anthropic request failed:', e);
    res.status(500).json({ error: 'Failed to reach the assistant.' });
  }
}
