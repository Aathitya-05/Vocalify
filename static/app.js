import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut as firebaseSignOut, onAuthStateChanged, signInAnonymously, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, collection, deleteDoc, query, orderBy, limit, addDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Attempt to load Firebase config and backend URL
let firebaseConfig = null;
let isFirebaseConfigured = () => false;
let API_BASE_URL = "";

try {
    const configModule = await import('./firebase-config.js');
    firebaseConfig = configModule.firebaseConfig;
    isFirebaseConfigured = configModule.isFirebaseConfigured;
    if (firebaseConfig && firebaseConfig.apiBaseUrl) {
        API_BASE_URL = firebaseConfig.apiBaseUrl.replace(/\/$/, ""); // Strip trailing slash if present
    }
} catch (error) {
    console.warn("firebase-config.js could not be loaded. Defaulting to Local Demo Mode.");
}

// Initialize Firebase
let firebaseApp = null;
let auth = null;
let db = null;
let isFirebaseActive = false;

if (isFirebaseConfigured()) {
    try {
        firebaseApp = initializeApp(firebaseConfig);
        auth = getAuth(firebaseApp);
        db = getFirestore(firebaseApp);
        isFirebaseActive = true;
        console.log("Firebase initialized successfully.");
    } catch (error) {
        console.error("Failed to initialize Firebase:", error);
    }
} else {
    console.log("Firebase is not configured. Running in Local Demo Mode.");
}

// Encryption and Security Config
const SECRET_KEY = "VocalifySharedSecretKey32Bytes!!";

function encryptPayload(data) {
    const key = CryptoJS.enc.Utf8.parse(SECRET_KEY);
    const iv = CryptoJS.lib.WordArray.random(16);
    const plaintext = JSON.stringify(data);
    const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
    });
    return {
        ciphertext: encrypted.toString(),
        iv: CryptoJS.enc.Hex.stringify(iv)
    };
}

function disableInspection() {
    // Disable right click context menu
    document.addEventListener('contextmenu', e => {
        e.preventDefault();
    });

    // Disable F12 and inspect hotkeys
    document.addEventListener('keydown', e => {
        if (e.key === 'F12') {
            e.preventDefault();
            return false;
        }
        if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c' || e.key === 'U' || e.key === 'u')) {
            e.preventDefault();
            return false;
        }
        if (e.ctrlKey && (e.key === 'U' || e.key === 'u')) {
            e.preventDefault();
            return false;
        }
    });

    // Console warning message loop
    setInterval(() => {
        console.log('%cWARNING!', 'color: #ec4899; font-size: 40px; font-weight: bold; text-shadow: 0 0 10px rgba(236,72,153,0.5);');
        console.log('%cThis application is running in an AES-Encrypted Secure Session. Inspecting elements or printing variables is prohibited for security compliance.', 'color: #818cf8; font-size: 14px; font-weight: 500;');
    }, 5000);
}

// Trigger browser native download stream for large files
function triggerSecureDownload() {
    const text = outputText.value.trim();
    if (!text) return;
    const voice = voiceSelect.value;
    const rateVal = parseInt(rateSlider.value);
    const pitchVal = parseInt(pitchSlider.value);
    const rateStr = `${rateVal >= 0 ? '+' : ''}${rateVal}%`;
    const pitchStr = `${pitchVal >= 0 ? '+' : ''}${pitchVal}%`;
    
    const payload = {
        text: text,
        voice: voice,
        rate: rateStr,
        pitch: pitchStr
    };
    
    const encrypted = encryptPayload(payload);
    const dataStr = JSON.stringify(encrypted);
    const base64 = window.btoa(unescape(encodeURIComponent(dataStr))); // Handles unicode safely
    const base64Url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    
    window.location.href = `${API_BASE_URL}/api/download?data=${encodeURIComponent(base64Url)}`;
}

// Application State
let appLanguages = {};
let currentVoices = [];
let audioBlob = null;
let audioUrl = null;
let isPlaying = false;
let historyItems = [];
let glossaryRules = [];
let currentUser = null;

// Audio Context elements for visualizer
let audioCtx = null;
let analyserNode = null;
let sourceNode = null;
let animationFrameId = null;

// Selectors
const themeToggle = document.getElementById('theme-toggle');
const sourceLangSelect = document.getElementById('source-lang');
const targetLangSelect = document.getElementById('target-lang');
const swapLangBtn = document.getElementById('swap-lang-btn');
const inputText = document.getElementById('input-text');
const outputText = document.getElementById('output-text');
const translateBtn = document.getElementById('translate-btn');
const clearInputBtn = document.getElementById('clear-input-btn');
const copyOutputBtn = document.getElementById('copy-output-btn');
const inputCharCount = document.getElementById('input-char-count');
const outputCharCount = document.getElementById('output-char-count');

const voiceSelect = document.getElementById('voice-select');
const rateSlider = document.getElementById('rate-slider');
const pitchSlider = document.getElementById('pitch-slider');
const rateValue = document.getElementById('rate-value');
const pitchValue = document.getElementById('pitch-value');
const resetSlidersBtn = document.getElementById('reset-sliders-btn');

const generateSpeechBtn = document.getElementById('generate-speech-btn');
const visualizerPlaceholder = document.getElementById('visualizer-placeholder');
const waveformCanvas = document.getElementById('waveform-canvas');
const canvasCtx = waveformCanvas.getContext('2d');

