/* ============================================================
 * Copilot Studio Voice Agent — Erica 2
 * Keys are stored in browser localStorage (never in code).
 * On first use, the settings modal asks for keys.
 * ============================================================ */

function loadConfig() {
    return {
        SPEECH_KEY:                  localStorage.getItem("e2_speech_key")    || "",
        SPEECH_REGION:               localStorage.getItem("e2_speech_region") || "eastus2",
        SPEECH_RECOGNITION_LANGUAGE: "en-US",
        SPEECH_SYNTHESIS_VOICE:      "en-US-AvaMultilingualNeural",
        DIRECT_LINE_SECRET:          localStorage.getItem("e2_dl_secret")     || "",
        DIRECT_LINE_BASE:            "https://directline.botframework.com/v3/directline"
    };
}

let CONFIG = loadConfig();

// ============================================================
// State
// ============================================================
const state = {
    speechConfig: null,
    recognizer: null,
    synthesizer: null,
    audioPlayer: null,
    conversationId: null,
    streamUrl: null,
    websocket: null,
    userId: "user-" + Math.random().toString(36).slice(2, 10),
    isRecording: false,
    isSpeaking: false,
    initialized: false,
    lastInputMode: "voice" // "voice" or "text" — controls whether to speak the bot reply
};

// DOM
const micBtn = document.getElementById("micBtn");
const endBtn = document.getElementById("endBtn");
const statusEl = document.getElementById("status");
const transcriptEl = document.getElementById("transcript");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const chatContainer = document.getElementById("chatContainer");
const launcher = document.getElementById("launcher");
const minimizeBtn = document.getElementById("minimizeBtn");

// Minimize / launcher behavior
function openChat() {
    chatContainer.classList.remove("hidden");
    launcher.classList.remove("visible");
    setTimeout(() => chatInput?.focus(), 250);
}

function minimizeChat() {
    chatContainer.classList.add("hidden");
    launcher.classList.add("visible");
    // Optional: stop mic when minimized so it doesn't keep listening
    if (state.isRecording) stopListening();
}

if (minimizeBtn) minimizeBtn.addEventListener("click", minimizeChat);
if (launcher)    launcher.addEventListener("click", openChat);

// ============================================================
// Settings modal — save keys to localStorage
// ============================================================
const settingsOverlay = document.getElementById("settingsOverlay");
const settingsBtn     = document.getElementById("settingsBtn");
const settingsSave    = document.getElementById("settingsSave");
const settingsCancel  = document.getElementById("settingsCancel");
const cfgSpeechKey    = document.getElementById("cfgSpeechKey");
const cfgSpeechRegion = document.getElementById("cfgSpeechRegion");
const cfgDlSecret     = document.getElementById("cfgDlSecret");

function openSettings() {
    // Pre-fill with existing saved values (masked for passwords)
    cfgSpeechKey.value    = localStorage.getItem("e2_speech_key")    || "";
    cfgSpeechRegion.value = localStorage.getItem("e2_speech_region") || "eastus2";
    cfgDlSecret.value     = localStorage.getItem("e2_dl_secret")     || "";
    settingsOverlay.classList.remove("hidden");
}

function closeSettings() {
    settingsOverlay.classList.add("hidden");
}

if (settingsBtn)    settingsBtn.addEventListener("click", openSettings);
if (settingsCancel) settingsCancel.addEventListener("click", closeSettings);

if (settingsSave) {
    settingsSave.addEventListener("click", () => {
        const key    = cfgSpeechKey.value.trim();
        const region = cfgSpeechRegion.value.trim();
        const secret = cfgDlSecret.value.trim();

        if (!key || !region || !secret) {
            alert("Please fill in all three fields.");
            return;
        }

        localStorage.setItem("e2_speech_key",    key);
        localStorage.setItem("e2_speech_region", region);
        localStorage.setItem("e2_dl_secret",     secret);

        // Reload config and reset connection
        CONFIG = loadConfig();
        state.initialized = false;
        state.conversationId = null;
        try { state.websocket?.close(); } catch {}
        stopListening();
        stopSpeaking();

        closeSettings();
        addMessage("Settings saved! Click the mic or type to start a new conversation.", "bot");
        setStatus("Ready", "idle");
    });
}

