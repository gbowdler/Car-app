// Live Speedometer
navigator.geolocation.watchPosition((pos) => {
    // Convert meters per second to MPH
    const speed = pos.coords.speed; // speed is in m/s
    if (speed !== null) {
        const mph = Math.round(speed * 2.23694);
        document.getElementById('location-text').innerText = `${mph} MPH`;
    } else {
        document.getElementById('location-text').innerText = "0 MPH";
    }
}, (err) => {
    console.log("GPS Error");
}, { enableHighAccuracy: true });
// Function to play a 'Listening' beep
function playBeep() {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // High pitch
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.1); // Short 100ms beep
}

// Updated Message Chia function with beep
function messageChia() {
    playBeep(); 
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("Speech not supported.");
    
    const recognition = new SpeechRecognition();
    recognition.onresult = (event) => {
        const text = event.results[0][0].transcript;
        window.location.href = `sms:+447000000000?body=${encodeURIComponent(text)}`;
    };
    recognition.start();
}

// Add playBeep() to startVoiceLog() as well
function startVoiceLog() {
    playBeep();
    // ... rest of your voice log logic from earlier

}