const nativeAudio = document.getElementById('native-audio');
const playPauseBtn = document.getElementById('play-pause-btn');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressHandle = document.getElementById('progress-handle');
const playerTime = document.getElementById('player-time');
const playerMuteBtn = document.getElementById('player-mute-btn');
const playerVolumeSlider = document.getElementById('player-volume-slider');
const downloadSpeechBtn = document.getElementById('download-speech-btn');

const historyList = document.getElementById('history-list');
const historyCountLabel = document.getElementById('history-count');
const clearHistoryBtn = document.getElementById('clear-history-btn');

// Initialize Application
async function initializeApplication() {
    // Disable inspect and DevTools access for safety compliance
    disableInspection();

    initCanvasSize();
    window.addEventListener('resize', initCanvasSize);
    
    // Draw idle visualizer state initially
    drawIdleWave();
    
    // Load active settings
    initTheme();
    
    // Load secure user session if logged in
    try {
        const storedUser = localStorage.getItem('vocalify_user_secure');
        if (storedUser) {
            const bytes = CryptoJS.AES.decrypt(storedUser, SECRET_KEY);
            const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
            currentUser = decryptedStr ? JSON.parse(decryptedStr) : null;
        }
    } catch (e) {
        console.error('Failed to decrypt stored user:', e);
        currentUser = null;
    }
    updateAuthUI();

    if (isFirebaseActive) {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                const prevUser = currentUser;
                currentUser = {
                    id: user.uid,
                    name: user.displayName || (user.isAnonymous ? "Anonymous Demo" : user.email.split('@')[0]),
                    email: user.email || "anonymous@vocalify.local",
                    picture: user.photoURL || ""
                };
                
                // Securely store active session
                const encryptedUser = CryptoJS.AES.encrypt(JSON.stringify(currentUser), SECRET_KEY).toString();
                localStorage.setItem('vocalify_user_secure', encryptedUser);
                
                updateAuthUI();
                
                // Sync any guest glossary & history if logging in
                if (!prevUser || prevUser.id !== currentUser.id) {
                    await syncGuestDataToFirestore();
                }
                
                await fetchGlossaryFromServer();
                await fetchHistoryFromServer();
            } else {
                currentUser = null;
                localStorage.removeItem('vocalify_user_secure');
                updateAuthUI();
                loadHistory();
                loadGlossary();
            }
        });
    } else {
        loadHistory();
        loadGlossary();
    }

    await loadLanguages();
    await loadVoices();
    setupEventListeners();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApplication);
} else {
    initializeApplication();
}

// Canvas Setup
function initCanvasSize() {
    waveformCanvas.width = waveformCanvas.parentElement.clientWidth;
    waveformCanvas.height = waveformCanvas.parentElement.clientHeight;
}

// Theme Configuration
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'light') {
        document.body.classList.remove('dark-theme');
        document.body.classList.add('light-theme');
        themeToggle.innerHTML = '<i class="fa-solid fa-sun"></i>';
    } else {
        document.body.classList.remove('light-theme');
        document.body.classList.add('dark-theme');
        themeToggle.innerHTML = '<i class="fa-solid fa-moon"></i>';
    }
}

function toggleTheme() {
    if (document.body.classList.contains('dark-theme')) {
        document.body.classList.replace('dark-theme', 'light-theme');
        themeToggle.innerHTML = '<i class="fa-solid fa-sun"></i>';
        localStorage.setItem('theme', 'light');
    } else {
        document.body.classList.replace('light-theme', 'dark-theme');
        themeToggle.innerHTML = '<i class="fa-solid fa-moon"></i>';
        localStorage.setItem('theme', 'dark');
    }
}

