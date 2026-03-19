import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type UnlistenFn = () => void;

export class SpeechService {
    private onResult: (text: string) => void;
    private onEnd: (cancelled: boolean) => void;
    private onAutoStop: (text: string) => void;

    private isActive: boolean = false;
    private transcript: string = "";

    private unlistenResult: UnlistenFn | null = null;
    private unlistenError: UnlistenFn | null = null;
    private unlistenStarted: UnlistenFn | null = null;

    private silenceTimeout: any = null;
    private maxRecordingTimeout: any = null;

    private firstSpeechTime: number = 0;
    private lastSpeechTime: number = 0;

    private MIN_SPEECH_LENGTH = 1200;
    private MAX_RECORDING_LENGTH = 120000;

    constructor(
        onResult: (text: string) => void,
        onEnd: (cancelled: boolean) => void,
        onAutoStop: (text: string) => void,
        _lang: string = "th-TH"   // kept for API compatibility, Whisper detects automatically
    ) {
        this.onResult = onResult;
        this.onEnd = onEnd;
        this.onAutoStop = onAutoStop;
    }

    // ──────────────────────────────────────────────
    // Lifecycle
    // ──────────────────────────────────────────────

    async start() {
        if (this.isActive) return;
        this.isActive = true;

        this.transcript = "";
        this.firstSpeechTime = 0;
        this.lastSpeechTime = 0;

        if (this.silenceTimeout) clearTimeout(this.silenceTimeout);
        if (this.maxRecordingTimeout) clearTimeout(this.maxRecordingTimeout);

        // Set up Tauri event listeners
        this.unlistenStarted = await listen<void>("speech-started", () => {
            // Recording is live — start max-duration timer
            this.maxRecordingTimeout = setTimeout(() => {
                this.handleAutoStop(this.transcript);
            }, this.MAX_RECORDING_LENGTH);
        });

        this.unlistenResult = await listen<string>("speech-result", (event) => {
            if (!this.isActive) return;

            const text = (event.payload as unknown as string) ?? "";
            const cleaned = this.cleanTranscript(text);
            this.transcript = cleaned;

            if (cleaned.length > 0) {
                if (this.firstSpeechTime === 0) this.firstSpeechTime = Date.now();
                this.lastSpeechTime = Date.now();
            }

            this.onResult(cleaned);

            // Once Whisper returns a result the recording stops on its own,
            // so we treat it as an auto-stop.
            this.isActive = false;
            this._cleanup();

            const speechDuration = this.lastSpeechTime - this.firstSpeechTime;
            if (this.firstSpeechTime === 0 || speechDuration < this.MIN_SPEECH_LENGTH) {
                this.onEnd(true); // too short → cancelled
            } else {
                this.onAutoStop(cleaned);
            }
        });

        this.unlistenError = await listen<string>("speech-error", (event) => {
            if (!this.isActive) return;
            const msg = (event.payload as unknown as string) ?? "Unknown error";
            console.error("[SpeechService] Rust error:", msg);
            this.isActive = false;
            this._cleanup();
            this.onEnd(true);
        });

        try {
            await invoke("start_recording");
        } catch (err) {
            console.error("[SpeechService] start_recording failed:", err);
            this.isActive = false;
            this._cleanup();
            this.onEnd(true);
        }
    }

    stop() {
        if (!this.isActive) return;
        this.isActive = false;
        this._cleanup();
        invoke("stop_recording").catch(console.error);
        // speech-result event will fire after Whisper responds;
        // onEnd will be called from there. If user manually stops and
        // no result arrives within 10s we fall back:
        setTimeout(() => {
            // If transcript came back already, the listener already called onEnd.
            // This is just a safety net.
        }, 10000);
    }

    cancel() {
        this.isActive = false;
        this._cleanup();
        invoke("stop_recording").catch(console.error);
        this.onEnd(true);
    }

    // ──────────────────────────────────────────────
    // Internals
    // ──────────────────────────────────────────────