// On page load: show settings if keys are missing
window.addEventListener("DOMContentLoaded", () => {
    if (!CONFIG.SPEECH_KEY || !CONFIG.DIRECT_LINE_SECRET) {
        openSettings();
    }
});

// ============================================================
// UI helpers
// ============================================================
function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = "status " + cls;
    // Sync avatar animation to current state
    const avatar = document.getElementById("avatar");
    if (avatar) {
        avatar.classList.remove("listening", "speaking", "thinking");
        if (cls === "listening" || cls === "speaking" || cls === "thinking") {
            avatar.classList.add(cls);
        }
    }
}

function addMessage(text, who, opts = {}) {
    const wrap = document.createElement("div");
    wrap.className = "message " + who + (opts.interim ? " interim" : "");
    if (opts.id) wrap.id = opts.id;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    wrap.appendChild(bubble);
    transcriptEl.appendChild(wrap);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
    return wrap;
}

function updateInterim(text) {
    let el = document.getElementById("interim-msg");
    if (!el) {
        el = addMessage(text, "user", { interim: true, id: "interim-msg" });
    } else {
        el.querySelector(".bubble").textContent = text;
        transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }
}

function clearInterim() {
    const el = document.getElementById("interim-msg");
    if (el) el.remove();
}

// ============================================================
// Direct Line — connect to Copilot Studio
// ============================================================
async function startDirectLineConversation() {
    const res = await fetch(`${CONFIG.DIRECT_LINE_BASE}/conversations`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${CONFIG.DIRECT_LINE_SECRET}` }
    });
    if (!res.ok) throw new Error(`Direct Line start failed: ${res.status}`);
    const data = await res.json();
    state.conversationId = data.conversationId;
    state.streamUrl = data.streamUrl;

    // Open WebSocket for streaming bot responses
    state.websocket = new WebSocket(state.streamUrl);
    state.websocket.onmessage = handleBotMessage;
    state.websocket.onerror = (e) => console.error("WebSocket error:", e);
    state.websocket.onclose = () => console.log("WebSocket closed");

    return new Promise((resolve, reject) => {
        state.websocket.onopen = () => {
            console.log("Direct Line WebSocket connected. Conversation:", state.conversationId);
            resolve();
        };
        setTimeout(() => reject(new Error("WebSocket timeout")), 10000);
    });
}

function handleBotMessage(event) {
    if (!event.data) return; // Direct Line sends empty keepalives
    let payload;
    try { payload = JSON.parse(event.data); }
    catch { return; }
    if (!payload.activities) return;

    for (const activity of payload.activities) {
        if (activity.type !== "message") continue;
        if (activity.from?.id === state.userId) continue; // ignore echo of our own message
        if (!activity.text) continue;

        addMessage(activity.text, "bot");
        // Only speak the reply if the user's last message came in via voice
        if (state.lastInputMode === "voice") {
            speakText(cleanForSpeech(activity.text));
        } else {
            // Text mode — just show in the transcript and reset status
            setStatus("Idle", "idle");
        }
    }
}

// Strip markdown / formatting characters that TTS would read aloud
function cleanForSpeech(text) {
    return text
        // Remove markdown links [label](url) → label
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        // Remove images ![alt](url)
        .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
        // Remove code fences and inline code backticks
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`/g, "")
        // Remove markdown headings (#, ##, ###...)
        .replace(/^\s*#{1,6}\s*/gm, "")
        // Remove bold/italic markers
        .replace(/[*_~]{1,3}/g, "")
        // Remove blockquote markers
        .replace(/^\s*>\s?/gm, "")
        // Remove list bullets at line start
        .replace(/^\s*[-+*]\s+/gm, "")
        .replace(/^\s*\d+\.\s+/gm, "")
        // Remove stray HTML tags
        .replace(/<[^>]+>/g, "")
        // Collapse multiple newlines/spaces
        .replace(/\n{2,}/g, ". ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

async function sendToBot(text) {
    if (!state.conversationId) return;
    try {
        await fetch(`${CONFIG.DIRECT_LINE_BASE}/conversations/${state.conversationId}/activities`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${CONFIG.DIRECT_LINE_SECRET}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                type: "message",
                from: { id: state.userId },
                text: text,
                locale: CONFIG.SPEECH_RECOGNITION_LANGUAGE
            })
        });
        setStatus("Thinking…", "thinking");
    } catch (err) {
        console.error("sendToBot failed:", err);
        setStatus("Send error", "error");
    }
}