// Fetch lists from Backend API
async function loadLanguages() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/languages`);
        appLanguages = await response.json();
        
        targetLangSelect.innerHTML = '';
        Object.entries(appLanguages).forEach(([code, lang]) => {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = lang.name;
            if (code === 'ta') option.selected = true; // Default to Tamil
            targetLangSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading languages:', error);
    }
}

async function loadVoices() {
    const targetLang = targetLangSelect.value;
    try {
        const response = await fetch(`${API_BASE_URL}/api/voices?lang=${targetLang}`);
        currentVoices = await response.json();
        
        voiceSelect.innerHTML = '';
        currentVoices.forEach(v => {
            const option = document.createElement('option');
            option.value = v.short_name;
            option.textContent = v.friendly_name;
            voiceSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading voices:', error);
    }
}

// Event Listeners
function setupEventListeners() {
    // Theme
    themeToggle.addEventListener('click', toggleTheme);
    
    // Language changes
    targetLangSelect.addEventListener('change', async () => {
        await loadVoices();
    });
    
    swapLangBtn.addEventListener('click', () => {
        const src = sourceLangSelect.value;
        const tgt = targetLangSelect.value;
        if (src !== 'auto') {
            sourceLangSelect.value = tgt;
            targetLangSelect.value = src;
            loadVoices();
        }
    });

    // Character counting (unlimited text support)
    inputText.addEventListener('input', () => {
        const len = inputText.value.length;
        inputCharCount.textContent = `${len} chars`;
    });
    
    outputText.addEventListener('input', () => {
        const len = outputText.value.length;
        outputCharCount.textContent = `${len} chars`;
    });

    // Clear and Copy actions
    clearInputBtn.addEventListener('click', () => {
        inputText.value = '';
        inputCharCount.textContent = '0 chars';
        inputText.focus();
    });
    
    copyOutputBtn.addEventListener('click', () => {
        if (!outputText.value) return;
        navigator.clipboard.writeText(outputText.value);
        
        const originalText = copyOutputBtn.innerHTML;
        copyOutputBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
        setTimeout(() => {
            copyOutputBtn.innerHTML = originalText;
        }, 2000);
    });

    // Translate API call
    translateBtn.addEventListener('click', performTranslation);

    // Modulation sliders updates
    rateSlider.addEventListener('input', () => {
        const val = parseInt(rateSlider.value);
        rateValue.textContent = val === 0 ? 'Normal (0%)' : `${val > 0 ? '+' : ''}${val}%`;
    });
    
    pitchSlider.addEventListener('input', () => {
        const val = parseInt(pitchSlider.value);
        pitchValue.textContent = val === 0 ? 'Normal (0%)' : `${val > 0 ? '+' : ''}${val}%`;
    });

    resetSlidersBtn.addEventListener('click', () => {
        rateSlider.value = 0;
        pitchSlider.value = 0;
        rateValue.textContent = 'Normal (0%)';
        pitchValue.textContent = 'Normal (0%)';
    });

    // Generate Audio API call
    generateSpeechBtn.addEventListener('click', generateSpeech);

    // Audio Player actions
    playPauseBtn.addEventListener('click', togglePlayback);
    
    nativeAudio.addEventListener('timeupdate', updatePlaybackProgress);
    nativeAudio.addEventListener('ended', onAudioEnded);
    
    // Player seeking
    progressContainer.addEventListener('mousedown', startDragSeek);
    
    // Mute/Volume
    playerMuteBtn.addEventListener('click', toggleMute);
    playerVolumeSlider.addEventListener('input', () => {
        const vol = parseFloat(playerVolumeSlider.value);
        nativeAudio.volume = vol;
        if (vol === 0) {
            playerMuteBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
        } else if (vol < 0.5) {
            playerMuteBtn.innerHTML = '<i class="fa-solid fa-volume-low"></i>';
        } else {
            playerMuteBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
        }
    });

    // History controls
    clearHistoryBtn.addEventListener('click', clearHistory);

    // Narration Style Preset changes
    const presetSelect = document.getElementById('preset-select');
    presetSelect.addEventListener('change', () => {
        const val = presetSelect.value;
        if (val === 'default') {
            rateSlider.value = 0;
            pitchSlider.value = 0;
        } else if (val === 'warm') {
            rateSlider.value = -15;
            pitchSlider.value = -12;
        } else if (val === 'conversational') {
            rateSlider.value = -5;
            pitchSlider.value = 0;
        } else if (val === 'energetic') {
            rateSlider.value = 15;
            pitchSlider.value = 8;
        }
        rateSlider.dispatchEvent(new Event('input'));
        pitchSlider.dispatchEvent(new Event('input'));
    });

    // Glossary form events
    const addGlossaryBtn = document.getElementById('add-glossary-btn');
    const glossaryOriginal = document.getElementById('glossary-original');
    const glossaryRefined = document.getElementById('glossary-refined');
    
    addGlossaryBtn.addEventListener('click', addGlossaryRule);
    
    const handleKeyPress = (e) => {
        if (e.key === 'Enter') {
            addGlossaryRule();
        }
    };
    glossaryOriginal.addEventListener('keypress', handleKeyPress);
    glossaryRefined.addEventListener('keypress', handleKeyPress);

    // Google Sign-In and Auth events
    const signinBtn = document.getElementById('google-signin-btn');
    const loginGoogleBtn = document.getElementById('login-google-btn');
    const signoutBtn = document.getElementById('signout-btn');
    
    if (signinBtn) signinBtn.addEventListener('click', handleGoogleSignIn);
    if (loginGoogleBtn) loginGoogleBtn.addEventListener('click', handleGoogleSignIn);
    if (signoutBtn) signoutBtn.addEventListener('click', handleSignOut);
}

// Perform text translation
async function performTranslation() {
    const text = inputText.value.trim();
    if (!text) {
        alert('Please enter some text to translate first.');
        return;
    }
    
    translateBtn.disabled = true;
    translateBtn.querySelector('i').classList.add('fa-spin');
    translateBtn.querySelector('span').textContent = 'Translating...';
    
    try {
        const encrypted = encryptPayload({
            text: text,
            source_lang: sourceLangSelect.value,
            target_lang: targetLangSelect.value
        });
        const response = await fetch(`${API_BASE_URL}/api/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(encrypted)
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Translation API returned an error');
        }
        
        const data = await response.json();
        let translatedText = data.translated_text;
        
        // Apply glossary rules
        if (glossaryRules && glossaryRules.length > 0) {
            glossaryRules.forEach(rule => {
                if (rule.original.trim() && rule.refined.trim()) {
                    const escapedTerm = rule.original.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                    const regex = new RegExp(escapedTerm, 'gi');
                    translatedText = translatedText.replace(regex, rule.refined);
                }
            });
        }
        
        outputText.value = translatedText;
        outputCharCount.textContent = `${translatedText.length} chars`;
    } catch (error) {
        console.error('Translation error:', error);
        alert(`Translation failed: ${error.message}`);
    } finally {
        translateBtn.disabled = false;
        translateBtn.querySelector('i').classList.remove('fa-spin');
        translateBtn.querySelector('span').textContent = 'Translate Text';
    }
}

