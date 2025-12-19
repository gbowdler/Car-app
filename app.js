// --- 1. INITIALISATION & CLOCK ---
setInterval(() => {
    const now = new Date();
    document.getElementById('clock').innerText = now.toLocaleTimeString('en-GB', {hour: '2-digit', minute:'2-digit'});
}, 1000);

// --- 2. LIVE SPEEDOMETER (MPH) ---
navigator.geolocation.watchPosition((pos) => {
    const speed = pos.coords.speed; // speed in meters per second
    if (speed !== null && speed > 0) {
        const mph = Math.round(speed * 2.23694);
        document.getElementById('location-text').innerText = `${mph} MPH`;
    } else {
        document.getElementById('location-text').innerText = "0 MPH";
    }
}, (err) => {
    console.warn("GPS Signal Lost");
}, { enableHighAccuracy: true });

// --- 3. AUDIO FEEDBACK ---
function playBeep() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
    } catch(e) { console.log("Audio blocked"); }
}

// --- 4. NAVIGATION & FUEL ---
function navHome() {
    let homeAddress = localStorage.getItem('homeAddress');
    if (!homeAddress) {
        let input = prompt("Enter your Home Postcode or Address (Private):");
        if (input) {
            localStorage.setItem('homeAddress', input);
            homeAddress = input;
        } else { return; }
    }
    window.location.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(homeAddress)}`;
}

function findFuel() {
    window.location.href = "https://www.google.com/maps/search/petrol+stations+near+me/";
}

// --- 5. VOICE COMMANDS (WHATSAPP & LOGS) ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function messageChia() {
    let chiaNumber = localStorage.getItem('chiaNumber');
    if (!chiaNumber) {
        let input = prompt("Enter Chia's number (e.g. 447123456789):");
        if (input) {
            chiaNumber = input.replace(/\s+/g, '').replace('+', '');
            localStorage.setItem('chiaNumber', chiaNumber);
        } else { return; }
    }

    if (!SpeechRecognition) return alert("Voice not supported.");
    playBeep();
    const rec = new SpeechRecognition();
    rec.lang = 'en-GB';
    document.getElementById('location-text').innerText = "LISTENING (WA)...";
    document.getElementById('location-text').style.color = "var(--neon-blue)";

    rec.onresult = (e) => {
        const text = e.results[0][0].transcript;
        window.location.href = `https://wa.me/${chiaNumber}?text=${encodeURIComponent(text)}`;
    };
    rec.start();
}

function startVoiceLog() {
    if (!SpeechRecognition) return alert("Voice not supported.");
    playBeep();
    const rec = new SpeechRecognition();
    rec.lang = 'en-GB';
    document.getElementById('location-text').innerText = "LISTENING (LOG)...";
    document.getElementById('location-text').style.color = "var(--neon-purple)";

    rec.onresult = (e) => {
        const text = e.results[0][0].transcript;
        const logs = JSON.parse(localStorage.getItem('driveLogs') || "[]");
        const time = new Date().toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
        logs.push(`[${time}] ${text}`);
        localStorage.setItem('driveLogs', JSON.stringify(logs));
        
        document.getElementById('location-text').innerText = "NOTE SAVED";
        document.getElementById('location-text').style.color = "var(--neon-green)";
        setTimeout(() => {
            document.getElementById('location-text').innerText = "0 MPH";
            document.getElementById('location-text').style.color = "white";
        }, 3000);
    };
    rec.start();
}

// --- 6. WHAT3WORDS & MODAL ---
function getW3W() {
    navigator.geolocation.getCurrentPosition((pos) => {
        const url = `https://what3words.com/${pos.coords.latitude},${pos.coords.longitude}`;
        showModal("Your W3W", `Location Detected:<br><br><a href="${url}" target="_blank" style="color:var(--neon-red); font-size:1.2rem;">Open what3words.com</a>`);
    });
}

function showLogs() {
    const logs = JSON.parse(localStorage.getItem('driveLogs') || "[]");
    let content = logs.length ? logs.map((log, i) => `
        <div style="display:flex; justify-content:space-between; margin-bottom:10px; border-bottom:1px solid #444; padding-bottom:5px;">
            <span style="font-size:0.9rem; text-align:left;">${log}</span>
            <button onclick="deleteLog(${i})" style="background:var(--neon-red); border:none; color:white; border-radius:5px; padding:2px 8px;">X</button>
        </div>
    `).reverse().join('') : "No logs recorded.";

    content += `
        <div style="margin-top:20px; border-top:1px dashed #666; padding-top:15px; display:grid; gap:10px;">
            <button onclick="resetData('chiaNumber')" style="background:none; border:1px solid var(--neon-blue); color:var(--neon-blue); padding:10px; border-radius:10px;">RESET WHATSAPP NUMBER</button>
            <button onclick="resetData('homeAddress')" style="background:none; border:1px solid var(--neon-green); color:var(--neon-green); padding:10px; border-radius:10px;">RESET HOME ADDRESS</button>
        </div>
    `;
    showModal("Logs & Settings", content);
}

function deleteLog(index) {
    let logs = JSON.parse(localStorage.getItem('driveLogs') || "[]");
    logs.splice(index, 1);
    localStorage.setItem('driveLogs', JSON.stringify(logs));
    showLogs();
}

function resetData(key) {
    if(confirm(`Clear saved ${key === 'chiaNumber' ? 'WhatsApp Number' : 'Home Address'}?`)) {
        localStorage.removeItem(key);
        closeModal();
    }
}

function showModal(title, body) {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('modal').style.display = 'flex';
}

function closeModal() { document.getElementById('modal').style.display = 'none'; }
