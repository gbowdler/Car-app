// 1. CLOCK & SPEEDOMETER LOGIC
setInterval(() => {
    const now = new Date();
    document.getElementById('clock').innerText = now.toLocaleTimeString('en-GB', {hour: '2-digit', minute:'2-digit'});
}, 1000);

// Watch GPS for Speed (MPH)
navigator.geolocation.watchPosition((pos) => {
    const speed = pos.coords.speed; // speed in meters per second
    if (speed !== null && speed > 0) {
        const mph = Math.round(speed * 2.23694);
        document.getElementById('location-text').innerText = `${mph} MPH`;
    } else {
        document.getElementById('location-text').innerText = "0 MPH";
    }
}, null, { enableHighAccuracy: true });

// 2. AUDIO FEEDBACK (The Beep)
function playBeep() {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
}

// 3. NAVIGATION FUNCTIONS
function navHome() {
    // Replace 'Home+Address' with your actual postcode or street
    window.location.href = "https://www.google.com/maps/dir/?api=1&destination=Home";
}

function findFuel() {
    // Searches for petrol stations along current route or nearby
    window.location.href = "https://www.google.com/maps/search/petrol+stations+near+me/";
}

function messageChia() {
    if (!SpeechRecognition) return alert("Voice not supported.");
    playBeep();
    
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-GB';

    recognition.onresult = (event) => {
        const speechToText = event.results[0][0].transcript;
        
        // CHIA'S NUMBER: Use format 447123456789 (No + sign, no leading 0)
        const phoneNumber = "447000000000"; 
        
        // WhatsApp Universal Link
        const whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(speechToText)}`;
        
        window.location.href = whatsappUrl;
    };
    
    recognition.start();
}

function startVoiceLog() {
    // 1. Check if the browser supports Speech
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("Voice recognition not supported on this browser. Try Chrome or Safari.");
        return;
    }

    playBeep();
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-GB';
    recognition.interimResults = false; // Only want the final sentence

    // Update the UI so you know it's listening
    document.getElementById('location-text').innerText = "LISTENING...";
    document.getElementById('location-text').style.color = "var(--neon-purple)";

    recognition.onresult = (event) => {
        const text = event.results[0][0].transcript;
        
        // Get existing logs or start a new array
        const logs = JSON.parse(localStorage.getItem('driveLogs') || "[]");
        
        // Create a timestamped entry
        const timestamp = new Date().toLocaleTimeString('en-GB', {hour: '2-digit', minute:'2-digit'});
        logs.push(`[${timestamp}] ${text}`);
        
        // Save back to local storage
        localStorage.setItem('driveLogs', JSON.stringify(logs));
        
        // Visual confirmation
        document.getElementById('location-text').innerText = "SAVED: " + text.substring(0, 15) + "...";
        document.getElementById('location-text').style.color = "var(--neon-green)";
        
        // Reset to Speedometer after 3 seconds
        setTimeout(() => {
            document.getElementById('location-text').style.color = "white";
            document.getElementById('location-text').innerText = "0 MPH";
        }, 3000);
    };

    recognition.onerror = (event) => {
        console.error("Speech Error:", event.error);
        document.getElementById('location-text').innerText = "RETRY...";
        document.getElementById('location-text').style.color = "var(--neon-red)";
    };

    recognition.start();
}

// 5. WHAT3WORDS & LOG VIEWING
function getW3W() {
    navigator.geolocation.getCurrentPosition((pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        // W3W Free API or Link redirect
        const w3wUrl = `https://what3words.com/${lat},${lng}`;
        showModal("Your W3W Location", `Detected via GPS:<br><br><a href="${w3wUrl}" target="_blank" style="color:var(--neon-red); font-size: 1.2rem;">Open what3words.com</a>`);
    });
}

function showLogs() {
    const logs = JSON.parse(localStorage.getItem('driveLogs') || "[]");
    
    // We create the HTML for each log with a delete button
    let content = "";
    
    if (logs.length === 0) {
        content = "No logs recorded.";
    } else {
        // Map through logs and add a 'Delete' button to each one
        // We use the index (i) to know which one to remove
        content = logs.map((log, i) => `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid #444; padding-bottom: 5px;">
                <span style="text-align: left; font-size: 1rem;">${log}</span>
                <button onclick="deleteLog(${i})" style="background: var(--neon-red); color: white; border: none; border-radius: 5px; padding: 5px 10px; font-weight: bold; margin-left: 10px;">X</button>
            </div>
        `).reverse().join(''); // Reverse so newest is at the top
    }
    
    showModal("Saved Logs", content);
}

function deleteLog(index) {
    // 1. Get current logs
    let logs = JSON.parse(localStorage.getItem('driveLogs') || "[]");
    
    // 2. Remove the one at that index
    logs.splice(index, 1);
    
    // 3. Save the new list
    localStorage.setItem('driveLogs', JSON.stringify(logs));
    
    // 4. Refresh the display so it disappears immediately
    showLogs();
}

// MODAL CONTROLS
function showModal(title, body) {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
}