// Generate TTS audio
async function generateSpeech() {
    const text = outputText.value.trim();
    if (!text) {
        alert('Please translate or enter text in the translated text box first.');
        return;
    }

    const voice = voiceSelect.value;
    if (!voice) {
        alert('Please select a voice model.');
        return;
    }

    // Prepare speed/pitch settings
    const rateVal = parseInt(rateSlider.value);
    const pitchVal = parseInt(pitchSlider.value);
    
    const rateStr = `${rateVal >= 0 ? '+' : ''}${rateVal}%`;
    const pitchStr = `${pitchVal >= 0 ? '+' : ''}${pitchVal}%`;

    // Visual loading state
    generateSpeechBtn.disabled = true;
    generateSpeechBtn.classList.add('generating');
    generateSpeechBtn.querySelector('span').textContent = 'Generating Speech...';
    generateSpeechBtn.querySelector('.btn-icon').className = 'fa-solid fa-circle-notch fa-spin btn-icon';
    
    try {
        const encrypted = encryptPayload({
            text: text,
            voice: voice,
            rate: rateStr,
            pitch: pitchStr
        });
        const response = await fetch(`${API_BASE_URL}/api/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(encrypted)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Speech synthesis failed');
        }

        audioBlob = await response.blob();
        
        // Clean up previous URL
        if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
        }
        
        audioUrl = URL.createObjectURL(audioBlob);
        nativeAudio.src = audioUrl;
        
        // Enable Controls
        playPauseBtn.disabled = false;
        downloadSpeechBtn.disabled = false;
        
        // Auto load meta details of player
        nativeAudio.load();
        
        // Visualizer transition
        visualizerPlaceholder.style.opacity = '0';
        setTimeout(() => { visualizerPlaceholder.style.display = 'none'; }, 300);
        
        // Play speech
        togglePlayback(true);
        
        // Save to Local/Server History
        saveToHistory({
            text: text,
            translatedText: text,
            sourceLang: sourceLangSelect.options[sourceLangSelect.selectedIndex].text,
            sourceLangCode: sourceLangSelect.value,
            targetLang: targetLangSelect.options[targetLangSelect.selectedIndex].text,
            targetLangCode: targetLangSelect.value,
            voiceName: voiceSelect.options[voiceSelect.selectedIndex].text,
            voiceCode: voice,
            rate: rateVal,
            pitch: pitchVal,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
        
    } catch (error) {
        console.error('Speech generation error:', error);
        alert(`TTS failed: ${error.message}`);
    } finally {
        generateSpeechBtn.disabled = false;
        generateSpeechBtn.classList.remove('generating');
        generateSpeechBtn.querySelector('span').textContent = 'Generate Neural Voice';
        generateSpeechBtn.querySelector('.btn-icon').className = 'fa-solid fa-microphone-lines btn-icon';
    }
}

// Audio Player Functions
function togglePlayback(forcePlay = false) {
    if (!audioUrl) return;
    
    // Initialize analyzer nodes on first play
    initAudioAnalyser();
    
    if (nativeAudio.paused || forcePlay) {
        // Resume context if suspended
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        nativeAudio.play();
        isPlaying = true;
        playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
        playPauseBtn.classList.replace('play-btn', 'pause-btn');
        
        // Trigger visualizer loop
        drawVisualizer();
    } else {
        nativeAudio.pause();
        isPlaying = false;
        playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
        playPauseBtn.classList.replace('pause-btn', 'play-btn');
    }
}

function updatePlaybackProgress() {
    if (!nativeAudio.duration) return;
    const progress = (nativeAudio.currentTime / nativeAudio.duration) * 100;
    progressBar.style.width = `${progress}%`;
    progressHandle.style.left = `${progress}%`;
    
    // Update text
    playerTime.textContent = `${formatTime(nativeAudio.currentTime)} / ${formatTime(nativeAudio.duration)}`;
}

function onAudioEnded() {
    isPlaying = false;
    progressBar.style.width = '0%';
    progressHandle.style.left = '0%';
    playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    playPauseBtn.classList.replace('pause-btn', 'play-btn');
    playerTime.textContent = `0:00 / ${formatTime(nativeAudio.duration)}`;
}

function startDragSeek(e) {
    if (!audioUrl) return;
    seek(e);
    
    function onMouseMove(moveEvent) {
        seek(moveEvent);
    }
    
    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

function seek(e) {
    const rect = progressContainer.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const seekPercentage = Math.max(0, Math.min(1, pos));
    
    if (nativeAudio.duration) {
        nativeAudio.currentTime = seekPercentage * nativeAudio.duration;
        updatePlaybackProgress();
    }
}

function toggleMute() {
    nativeAudio.muted = !nativeAudio.muted;
    if (nativeAudio.muted) {
        playerMuteBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
        playerVolumeSlider.value = 0;
    } else {
        playerMuteBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
        playerVolumeSlider.value = nativeAudio.volume;
    }
}

// Download Trigger (Using streaming file attachment via backend)
downloadSpeechBtn.addEventListener('click', triggerSecureDownload);

// Format Time helper
function formatTime(secs) {
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

// Web Audio API Visualizer Setup
function initAudioAnalyser() {
    if (audioCtx) return; // Already setup
    
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 256;
        
        sourceNode = audioCtx.createMediaElementSource(nativeAudio);
        sourceNode.connect(analyserNode);
        analyserNode.connect(audioCtx.destination);
    } catch (e) {
        console.warn('AudioContext setup not supported/failed:', e);
    }
}

// Draw animated resting wave when audio is idle
let idlePhase = 0;
function drawIdleWave() {
    if (isPlaying) return; // Let active visualizer draw
    
    canvasCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    
    const isDark = document.body.classList.contains('dark-theme');
    canvasCtx.strokeStyle = isDark ? 'rgba(99, 102, 241, 0.18)' : 'rgba(99, 102, 241, 0.15)';
    canvasCtx.lineWidth = 2.5;
    canvasCtx.beginPath();
    
    const width = waveformCanvas.width;
    const height = waveformCanvas.height;
    const midY = height / 2;
    
    for (let x = 0; x < width; x++) {
        // Draw three offset sine waves overlaying each other
        const angle = (x / 100) + idlePhase;
        const y = midY + Math.sin(angle) * 8 * Math.sin(x / width * Math.PI);
        if (x === 0) canvasCtx.moveTo(x, y);
        else canvasCtx.lineTo(x, y);
    }
    
    canvasCtx.stroke();
    
    idlePhase += 0.02;
    requestAnimationFrame(drawIdleWave);
}

// Active play analyzer wave drawer
function drawVisualizer() {
    if (!isPlaying) return;
    
    animationFrameId = requestAnimationFrame(drawVisualizer);
    
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserNode.getByteFrequencyData(dataArray);
    
    canvasCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    
    const width = waveformCanvas.width;
    const height = waveformCanvas.height;
    const barWidth = (width / bufferLength) * 1.5;
    let barHeight;
    let x = 0;
    
    // Draw mirrored gradient bars or clean continuous waveforms
    const isDark = document.body.classList.contains('dark-theme');
    
    for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * (height * 0.7);
        
        // Indigo to violet color spectrum mapping
        const percent = i / bufferLength;
        const r = Math.floor(99 + percent * (168 - 99));
        const g = Math.floor(102 - percent * (102 - 85));
        const b = Math.floor(241 + percent * (247 - 241));
        
        canvasCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        
        // Draw double vertical bars extending from center for neat wave layout
        const midY = height / 2;
        canvasCtx.fillRect(x, midY - barHeight / 2, barWidth - 1.5, barHeight);
        
        x += barWidth;
    }
}

// Helper functions for encrypted User localStorage
function saveUserLocalData(key, data) {
    try {
        const encrypted = CryptoJS.AES.encrypt(JSON.stringify(data), SECRET_KEY).toString();
        localStorage.setItem(`vocalify_secure_${key}`, encrypted);
    } catch (e) {
        console.error(`Failed to save local data for key ${key}:`, e);
    }
}

function loadUserLocalData(key) {
    try {
        const stored = localStorage.getItem(`vocalify_secure_${key}`);
        if (!stored) return null;
        const bytes = CryptoJS.AES.decrypt(stored, SECRET_KEY);
        const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
        return decryptedStr ? JSON.parse(decryptedStr) : null;
    } catch (e) {
        console.error(`Failed to load local data for key ${key}:`, e);
        return null;
    }
}

async function syncGuestDataToLocalUser() {
    if (!currentUser) return;
    
    // Sync glossary
    try {
        let guestGlossary = [];
        const stored = localStorage.getItem('vocalify_glossary_secure');
        if (stored) {
            const bytes = CryptoJS.AES.decrypt(stored, SECRET_KEY);
            const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
            guestGlossary = decryptedStr ? JSON.parse(decryptedStr) : [];
        }
        
        if (guestGlossary.length > 0) {
            let userGlossary = loadUserLocalData(`glossary_${currentUser.id}`) || [];
            guestGlossary.forEach(rule => {
                if (!userGlossary.some(r => r.original.toLowerCase() === rule.original.toLowerCase())) {
                    userGlossary.push(rule);
                }
            });
            saveUserLocalData(`glossary_${currentUser.id}`, userGlossary);
            localStorage.removeItem('vocalify_glossary_secure');
            localStorage.removeItem('vocalify_glossary_raw');
        }
    } catch (e) {
        console.error("Failed to sync guest glossary to local user:", e);
    }
    
    // Sync history
    try {
        let guestHistory = [];
        const stored = localStorage.getItem('vocalify_history_secure');
        if (stored) {
            const bytes = CryptoJS.AES.decrypt(stored, SECRET_KEY);
            const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
            guestHistory = decryptedStr ? JSON.parse(decryptedStr) : [];
        }
        
        if (guestHistory.length > 0) {
            let userHistory = loadUserLocalData(`history_${currentUser.id}`) || [];
            userHistory = [...guestHistory, ...userHistory].slice(0, 30);
            saveUserLocalData(`history_${currentUser.id}`, userHistory);
            localStorage.removeItem('vocalify_history_secure');
        }
    } catch (e) {
        console.error("Failed to sync guest history to local user:", e);
    }
}

async function syncGuestDataToFirestore() {
    if (!currentUser || !isFirebaseActive) return;
    
    // 1. Sync glossary
    try {
        let guestGlossary = [];
        const stored = localStorage.getItem('vocalify_glossary_secure');
        if (stored) {
            const bytes = CryptoJS.AES.decrypt(stored, SECRET_KEY);
            const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
            guestGlossary = decryptedStr ? JSON.parse(decryptedStr) : [];
        }
        
        if (guestGlossary.length > 0) {
            console.log(`Syncing ${guestGlossary.length} glossary items from Guest to Firestore...`);
            for (const rule of guestGlossary) {
                const docId = rule.original.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
                await setDoc(doc(db, "users", currentUser.id, "glossary", docId), {
                    original: rule.original,
                    refined: rule.refined,
                    timestamp: Date.now()
                });
            }
            localStorage.removeItem('vocalify_glossary_secure');
            localStorage.removeItem('vocalify_glossary_raw');
        }
    } catch (e) {
        console.error("Failed to sync guest glossary to Firestore:", e);
    }
    
    // 2. Sync history
    try {
        let guestHistory = [];
        const stored = localStorage.getItem('vocalify_history_secure');
        if (stored) {
            const bytes = CryptoJS.AES.decrypt(stored, SECRET_KEY);
            const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
            guestHistory = decryptedStr ? JSON.parse(decryptedStr) : [];
        }
        
        if (guestHistory.length > 0) {
            console.log(`Syncing ${guestHistory.length} history items from Guest to Firestore...`);
            for (const item of guestHistory) {
                await addDoc(collection(db, "users", currentUser.id, "history"), {
                    sourceLang: item.sourceLang || 'Auto Detect',
                    sourceLangCode: item.sourceLangCode || 'auto',
                    targetLang: item.targetLang || 'Tamil (தமிழ்)',
                    targetLangCode: item.targetLangCode || 'ta',
                    translatedText: item.translatedText,
                    voiceName: item.voiceName,
                    voiceCode: item.voiceCode,
                    rate: item.rate,
                    pitch: item.pitch,
                    timestamp: item.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    createdAt: Date.now()
                });
            }
            localStorage.removeItem('vocalify_history_secure');
        }
    } catch (e) {
        console.error("Failed to sync guest history to Firestore:", e);
    }
}

// History Logging (Encrypted localStorage / Firestore database)
function loadHistory() {
    if (currentUser) {
        if (isFirebaseActive) {
            fetchHistoryFromServer();
        } else {
            historyItems = loadUserLocalData(`history_${currentUser.id}`) || [];
            renderHistory();
        }
        return;
    }
    try {
        const stored = localStorage.getItem('vocalify_history_secure');
        if (!stored) {
            historyItems = [];
            renderHistory();
            return;
        }
        const bytes = CryptoJS.AES.decrypt(stored, SECRET_KEY);
        const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
        historyItems = decryptedStr ? JSON.parse(decryptedStr) : [];
        renderHistory();
    } catch (e) {
        console.error('Error parsing history:', e);
        historyItems = [];
        renderHistory();
    }
}

async function saveToHistory(item) {
    if (currentUser) {
        if (isFirebaseActive) {
            try {
                await addDoc(collection(db, "users", currentUser.id, "history"), {
                    sourceLang: item.sourceLang,
                    sourceLangCode: item.sourceLangCode,
                    targetLang: item.targetLang,
                    targetLangCode: item.targetLangCode,
                    translatedText: item.translatedText,
                    voiceName: item.voiceName,
                    voiceCode: item.voiceCode,
                    rate: item.rate,
                    pitch: item.pitch,
                    timestamp: item.timestamp,
                    createdAt: Date.now()
                });
                await fetchHistoryFromServer();
            } catch (e) {
                console.error("Failed to save history to Firestore:", e);
            }
        } else {
            historyItems.unshift(item);
            if (historyItems.length > 30) historyItems.pop();
            saveUserLocalData(`history_${currentUser.id}`, historyItems);
            renderHistory();
        }
    } else {
        historyItems.unshift(item);
        if (historyItems.length > 30) {
            historyItems.pop();
        }
        try {
            const encrypted = CryptoJS.AES.encrypt(JSON.stringify(historyItems), SECRET_KEY).toString();
            localStorage.setItem('vocalify_history_secure', encrypted);
        } catch (e) {
            console.error('Error saving history:', e);
        }
        renderHistory();
    }
}

function renderHistory() {
    historyCountLabel.textContent = `${historyItems.length} items saved`;
    
    if (historyItems.length === 0) {
        historyList.innerHTML = `
            <div class="history-empty">
                <i class="fa-solid fa-folder-open"></i>
                <p>No speech generated yet. Try translating and generating a voice.</p>
            </div>
        `;
        return;
    }

    historyList.innerHTML = '';
    historyItems.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'history-item';
        
        div.innerHTML = `
            <div class="history-item-top">
                <span class="history-item-badge">${item.targetLang}</span>
                <span class="history-item-meta">${item.timestamp}</span>
            </div>
            <div class="history-item-text" title="${item.translatedText}">${item.translatedText}</div>
            <div class="history-item-actions">
                <span class="history-item-voice"><i class="fa-solid fa-volume-low"></i> ${item.voiceName.split(' ')[0]} (${item.rate >= 0 ? '+' : ''}${item.rate}%, ${item.pitch >= 0 ? '+' : ''}${item.pitch}%)</span>
                <div class="history-item-btns">
                    <button class="history-btn history-btn-apply" onclick="applyHistoryItem(${index})">
                        <i class="fa-solid fa-file-signature"></i> Load Settings
                    </button>
                    <button class="history-btn history-btn-play" onclick="quickPlayHistory(${index}, this)">
                        <i class="fa-solid fa-play"></i> Play
                    </button>
                </div>
            </div>
        `;
        historyList.appendChild(div);
    });
}

async function clearHistory() {
    if (historyItems.length === 0) return;
    if (confirm('Are you sure you want to clear all history?')) {
        if (currentUser) {
            if (isFirebaseActive) {
                try {
                    const qSnapshot = await getDocs(collection(db, "users", currentUser.id, "history"));
                    const deletePromises = qSnapshot.docs.map(docSnap => deleteDoc(doc(db, "users", currentUser.id, "history", docSnap.id)));
                    await Promise.all(deletePromises);
                    historyItems = [];
                    renderHistory();
                } catch (e) {
                    console.error("Failed to clear history in Firestore:", e);
                    alert('Could not clear history on server');
                }
            } else {
                historyItems = [];
                saveUserLocalData(`history_${currentUser.id}`, historyItems);
                renderHistory();
            }
        } else {
            historyItems = [];
            localStorage.removeItem('vocalify_history_secure');
            renderHistory();
        }
    }
}

// Global scope bindings for history item actions
window.applyHistoryItem = (index) => {
    const item = historyItems[index];
    if (!item) return;

    outputText.value = item.translatedText;
    outputCharCount.textContent = `${item.translatedText.length} chars`;
    
    // Set target language and reload voices
    targetLangSelect.value = item.targetLangCode;
    
    loadVoices().then(() => {
        voiceSelect.value = item.voiceCode;
        rateSlider.value = item.rate;
        pitchSlider.value = item.pitch;
        
        rateValue.textContent = item.rate === 0 ? 'Normal (0%)' : `${item.rate > 0 ? '+' : ''}${item.rate}%`;
        pitchValue.textContent = item.pitch === 0 ? 'Normal (0%)' : `${item.pitch > 0 ? '+' : ''}${item.pitch}%`;
        
        // Scroll smoothly to output
        outputText.scrollIntoView({ behavior: 'smooth' });
    });
};

window.quickPlayHistory = async (index, btn) => {
    const item = historyItems[index];
    if (!item) return;

    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Processing';
    
    try {
        const rateStr = `${item.rate >= 0 ? '+' : ''}${item.rate}%`;
        const pitchStr = `${item.pitch >= 0 ? '+' : ''}${item.pitch}%`;

        const encrypted = encryptPayload({
            text: item.translatedText,
            voice: item.voiceCode,
            rate: rateStr,
            pitch: pitchStr
        });
        const response = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(encrypted)
        });

        if (!response.ok) throw new Error('Speech synthesis failed');

        const tempBlob = await response.blob();
        const tempUrl = URL.createObjectURL(tempBlob);
        
        // Play inside main native player to update active visualizer & global controls!
        audioBlob = tempBlob;
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        audioUrl = tempUrl;
        
        nativeAudio.src = audioUrl;
        nativeAudio.load();
        
        // Enable Controls
        playPauseBtn.disabled = false;
        downloadSpeechBtn.disabled = false;
        visualizerPlaceholder.style.opacity = '0';
        visualizerPlaceholder.style.display = 'none';
        
        togglePlayback(true);
    } catch (e) {
        console.error(e);
        alert('Could not play history item speech');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
};

// Smart Glossary Persistence and Event Handlers
// Smart Glossary Persistence and Event Handlers
function loadGlossary() {
    if (currentUser) {
        if (isFirebaseActive) {
            fetchGlossaryFromServer();
        } else {
            glossaryRules = loadUserLocalData(`glossary_${currentUser.id}`) || [];
            renderGlossary();
        }
        return;
    }
    try {
        const stored = localStorage.getItem('vocalify_glossary_secure');
        if (!stored) {
            glossaryRules = [];
            renderGlossary();
            return;
        }
        const bytes = CryptoJS.AES.decrypt(stored, SECRET_KEY);
        const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
        glossaryRules = decryptedStr ? JSON.parse(decryptedStr) : [];
        renderGlossary();
    } catch (e) {
        console.error('Error loading glossary:', e);
        glossaryRules = [];
        renderGlossary();
    }
}

function saveGlossary() {
    try {
        const encrypted = CryptoJS.AES.encrypt(JSON.stringify(glossaryRules), SECRET_KEY).toString();
        localStorage.setItem('vocalify_glossary_secure', encrypted);
    } catch (e) {
        console.error('Error saving glossary:', e);
    }
}

function renderGlossary() {
    const glossaryList = document.getElementById('glossary-list');
    if (!glossaryList) return;
    
    if (glossaryRules.length === 0) {
        glossaryList.innerHTML = `<div style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 10px;">No corrections defined. Add one above!</div>`;
        return;
    }
    
    glossaryList.innerHTML = '';
    glossaryRules.forEach((rule, index) => {
        const div = document.createElement('div');
        div.className = 'glossary-item';
        div.innerHTML = `
            <div class="glossary-item-text" title="'${rule.original}' replaced by '${rule.refined}'">
                <span class="orig">${rule.original}</span>
                <span class="glossary-arrow-mini"><i class="fa-solid fa-arrow-right"></i></span>
                <span class="refi">${rule.refined}</span>
            </div>
            <button class="glossary-item-delete" onclick="deleteGlossaryRule(${index})">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;
        glossaryList.appendChild(div);
    });
}

async function addGlossaryRule() {
    const origInput = document.getElementById('glossary-original');
    const refInput = document.getElementById('glossary-refined');
    const origVal = origInput.value.trim();
    const refVal = refInput.value.trim();
    
    if (!origVal || !refVal) {
        alert('Please fill in both fields to add a translation correction.');
        return;
    }
    
    const exists = glossaryRules.some(r => r.original.toLowerCase() === origVal.toLowerCase());
    if (exists) {
        alert('A translation correction for this term already exists.');
        return;
    }
    
    if (currentUser) {
        if (isFirebaseActive) {
            try {
                const docId = origVal.toLowerCase().replace(/[^a-z0-9]/g, '_');
                await setDoc(doc(db, "users", currentUser.id, "glossary", docId), {
                    original: origVal,
                    refined: refVal,
                    timestamp: Date.now()
                });
                glossaryRules.push({ original: origVal, refined: refVal, id: docId });
                renderGlossary();
            } catch (e) {
                console.error("Failed to add glossary rule to Firestore:", e);
                alert('Could not save glossary rule to server');
            }
        } else {
            glossaryRules.push({ original: origVal, refined: refVal });
            saveUserLocalData(`glossary_${currentUser.id}`, glossaryRules);
            renderGlossary();
        }
    } else {
        glossaryRules.push({ original: origVal, refined: refVal });
        saveGuestGlossary();
        renderGlossary();
    }
    
    origInput.value = '';
    refInput.value = '';
    origInput.focus();
}

function saveGuestGlossary() {
    try {
        const encrypted = CryptoJS.AES.encrypt(JSON.stringify(glossaryRules), SECRET_KEY).toString();
        localStorage.setItem('vocalify_glossary_secure', encrypted);
    } catch (e) {
        console.error('Error saving glossary:', e);
    }
}

window.deleteGlossaryRule = async (index) => {
    const rule = glossaryRules[index];
    if (!rule) return;
    
    if (currentUser) {
        if (isFirebaseActive) {
            try {
                const docId = rule.id || rule.original.toLowerCase().replace(/[^a-z0-9]/g, '_');
                await deleteDoc(doc(db, "users", currentUser.id, "glossary", docId));
                glossaryRules.splice(index, 1);
                renderGlossary();
            } catch (e) {
                console.error("Failed to delete glossary rule from Firestore:", e);
                alert('Could not delete glossary rule');
            }
        } else {
            glossaryRules.splice(index, 1);
            saveUserLocalData(`glossary_${currentUser.id}`, glossaryRules);
            renderGlossary();
        }
    } else {
        glossaryRules.splice(index, 1);
        saveGuestGlossary();
        renderGlossary();
    }
};

async function handleGoogleSignIn() {
    if (isFirebaseActive) {
        try {
            const provider = new GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            await signInWithPopup(auth, provider);
        } catch (e) {
            console.error("Google Sign-In failed:", e);
            alert(`Authentication failed: ${e.message}`);
        }
    } else {
        alert("Authentication is currently unavailable because Firebase is not configured.");
    }
}

function updateAuthUI() {
    const authContainer = document.getElementById('google-auth-container');
    const profileBadge = document.getElementById('user-profile-badge');
    const avatar = document.getElementById('user-avatar');
    const nameLabel = document.getElementById('user-name');
    
    const loginScreen = document.getElementById('login-screen');
    const appContainer = document.querySelector('.app-container');
    
    if (currentUser) {
        if (authContainer) authContainer.style.display = 'none';
        if (profileBadge) profileBadge.style.display = 'flex';
        if (avatar) avatar.src = currentUser.picture || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
        if (nameLabel) nameLabel.textContent = currentUser.name || currentUser.email;
        
        if (loginScreen) loginScreen.classList.add('hidden');
        if (appContainer) appContainer.classList.add('ready');
    } else {
        if (authContainer) authContainer.style.display = 'flex';
        if (profileBadge) profileBadge.style.display = 'none';
        
        if (loginScreen) loginScreen.classList.remove('hidden');
        if (appContainer) appContainer.classList.remove('ready');
    }
}



async function handleSignOut() {
    if (confirm('Are you sure you want to sign out?')) {
        if (isFirebaseActive) {
            try {
                await firebaseSignOut(auth);
            } catch (e) {
                console.error("Sign out failed:", e);
                alert("Failed to sign out from Firebase.");
            }
        } else {
            currentUser = null;
            localStorage.removeItem('vocalify_user_secure');
            
            historyItems = [];
            glossaryRules = [];
            
            updateAuthUI();
            loadHistory();
            loadGlossary();
        }
    }
}

async function fetchHistoryFromServer() {
    if (!currentUser || !isFirebaseActive) return;
    try {
        const querySnapshot = await getDocs(collection(db, "users", currentUser.id, "history"));
        const items = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            items.push({
                id: doc.id,
                sourceLang: data.sourceLang || 'Auto Detect',
                sourceLangCode: data.sourceLangCode || 'auto',
                targetLang: data.targetLang || 'Tamil (தமிழ்)',
                targetLangCode: data.targetLangCode || 'ta',
                translatedText: data.translatedText,
                voiceName: data.voiceName,
                voiceCode: data.voiceCode,
                rate: data.rate || 0,
                pitch: data.pitch || 0,
                timestamp: data.timestamp,
                createdAt: data.createdAt || 0
            });
        });
        
        items.sort((a, b) => b.createdAt - a.createdAt);
        historyItems = items.slice(0, 30);
        renderHistory();
    } catch (e) {
        console.error("Error fetching history from Firestore:", e);
    }
}

async function fetchGlossaryFromServer() {
    if (!currentUser || !isFirebaseActive) return;
    try {
        const querySnapshot = await getDocs(collection(db, "users", currentUser.id, "glossary"));
        glossaryRules = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            glossaryRules.push({
                id: doc.id,
                original: data.original,
                refined: data.refined
            });
        });
        renderGlossary();
    } catch (e) {
        console.error("Error fetching glossary from Firestore:", e);
    }
}