// ============================================================
// Azure Speech — STT (microphone -> text)
// ============================================================
function buildSpeechConfig() {
    const cfg = SpeechSDK.SpeechConfig.fromSubscription(CONFIG.SPEECH_KEY, CONFIG.SPEECH_REGION);
    cfg.speechRecognitionLanguage = CONFIG.SPEECH_RECOGNITION_LANGUAGE;
    cfg.speechSynthesisVoiceName = CONFIG.SPEECH_SYNTHESIS_VOICE;
    return cfg;
}

function startListening() {
    if (state.isRecording) return; // already listening (allow even if bot is speaking, for barge-in)

    const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
    state.recognizer = new SpeechSDK.SpeechRecognizer(state.speechConfig, audioConfig);

    state.recognizer.recognizing = (_s, e) => {
        if (!e.result.text) return;
        // Barge-in: if the bot is currently speaking, cut it off
        if (state.isSpeaking) stopSpeaking();
        updateInterim(e.result.text);
    };

    state.recognizer.recognized = (_s, e) => {
        if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech && e.result.text) {
            clearInterim();
            addMessage(e.result.text, "user");
            // Also cut off any TTS still playing (safety net)
            if (state.isSpeaking) stopSpeaking();
            state.lastInputMode = "voice"; // mark so reply is spoken
            sendToBot(e.result.text);
            // Note: keep listening so user can barge-in on the next bot reply
        } else if (e.result.reason === SpeechSDK.ResultReason.NoMatch) {
            clearInterim();
        }
    };

    state.recognizer.canceled = (_s, e) => {
        console.error("Recognition canceled:", e.errorDetails);
        if (e.reason === SpeechSDK.CancellationReason.Error) {
            setStatus("Speech error", "error");
        }
        stopListening();
        // Auto-restart mic so the conversation keeps going
        if (state.initialized) setTimeout(() => startListening(), 500);
    };

    state.recognizer.sessionStopped = () => {
        stopListening();
        // Auto-restart mic (Azure sometimes ends sessions after long silence)
        if (state.initialized) setTimeout(() => startListening(), 500);
    };

    state.recognizer.startContinuousRecognitionAsync(
        () => {
            state.isRecording = true;
            micBtn.classList.add("recording");
            setStatus("Listening…", "listening");
        },
        (err) => {
            console.error("startContinuousRecognitionAsync error:", err);
            setStatus("Mic error", "error");
        }
    );
}

function stopListening() {
    if (!state.recognizer) return;
    const rec = state.recognizer;
    state.recognizer = null;
    state.isRecording = false;
    micBtn.classList.remove("recording");
    rec.stopContinuousRecognitionAsync(
        () => { try { rec.close(); } catch {} },
        () => { try { rec.close(); } catch {} }
    );
    if (statusEl.textContent === "Listening…") setStatus("Idle", "idle");
}

// ============================================================
// Azure Speech — TTS (text -> speaker)
// ============================================================
function speakText(text) {
    // If already speaking, stop the previous utterance first
    if (state.isSpeaking) stopSpeaking();

    // CRITICAL for barge-in: make sure mic is on BEFORE the bot starts talking
    if (!state.isRecording) startListening();

    state.isSpeaking = true;
    setStatus("Speaking…", "speaking");

    // Use SpeakerAudioDestination so we can pause buffered audio instantly
    const player = new SpeechSDK.SpeakerAudioDestination();
    state.audioPlayer = player;
    const audioConfig = SpeechSDK.AudioConfig.fromSpeakerOutput(player);
    const synth = new SpeechSDK.SpeechSynthesizer(state.speechConfig, audioConfig);
    state.synthesizer = synth;

    // Fires when audio playback (not synthesis) actually finishes
    player.onAudioEnd = () => {
        state.isSpeaking = false;
        if (state.audioPlayer === player) state.audioPlayer = null;
        setStatus(state.isRecording ? "Listening…" : "Idle",
                  state.isRecording ? "listening" : "idle");
    };

    synth.speakTextAsync(
        text,
        (result) => {
            try { synth.close(); } catch {}
            if (state.synthesizer === synth) state.synthesizer = null;
            // Note: don't clear isSpeaking here — onAudioEnd handles it
            // because synth.close() returns when generation is done,
            // but audio may still be playing.
            if (result.reason !== SpeechSDK.ResultReason.SynthesizingAudioCompleted &&
                result.reason !== SpeechSDK.ResultReason.Canceled) {
                console.error("TTS failed:", result.errorDetails);
                setStatus("TTS error", "error");
                state.isSpeaking = false;
            }
        },
        (err) => {
            console.error("TTS error:", err);
            try { synth.close(); } catch {}
            if (state.synthesizer === synth) state.synthesizer = null;
            state.isSpeaking = false;
            setStatus("TTS error", "error");
        }
    );
}

