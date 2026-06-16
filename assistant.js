// Push-to-talk voice assistant: captures one utterance via the Web Speech
// API, relays the conversation to /api/chat (which talks to Claude and
// owns the API key), executes any browser-only tool calls Claude requests,
// and speaks the final short reply back via SpeechSynthesis. Long/detailed
// tool output stays in the on-screen transcript - only short replies are
// ever spoken.
const AssistantApp = (function () {
    const API_ENDPOINT = '/api/chat';
    const SPEECH_TIMEOUT_MS = 8000;
    const MAX_TURN_STEPS = 6;
    const KEY_STORAGE = 'assistantKey';
    const KEY_PROMPTED_STORAGE = 'assistantKeyPrompted';

    let talkBtn, statusEl, transcriptBtn, panel, transcriptEl, closePanelBtn;
    let recognizer = null;
    let activeAbortController = null;
    let currentState = 'idle';
    let pendingNavigateUrl = null;
    let conversation = [];
    const transcriptEntries = [];

    const CLIENT_TOOL_HANDLERS = {
        navigate_home: () => DriveDashApp.actions.navigateHome(),
        find_fuel: () => DriveDashApp.actions.findFuel(),
        share_location: () => DriveDashApp.actions.shareLocation(),
        compose_whatsapp_message: (input) => DriveDashApp.actions.composeWhatsAppMessage(input),
        add_voice_note: (input) => DriveDashApp.actions.addVoiceNote(input),
        get_recent_notes: (input) => DriveDashApp.actions.getRecentNotes(input)
    };

    function truncate(text, max) {
        if (!text) return '';
        return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    }

    function setState(state, label) {
        currentState = state;
        if (talkBtn) {
            talkBtn.classList.remove('listening', 'thinking', 'speaking');
            if (state !== 'idle') talkBtn.classList.add(state);
            talkBtn.textContent = state === 'idle' ? 'TALK' : state.toUpperCase();
        }
        if (statusEl && label !== undefined) {
            statusEl.textContent = label;
        }
    }

    function appendTranscript(role, text) {
        transcriptEntries.push({ role, text });
        renderTranscript();
    }

    function renderTranscript() {
        if (!transcriptEl) return;
        transcriptEl.innerHTML = '';

        if (transcriptEntries.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'transcript-empty';
            empty.textContent = 'Nothing yet — tap TALK to start.';
            transcriptEl.appendChild(empty);
            return;
        }

        transcriptEntries.forEach(({ role, text }) => {
            const row = document.createElement('div');
            row.className = `transcript-row ${role}`;

            const roleLabel = document.createElement('span');
            roleLabel.className = 'role';
            roleLabel.textContent = role === 'user' ? 'YOU' : role === 'assistant' ? 'DASH' : 'ERROR';

            const textEl = document.createElement('p');
            textEl.className = 'text';
            textEl.textContent = text;

            row.appendChild(roleLabel);
            row.appendChild(textEl);
            transcriptEl.appendChild(row);
        });

        transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }

    // --- AUTH (lightweight passphrase gate, asked once like home address/contact) ---
    function getAssistantKey() {
        if (localStorage.getItem(KEY_PROMPTED_STORAGE) === 'true') {
            return localStorage.getItem(KEY_STORAGE) || '';
        }
        const input = prompt('Assistant passphrase (leave blank if none set up):');
        const value = (input || '').trim();
        localStorage.setItem(KEY_STORAGE, value);
        localStorage.setItem(KEY_PROMPTED_STORAGE, 'true');
        return value;
    }

    function clearAssistantKey() {
        localStorage.removeItem(KEY_STORAGE);
        localStorage.removeItem(KEY_PROMPTED_STORAGE);
    }

    // --- SPEECH OUTPUT ---
    function speak(text) {
        return new Promise((resolve) => {
            if (!('speechSynthesis' in window) || !text) {
                resolve();
                return;
            }
            try {
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = 'en-GB';
                utterance.onstart = () => setState('speaking', truncate(text, 70));
                utterance.onend = resolve;
                utterance.onerror = resolve;
                window.speechSynthesis.speak(utterance);
            } catch (e) {
                console.error('Speech synthesis failed:', e);
                resolve();
            }
        });
    }

    // iOS Safari only allows speechSynthesis after a user gesture has
    // "primed" it in-session; a near-silent utterance fired synchronously
    // inside the tap handler keeps later async speak() calls working.
    function primeSpeechSynthesis() {
        if (!('speechSynthesis' in window)) return;
        try {
            const primer = new SpeechSynthesisUtterance(' ');
            primer.volume = 0;
            window.speechSynthesis.speak(primer);
        } catch (e) {
            // Non-fatal: worst case TTS needs a second tap on some browsers.
        }
    }

    async function speakAndNavigate(text) {
        await speak(text);
        if (pendingNavigateUrl) {
            const url = pendingNavigateUrl;
            pendingNavigateUrl = null;
            window.location.href = url;
        }
    }

    // --- SPEECH INPUT ---
    function startListening() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            appendTranscript('error', 'Voice recognition is not supported on this device.');
            return;
        }

        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        primeSpeechSynthesis();
        if (DriveDashApp.actions.playBeep) DriveDashApp.actions.playBeep();

        const rec = new SpeechRecognition();
        recognizer = rec;
        rec.lang = 'en-GB';
        rec.continuous = false;
        rec.interimResults = false;

        setState('listening', 'LISTENING…');

        const timeout = setTimeout(() => rec.stop(), SPEECH_TIMEOUT_MS);

        rec.onresult = (e) => {
            clearTimeout(timeout);
            const text = (e.results[0][0].transcript || '').trim();
            if (!text) {
                setState('idle', 'TAP TO TALK');
                return;
            }
            appendTranscript('user', text);
            conversation.push({ role: 'user', content: text });
            runTurn();
        };

        rec.onerror = (e) => {
            clearTimeout(timeout);
            console.error('Speech recognition error:', e.error);
            setState('idle', 'TAP TO TALK');
        };

        rec.onend = () => {
            clearTimeout(timeout);
            recognizer = null;
            if (currentState === 'listening') setState('idle', 'TAP TO TALK');
        };

        rec.start();
    }

    // --- BACKEND RELAY ---
    async function sendToBackend(messages) {
        const key = getAssistantKey();
        const headers = { 'Content-Type': 'application/json' };
        if (key) headers['x-assistant-key'] = key;

        activeAbortController = new AbortController();
        let res;
        try {
            res = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers,
                body: JSON.stringify({ messages }),
                signal: activeAbortController.signal
            });
        } finally {
            activeAbortController = null;
        }

        if (res.status === 401) {
            clearAssistantKey();
            throw new Error('UNAUTHORIZED');
        }
        if (!res.ok) {
            throw new Error('REQUEST_FAILED');
        }
        return res.json();
    }

    async function executeClientTool(name, input) {
        const handler = CLIENT_TOOL_HANDLERS[name];
        if (!handler) return { ok: false, error: `Unsupported action: ${name}` };
        try {
            return await handler(input || {});
        } catch (e) {
            console.error('Client tool execution failed:', name, e);
            return { ok: false, error: 'Action failed unexpectedly.' };
        }
    }

    async function runTurn() {
        setState('thinking', 'THINKING…');
        try {
            for (let step = 0; step < MAX_TURN_STEPS; step++) {
                const response = await sendToBackend(conversation);

                if (response.type === 'final') {
                    conversation.push(response.assistantMessage || { role: 'assistant', content: response.text });
                    appendTranscript('assistant', response.text);
                    await speakAndNavigate(response.text);
                    setState('idle');
                    return;
                }

                if (response.type === 'tool_calls') {
                    conversation.push(response.assistantMessage);

                    const clientResults = [];
                    for (const call of response.toolCalls) {
                        const result = await executeClientTool(call.name, call.input);
                        if (result && result.navigateUrl) pendingNavigateUrl = result.navigateUrl;
                        clientResults.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result) });
                    }

                    conversation.push({
                        role: 'user',
                        content: [...(response.pendingToolResults || []), ...clientResults]
                    });
                    continue;
                }

                throw new Error('UNEXPECTED_RESPONSE');
            }
            throw new Error('TOO_MANY_STEPS');
        } catch (e) {
            if (e.name === 'AbortError') {
                setState('idle', 'TAP TO TALK');
                return;
            }
            console.error('Assistant turn failed:', e);
            const message = e.message === 'UNAUTHORIZED'
                ? 'Wrong passphrase, tap talk to try again.'
                : "Sorry, I couldn't reach the assistant.";
            appendTranscript('error', message);
            await speakAndNavigate(message);
            setState('idle');
        }
    }

    // --- TALK BUTTON (state-aware tap behaviour) ---
    function handleTalkTap() {
        if (currentState === 'idle') {
            startListening();
        } else if (currentState === 'listening') {
            if (recognizer) recognizer.stop();
        } else if (currentState === 'speaking') {
            if ('speechSynthesis' in window) window.speechSynthesis.cancel();
            pendingNavigateUrl = null;
            startListening();
        } else if (currentState === 'thinking') {
            if (activeAbortController) activeAbortController.abort();
        }
    }

    function init() {
        talkBtn = document.getElementById('talk-btn');
        statusEl = document.getElementById('assistant-status');
        transcriptBtn = document.getElementById('transcript-btn');
        panel = document.getElementById('assistant-panel');
        transcriptEl = document.getElementById('assistant-transcript');
        closePanelBtn = panel ? panel.querySelector('[data-action="close-assistant-panel"]') : null;

        if (talkBtn) talkBtn.addEventListener('click', handleTalkTap);

        if (transcriptBtn && panel) {
            transcriptBtn.addEventListener('click', () => {
                renderTranscript();
                panel.style.display = 'flex';
            });
        }

        if (closePanelBtn && panel) {
            closePanelBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        }

        if (panel) {
            panel.addEventListener('click', (e) => {
                if (e.target === panel) panel.style.display = 'none';
            });
        }

        setState('idle', 'TAP TO TALK');
        renderTranscript();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {};
})();
