// --- CONSTANTS ---
const CONSTANTS = {
    SPEECH_TIMEOUT: 6000,
    SUCCESS_MESSAGE_DURATION: 3000,
    BEEP_FREQUENCY: 880,
    BEEP_DURATION: 0.1,
    BEEP_VOLUME: 0.05,
    MPH_CONVERSION: 2.23694,
    CLOCK_UPDATE_INTERVAL: 1000
};

const STORAGE_KEYS = {
    HOME_ADDRESS: 'homeAddress',
    CHIA_NUMBER: 'chiaNumber',
    DRIVE_LOGS: 'driveLogs'
};

const UI_STATES = {
    LISTENING_WHATSAPP: 'LISTENING (WA)...',
    LISTENING_LOG: 'LISTENING (LOG)...',
    LOCATING: 'LOCATING...',
    NOTE_SAVED: 'NOTE SAVED',
    DEFAULT_SPEED: '0 MPH'
};

// --- MODULE PATTERN ---
const DriveDashApp = (function() {
    // Private variables
    let audioContext = null;
    let geolocationWatchId = null;

    // DOM elements cache
    const elements = {
        clock: null,
        locationText: null,
        modal: null,
        modalTitle: null,
        modalBody: null
    };

    // --- UTILITY FUNCTIONS ---
    function sanitizeInput(input) {
        if (!input || typeof input !== 'string') return '';
        // Remove any HTML tags and trim whitespace
        return input.replace(/<[^>]*>/g, '').trim();
    }

    function validatePhoneNumber(number) {
        if (!number) return null;
        // Remove all whitespace and plus signs
        const cleaned = number.replace(/\s+/g, '').replace(/\+/g, '');
        // Check if it's a valid UK number format (starts with 44 and has correct length)
        if (/^44\d{10}$/.test(cleaned)) {
            return cleaned;
        }
        return null;
    }

    function validateAddress(address) {
        const sanitized = sanitizeInput(address);
        // Basic validation - at least 3 characters
        if (sanitized.length >= 3) {
            return sanitized;
        }
        return null;
    }

    function safeEncodeURI(str) {
        try {
            return encodeURIComponent(sanitizeInput(str));
        } catch (e) {
            console.error('Failed to encode URI:', e);
            return '';
        }
    }

    function showError(message) {
        showModal('Error', `<p style="color: var(--neon-red);">${sanitizeInput(message)}</p>`);
    }

    function cacheElements() {
        elements.clock = document.getElementById('clock');
        elements.locationText = document.getElementById('location-text');
        elements.modal = document.getElementById('modal');
        elements.modalTitle = document.getElementById('modal-title');
        elements.modalBody = document.getElementById('modal-body');
    }

    // --- AUDIO FEEDBACK ---
    function initAudioContext() {
        if (!audioContext) {
            try {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            } catch (e) {
                console.error('AudioContext not supported:', e);
            }
        }
        return audioContext;
    }

    function playBeep() {
        try {
            const ctx = initAudioContext();
            if (!ctx) return;

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(CONSTANTS.BEEP_FREQUENCY, ctx.currentTime);
            gain.gain.setValueAtTime(CONSTANTS.BEEP_VOLUME, ctx.currentTime);
            osc.start();
            osc.stop(ctx.currentTime + CONSTANTS.BEEP_DURATION);
        } catch(e) {
            console.error('Audio playback failed:', e);
        }
    }

    // --- CLOCK ---
    function updateClock() {
        if (!elements.clock) return;
        try {
            const now = new Date();
            elements.clock.innerText = now.toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (e) {
            console.error('Failed to update clock:', e);
        }
    }

    function startClock() {
        updateClock();
        setInterval(updateClock, CONSTANTS.CLOCK_UPDATE_INTERVAL);
    }

    // --- SPEEDOMETER ---
    function updateSpeed(speed) {
        if (!elements.locationText) return;
        try {
            if (speed !== null && speed > 0) {
                const mph = Math.round(speed * CONSTANTS.MPH_CONVERSION);
                elements.locationText.innerText = `${mph} MPH`;
            } else {
                elements.locationText.innerText = UI_STATES.DEFAULT_SPEED;
            }
        } catch (e) {
            console.error('Failed to update speed:', e);
        }
    }

    function startSpeedometer() {
        try {
            if (!navigator.geolocation) {
                console.error('Geolocation not supported');
                return;
            }

            geolocationWatchId = navigator.geolocation.watchPosition(
                (pos) => updateSpeed(pos.coords.speed),
                (err) => {
                    console.warn('GPS Signal Lost:', err);
                    updateSpeed(null);
                },
                { enableHighAccuracy: true }
            );
        } catch (e) {
            console.error('Failed to start speedometer:', e);
        }
    }

    // --- SPEECH RECOGNITION ---
    function createSpeechRecognizer(onResult, uiState, color) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            showError('Voice recognition is not supported on this device.');
            return null;
        }

        playBeep();
        const rec = new SpeechRecognition();
        rec.lang = 'en-GB';
        rec.continuous = false;
        rec.interimResults = false;

        // Update UI
        if (elements.locationText) {
            elements.locationText.innerText = uiState;
            elements.locationText.style.color = color;
        }

        // Set up timeout
        const silenceTimeout = setTimeout(() => {
            rec.stop();
        }, CONSTANTS.SPEECH_TIMEOUT);

        rec.onresult = (e) => {
            try {
                const text = e.results[0][0].transcript;
                rec.stop();
                clearTimeout(silenceTimeout);
                onResult(sanitizeInput(text));
            } catch (error) {
                console.error('Speech recognition error:', error);
                showError('Failed to process voice input.');
            }
        };

        rec.onerror = (e) => {
            clearTimeout(silenceTimeout);
            console.error('Speech recognition error:', e.error);
            showError('Voice recognition failed. Please try again.');
            resetLocationText();
        };

        rec.onend = () => {
            clearTimeout(silenceTimeout);
            resetLocationText();
        };

        return rec;
    }

    function resetLocationText() {
        if (elements.locationText) {
            elements.locationText.innerText = UI_STATES.DEFAULT_SPEED;
            elements.locationText.style.color = 'white';
        }
    }

    // --- NAVIGATION & FUEL ---
    function navHome() {
        try {
            let homeAddress = localStorage.getItem(STORAGE_KEYS.HOME_ADDRESS);

            if (!homeAddress) {
                const input = prompt("Enter your Home Postcode or Address (Private):");
                if (!input) return;

                const validated = validateAddress(input);
                if (!validated) {
                    showError('Please enter a valid address (at least 3 characters).');
                    return;
                }

                localStorage.setItem(STORAGE_KEYS.HOME_ADDRESS, validated);
                homeAddress = validated;
            }

            const encoded = safeEncodeURI(homeAddress);
            if (encoded) {
                window.location.href = `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
            }
        } catch (e) {
            console.error('Navigation error:', e);
            showError('Failed to start navigation.');
        }
    }

    function findFuel() {
        try {
            window.location.href = "https://www.google.com/maps/search/petrol+stations+near+me/";
        } catch (e) {
            console.error('Fuel search error:', e);
            showError('Failed to open fuel search.');
        }
    }

    // --- WHATSAPP MESSAGE ---
    function messageChia() {
        try {
            let chiaNumber = localStorage.getItem(STORAGE_KEYS.CHIA_NUMBER);

            if (!chiaNumber) {
                const input = prompt("Enter Chia's number (447...):");
                if (!input) return;

                const validated = validatePhoneNumber(input);
                if (!validated) {
                    showError('Please enter a valid UK number (format: 447XXXXXXXXX).');
                    return;
                }

                localStorage.setItem(STORAGE_KEYS.CHIA_NUMBER, validated);
                chiaNumber = validated;
            }

            const rec = createSpeechRecognizer(
                (text) => {
                    const encoded = safeEncodeURI(text);
                    if (encoded) {
                        window.location.href = `https://wa.me/${chiaNumber}?text=${encoded}`;
                    }
                },
                UI_STATES.LISTENING_WHATSAPP,
                'var(--neon-blue)'
            );

            if (rec) {
                rec.start();
            }
        } catch (e) {
            console.error('WhatsApp message error:', e);
            showError('Failed to start voice message.');
        }
    }

    // --- VOICE LOG ---
    function startVoiceLog() {
        try {
            const rec = createSpeechRecognizer(
                (text) => {
                    const logs = JSON.parse(localStorage.getItem(STORAGE_KEYS.DRIVE_LOGS) || "[]");
                    const time = new Date().toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit'
                    });

                    logs.push(`[${time}] ${text}`);
                    localStorage.setItem(STORAGE_KEYS.DRIVE_LOGS, JSON.stringify(logs));

                    if (elements.locationText) {
                        elements.locationText.innerText = UI_STATES.NOTE_SAVED;
                        elements.locationText.style.color = 'var(--neon-green)';

                        setTimeout(() => {
                            resetLocationText();
                        }, CONSTANTS.SUCCESS_MESSAGE_DURATION);
                    }
                },
                UI_STATES.LISTENING_LOG,
                'var(--neon-purple)'
            );

            if (rec) {
                rec.start();
            }
        } catch (e) {
            console.error('Voice log error:', e);
            showError('Failed to start voice log.');
        }
    }

    // --- WHAT3WORDS ---
    function getW3W() {
        try {
            playBeep();

            if (elements.locationText) {
                elements.locationText.innerText = UI_STATES.LOCATING;
            }

            if (!navigator.geolocation) {
                showError('Geolocation is not supported on this device.');
                resetLocationText();
                return;
            }

            navigator.geolocation.getCurrentPosition(
                async (pos) => {
                    try {
                        const lat = pos.coords.latitude;
                        const lng = pos.coords.longitude;
                        const w3wLink = `https://what3words.com/${lat},${lng}`;

                        showModal("Your W3W", `
                            <div style="margin: 20px 0;">
                                <p style="font-size: 1rem; color: #888;">Current Coordinates:</p>
                                <p style="font-size: 0.9rem;">${lat.toFixed(5)}, ${lng.toFixed(5)}</p>

                                <div style="background: #222; padding: 20px; border-radius: 15px; border: 1px solid var(--neon-red); margin-top: 20px;">
                                    <a href="${w3wLink}" target="_blank" style="text-decoration: none; color: var(--neon-red); font-size: 1.8rem; font-weight: bold;">
                                        TAP TO REVEAL ///WORDS
                                    </a>
                                </div>
                            </div>
                        `);

                        resetLocationText();
                    } catch (e) {
                        console.error('W3W processing error:', e);
                        showError('Failed to process location.');
                        resetLocationText();
                    }
                },
                (err) => {
                    console.error('GPS Error:', err);
                    showError('Please ensure Location Services are turned ON.');
                    resetLocationText();
                }
            );
        } catch (e) {
            console.error('W3W error:', e);
            showError('Failed to get location.');
            resetLocationText();
        }
    }

    // --- LOGS & SETTINGS ---
    function showLogs() {
        try {
            playBeep();
            const logs = JSON.parse(localStorage.getItem(STORAGE_KEYS.DRIVE_LOGS) || "[]");

            // Create the list of logs with corrected indices
            let logItems = logs.length ? logs.map((log, i) => {
                // Calculate reversed index for display
                const displayIndex = logs.length - 1 - i;
                return `
                    <div style="display:flex; justify-content:space-between; margin-bottom:12px; border-bottom:1px solid #333; padding-bottom:8px;">
                        <span style="font-size:1rem; color:white;">${sanitizeInput(log)}</span>
                        <button data-delete-index="${i}" class="delete-log-btn" style="background:var(--neon-red); border:none; color:white; border-radius:8px; padding:8px 12px; font-weight:bold;">DEL</button>
                    </div>
                `;
            }).reverse().join('') : "<p style='color:#888;'>No notes saved.</p>";

            // Build the Settings section
            let settingsHTML = `
                <div style="margin-top:25px; border-top:2px dashed #444; padding-top:20px; display:grid; gap:15px;">
                    <button data-reset="homeAddress" class="reset-data-btn" style="background:none; border:2px solid var(--neon-green); color:var(--neon-green); padding:15px; border-radius:12px; font-weight:bold;">RESET HOME ADDR</button>
                    <button data-reset="chiaNumber" class="reset-data-btn" style="background:none; border:2px solid var(--neon-blue); color:var(--neon-blue); padding:15px; border-radius:12px; font-weight:bold;">RESET WHATSAPP NO.</button>
                </div>
            `;

            if (elements.modalTitle && elements.modalBody && elements.modal) {
                elements.modalTitle.innerText = "LOGS & SETTINGS";
                elements.modalBody.innerHTML = logItems + settingsHTML;
                elements.modal.style.display = 'flex';

                // Attach event listeners to dynamically created buttons
                attachModalEventListeners();
            }
        } catch (e) {
            console.error('Show logs error:', e);
            showError('Failed to load logs.');
        }
    }

    function attachModalEventListeners() {
        // Delete log buttons
        const deleteButtons = document.querySelectorAll('.delete-log-btn');
        deleteButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.deleteIndex, 10);
                deleteLog(index);
            });
        });

        // Reset data buttons
        const resetButtons = document.querySelectorAll('.reset-data-btn');
        resetButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const key = btn.dataset.reset;
                resetData(key);
            });
        });
    }

    function deleteLog(index) {
        try {
            let logs = JSON.parse(localStorage.getItem(STORAGE_KEYS.DRIVE_LOGS) || "[]");
            if (index >= 0 && index < logs.length) {
                logs.splice(index, 1);
                localStorage.setItem(STORAGE_KEYS.DRIVE_LOGS, JSON.stringify(logs));
                showLogs();
            }
        } catch (e) {
            console.error('Delete log error:', e);
            showError('Failed to delete log.');
        }
    }

    function resetData(key) {
        try {
            const keyMap = {
                'chiaNumber': 'WhatsApp Number',
                'homeAddress': 'Home Address'
            };

            const displayName = keyMap[key] || key;

            if (confirm(`Clear saved ${displayName}?`)) {
                localStorage.removeItem(key);
                closeModal();
            }
        } catch (e) {
            console.error('Reset data error:', e);
            showError('Failed to reset data.');
        }
    }

    // --- MODAL FUNCTIONS ---
    function showModal(title, body) {
        try {
            if (elements.modalTitle && elements.modalBody && elements.modal) {
                elements.modalTitle.innerText = sanitizeInput(title);
                elements.modalBody.innerHTML = body; // Sanitized at source
                elements.modal.style.display = 'flex';
            }
        } catch (e) {
            console.error('Show modal error:', e);
        }
    }

    function closeModal() {
        if (elements.modal) {
            elements.modal.style.display = 'none';
        }
    }

    // --- EVENT LISTENERS ---
    function attachEventListeners() {
        // Button event listeners
        const btnNavHome = document.querySelector('[data-action="nav-home"]');
        const btnMessageChia = document.querySelector('[data-action="message-chia"]');
        const btnVoiceLog = document.querySelector('[data-action="voice-log"]');
        const btnFuel = document.querySelector('[data-action="fuel"]');
        const btnW3W = document.querySelector('[data-action="w3w"]');
        const btnShowLogs = document.querySelector('[data-action="show-logs"]');
        const btnCloseModal = document.querySelector('[data-action="close-modal"]');

        if (btnNavHome) btnNavHome.addEventListener('click', navHome);
        if (btnMessageChia) btnMessageChia.addEventListener('click', messageChia);
        if (btnVoiceLog) btnVoiceLog.addEventListener('click', startVoiceLog);
        if (btnFuel) btnFuel.addEventListener('click', findFuel);
        if (btnW3W) btnW3W.addEventListener('click', getW3W);
        if (btnShowLogs) btnShowLogs.addEventListener('click', showLogs);
        if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);

        // Modal background click to close
        if (elements.modal) {
            elements.modal.addEventListener('click', (e) => {
                if (e.target === elements.modal) {
                    closeModal();
                }
            });
        }
    }

    // --- INITIALIZATION ---
    function init() {
        try {
            cacheElements();
            attachEventListeners();
            startClock();
            startSpeedometer();
        } catch (e) {
            console.error('Initialization error:', e);
        }
    }

    // --- CLEANUP ---
    function cleanup() {
        if (geolocationWatchId !== null) {
            navigator.geolocation.clearWatch(geolocationWatchId);
        }
        if (audioContext) {
            audioContext.close();
        }
    }

    // Handle page unload
    window.addEventListener('beforeunload', cleanup);

    // Public API
    return {
        init
    };
})();

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', DriveDashApp.init);
} else {
    DriveDashApp.init();
}
