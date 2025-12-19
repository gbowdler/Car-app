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

// Add playBeep() to startVoiceLog() as well
function startVoiceLog() {
    playBeep();
    // ... rest of your voice log logic from earlier

}

