# Karuda - Voice-Driven Developer Assistant

Karuda is a sophisticated voice overlay application built with Tauri and React, designed to transform spoken instructions into high-quality developer prompts for tools like Cursor, VSCode, and LLMs.

## 🚀 Core Features

### 1. Live Raw Streaming

- **Non-Focus Stealing**: The overlay appears when triggered but does not steal focus from your IDE, allowing uninterrupted coding.
- **Real-time Typing**: Transcribes your speech and types it into the active application as you speak ("Raw" mode).

### 2. Tech-Aware Loanword Translation

- **Intelligent Interception**: Automatically translates Thai transliterated programming terms (e.g., "ฟังก์ชัน", "รีแอค", "สเตท") into their proper English equivalents (`function`, `React`, `state`) on the fly.
- **Dictionary-Based**: Fast, local string replacement with support for over 40 common developer terms.

### 3. AI-Refined Review & Replacement

- **Multi-Provider Support**: Choose between **Anthropic (Claude)**, **Google (Gemini)**, or **OpenAI (GPT-4o)** for refinement.
- **Smart Refinement**: AI processes your raw speech into a clear, professional English developer prompt.
- **User Review Window**: The overlay automatically takes focus once the AI is ready, allowing you to review or edit the prompt before submission.

### 4. Single Prompt Execution

- **Automated Replacement**: Pressing **`Enter`** on the overlay automatically erases the raw text and replaces it with the refined AI output.
- **Auto-Submission**: The app automatically clicks "Enter" in the background application, executing the prompt immediately.
- **Efficiency**: One speech interaction = One executed prompt.

### 5. Advanced VAD & Global Control

- **Extended VAD**: Voice Activity Detection allows up to **2 minutes** of continuous recording.
- **Global Shortcuts**:
  - `Ctrl + Space`: Toggle Recording (Refined Flow).
  - `Ctrl + Shift + Space`: Start/Cancel Recording (Quick Raw).

## 🛠️ Requirements & Setup

For a detailed walkthrough of system dependencies for **Windows, macOS, or Linux**, please see [INSTALL.md](./INSTALL.md).

1. **Environment Variables**: Create a `.env` file in `src-tauri` with:

   ```env
   ANTHROPIC_API_KEY=your_key
   GOOGLE_API_KEY=your_key
   OPENAI_API_KEY=your_key
   ```
2. **Setup**: Run `bun install` and `bun start`.
3. **OS Compatibility**: Fully optimized for Windows 10/11 using simulated keyboard input.