// Stop the bot's voice immediately (used for barge-in)
function stopSpeaking() {
    state.isSpeaking = false;

    // 1. Pause the audio player INSTANTLY (stops already-buffered audio)
    if (state.audioPlayer) {
        try { state.audioPlayer.pause(); } catch (e) { console.warn("pause:", e); }
        try { state.audioPlayer.close(); } catch {}
        state.audioPlayer = null;
    }

    // 2. Stop synthesis on Azure side (no more audio chunks generated)
    if (state.synthesizer) {
        const synth = state.synthesizer;
        state.synthesizer = null;
        try {
            if (typeof synth.stopSpeakingAsync === "function") {
                synth.stopSpeakingAsync(
                    () => { try { synth.close(); } catch {} },
                    () => { try { synth.close(); } catch {} }
                );
            } else {
                synth.close();
            }
        } catch (e) {
            console.warn("stopSpeaking error:", e);
        }
    }

    setStatus(state.isRecording ? "Listening…" : "Idle",
              state.isRecording ? "listening" : "idle");
}

// ============================================================
// Mic button — initialize on first click, toggle thereafter
// ============================================================
async function initialize() {
    if (state.initialized) return;
    setStatus("Connecting…", "thinking");
    try {
        if (typeof SpeechSDK === "undefined") {
            throw new Error("Speech SDK not loaded. Check internet connection.");
        }
        state.speechConfig = buildSpeechConfig();
        await startDirectLineConversation();
        state.initialized = true;
        endBtn.disabled = false;
        setStatus("Ready", "idle");
    } catch (err) {
        console.error("Initialization failed:", err);
        setStatus("Connection failed", "error");
        addMessage("Could not connect: " + err.message, "bot");
        throw err;
    }
}

micBtn.addEventListener("click", async () => {
    try {
        if (!state.initialized) await initialize();
    } catch { return; }

    if (state.isSpeaking) {
        // Interrupt current TTS playback
        stopSpeaking();
    }

    if (state.isRecording) {
        stopListening();
    } else {
        startListening();
    }
});

endBtn.addEventListener("click", () => {
    stopListening();
    stopSpeaking();
    try { state.websocket?.close(); } catch {}
    state.conversationId = null;
    state.initialized = false;
    endBtn.disabled = true;
    chatInput.disabled = true;
    sendBtn.disabled = true;
    setStatus("Ended", "idle");
    addMessage("Conversation ended. Click the mic or type to start a new one.", "bot");
});

// Text chat — type and send messages
chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;

    try {
        if (!state.initialized) await initialize();
    } catch { return; }

    // If bot is talking, interrupt it
    if (state.isSpeaking) stopSpeaking();

    // If mic is on, turn it off — user has switched to text mode
    if (state.isRecording) stopListening();

    chatInput.value = "";
    addMessage(text, "user");
    state.lastInputMode = "text"; // mark so reply is NOT spoken
    sendToBot(text);
});

// Enable mic button once SDK is loaded (poll because SDK loads async)
window.addEventListener("load", () => {
    let attempts = 0;
    const maxAttempts = 50; // 10 seconds total
    const check = setInterval(() => {
        attempts++;
        if (typeof SpeechSDK !== "undefined") {
            clearInterval(check);
            micBtn.disabled = false;
            chatInput.disabled = false;
            sendBtn.disabled = false;
            setStatus("Click mic or type to start", "idle");
            console.log("Speech SDK loaded successfully");
        } else if (attempts >= maxAttempts) {
            clearInterval(check);
            // Text chat works without Speech SDK — keep it enabled
            chatInput.disabled = false;
            sendBtn.disabled = false;
            setStatus("Voice unavailable — text only", "error");
            addMessage("Speech SDK could not be loaded. Voice is disabled but you can still type.", "bot");
        }
    }, 200);
});
