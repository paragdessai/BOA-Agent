# Aria — Copilot Studio Voice Agent

A browser-based voice + text agent for Microsoft Copilot Studio bots. Uses Azure Speech Service (STT/TTS) and Direct Line (chat).

> **Internal team use only.** Azure keys and the Direct Line secret are embedded in `app.js` for ease of testing. Keep this repository **private**.

## Features

- 🎤 Voice conversation (real-time STT + TTS via Azure Speech)
- ⌨️ Text chat (silent — no TTS playback)
- 🛑 Barge-in (interrupt the bot mid-sentence)
- 🤖 Animated avatar (Aria)
- Auto mode-switching: voice in → spoken reply, text in → silent reply

## Run locally

```powershell
cd "path\to\BOA Agent"
python -m http.server 8000
```

Open http://localhost:8000 in Chrome or Edge.

## Files

| File | Purpose |
|------|---------|
| `index.html` | UI layout (avatar, chat area, mic + text input) |
| `app.js` | Speech SDK + Direct Line logic. Edit `CONFIG` at top to change keys/voice |
| `styles.css` | Styling and animations |

## Configuration

Edit the `CONFIG` object at the top of `app.js`:

| Setting | Description |
|---------|-------------|
| `SPEECH_KEY` | Azure Speech resource key |
| `SPEECH_REGION` | Azure region (e.g., `eastus2`) |
| `SPEECH_RECOGNITION_LANGUAGE` | STT language code (e.g., `en-US`) |
| `SPEECH_SYNTHESIS_VOICE` | Neural voice name (e.g., `en-US-AvaMultilingualNeural`) |
| `DIRECT_LINE_SECRET` | Copilot Studio Direct Line secret |

## Deployment

Hosted on Azure Static Web Apps (private). See deployment notes in team docs.