    private _cleanup() {
        if (this.silenceTimeout) { clearTimeout(this.silenceTimeout); this.silenceTimeout = null; }
        if (this.maxRecordingTimeout) { clearTimeout(this.maxRecordingTimeout); this.maxRecordingTimeout = null; }
        if (this.unlistenResult) { this.unlistenResult(); this.unlistenResult = null; }
        if (this.unlistenError) { this.unlistenError(); this.unlistenError = null; }
        if (this.unlistenStarted) { this.unlistenStarted(); this.unlistenStarted = null; }
    }

    private handleAutoStop(finalText: string) {
        if (!this.isActive) return;
        this.stop();
        const speechDuration = this.lastSpeechTime - this.firstSpeechTime;
        if (this.firstSpeechTime === 0 || speechDuration < this.MIN_SPEECH_LENGTH) {
            this.onEnd(true);
        } else {
            this.onAutoStop(finalText);
        }
    }

    private readonly TECH_DICTIONARY: Record<string, string> = {
        "ฟังก์ชัน": "function",
        "คอนโซล": "console",
        "ล็อก": "log",
        "รีเทิร์น": "return",
        "คลาส": "class",
        "อินเทอร์เฟซ": "interface",
        "ไทป์": "type",
        "ตัวแปร": "variable",
        "แอเรย์": "array",
        "อาเรย์": "array",
        "อ็อบเจกต์": "object",
        "ออปเจค": "object",
        "พร็อพเพอร์ตี้": "property",
        "พารามิเตอร์": "parameter",
        "อากิวเมนต์": "argument",
        "สตริง": "string",
        "นัมเบอร์": "number",
        "บูลีน": "boolean",
        "ลูป": "loop",
        "อีฟ": "if",
        "เอลส์": "else",
        "สวิตช์": "switch",
        "อิมพอร์ต": "import",
        "เอกซ์พอร์ต": "export",
        "ดีฟอลต์": "default",
        "เอซิงค์": "async",
        "อะซิงก์": "async",
        "อะเวต": "await",
        "พรอมิส": "promise",
        "แคช": "catch",
        "เออร์เรอร์": "error",
        "อัปเดต": "update",
        "ดีลีต": "delete",
        "รีโมฟ": "remove",
        "ครีเอต": "create",
        "อินเสิร์ต": "insert",
        "ซีเล็กต์": "select",
        "เซอร์วิส": "service",
        "คอมโพเนนต์": "component",
        "สเตท": "state",
        "พร็อพส์": "props",
        "รีแอค": "React",
        "ฮุก": "hook",
        "สไตล์": "style",
        "มาร์จิน": "margin",
        "แพดดิง": "padding",
        "คัลเลอร์": "color",
        "แบ็กกราวด์": "background",
        "บอร์เดอร์": "border",
        "เรเดียส": "radius",
        "เลย์เอาต์": "layout",
        "เฟล็กซ์": "flex",
        "กริด": "grid",
        "เซิร์ฟเวอร์": "server",
        "ไคลเอนต์": "client",
        "แอปพลิเคชัน": "application",
        "ยูไอ": "UI",
        "เอพีไอ": "API",
        "ดาต้าเบส": "database",
        "เทเบิล": "table",
        "คอลัมน์": "column",
        "โรว์": "row",
        "ควีรี": "query",
        "เรสเควสต์": "request",
        "เรสพอนส์": "response",
        "เฮดเดอร์": "header",
        "บอดี้": "body",
        "โทเคน": "token",
        "พาสเวิร์ด": "password",
        "อีเมล": "email",
        "ยูสเซอร์": "user",
        "ไอดี": "ID",
        "สเปซ": "space",
        "เอนเทอร์": "enter",
        "แท็บ": "tab"
    };

    private replaceLoanwords(text: string): string {
        let processedText = text;
        for (const [thaiWord, englishWord] of Object.entries(this.TECH_DICTIONARY)) {
            const regex = new RegExp(thaiWord, 'g');
            processedText = processedText.replace(regex, ` ${englishWord} `);
        }
        return processedText;
    }

    private cleanTranscript(text: string): string {
        let cleaned = text
            .replace(/\.{2,}/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return this.replaceLoanwords(cleaned).replace(/\s+/g, ' ').trim();
    }
}
