export class SpeechService {
    private recognition: any;
    private onResult: (text: string) => void;
    private onEnd: (cancelled: boolean) => void;
    private onAutoStop: (text: string) => void;

    private isActive: boolean = false;
    private fullTranscript: string = "";
    private lastSessionTranscript: string = "";
    
    private firstSpeechTime: number = 0;
    private lastSpeechTime: number = 0;

    private silenceTimeout: any = null;
    private maxRecordingTimeout: any = null;

    private SILENCE_THRESHOLD = 2500;
    private MIN_SPEECH_LENGTH = 1200;
    private MAX_RECORDING_LENGTH = 120000;

    constructor(
        onResult: (text: string) => void, 
        onEnd: (cancelled: boolean) => void, 
        onAutoStop: (text: string) => void,
        lang: string = "th-TH"
    ) {
        this.onResult = onResult;
        this.onEnd = onEnd;
        this.onAutoStop = onAutoStop;

        // @ts-ignore
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = lang; // Set language for better accuracy

            this.recognition.onresult = (event: any) => {
                if (!this.isActive) return;

                let currentSession = "";
                for (let i = 0; i < event.results.length; i++) {
                    currentSession += event.results[i][0].transcript;
                }
                this.lastSessionTranscript = currentSession;

                const fullText = this.fullTranscript + " " + this.lastSessionTranscript;
                const cleaned = this.cleanTranscript(fullText);

                if (cleaned.length > 0) {
                    if (this.firstSpeechTime === 0) {
                        this.firstSpeechTime = Date.now();
                    }
                    this.lastSpeechTime = Date.now();
                }

                this.onResult(cleaned);
                this.resetSilenceTimeout(cleaned);
            };

            this.recognition.onstart = () => {
                this.isActive = true;
            };

            this.recognition.onend = () => {
                if (this.isActive) {
                    // Browser stopped it prematurely (e.g., standard short silence pause).
                    // We preserve the transcript and forcefully restart it to keep listening!
                    this.fullTranscript += " " + this.lastSessionTranscript;
                    this.lastSessionTranscript = "";
                    try {
                        this.recognition.start();
                    } catch(e) {}
                } else {
                    this.onEnd(false);
                }
            };

            this.recognition.onerror = (e: any) => {
                if (e.error === 'no-speech' && this.isActive) {
                    // ignore no-speech, let silenceTimeout handle it
                }
            };
        }
    }

    private TECH_DICTIONARY: Record<string, string> = {
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
            // Using global regex to replace all occurrences
            // We pad with spaces to ensure words don't merge weirdly, but JS regex on Thai text can be simple
            const regex = new RegExp(thaiWord, 'g');
            processedText = processedText.replace(regex, ` ${englishWord} `);
        }
        return processedText;
    }

    private cleanTranscript(text: string): string {
        let cleaned = text
            .replace(/\.{2,}/g, ' ') // replace multiple dots with a space
            .replace(/\s+/g, ' ')    // collapse multiple spaces into one
            .trim();
            
        return this.replaceLoanwords(cleaned).replace(/\s+/g, ' ').trim();
    }

    private resetSilenceTimeout(currentText: string) {
        if (this.silenceTimeout) clearTimeout(this.silenceTimeout);
        
        if (this.firstSpeechTime > 0) {
            this.silenceTimeout = setTimeout(() => {
                this.handleAutoStop(currentText);
            }, this.SILENCE_THRESHOLD);
        }
    }

    private handleAutoStop(finalText: string) {
        if (!this.isActive) return;

        const actualSpeechDuration = this.lastSpeechTime - this.firstSpeechTime;
        
        this.stop(); 
        
        if (this.firstSpeechTime === 0 || actualSpeechDuration < this.MIN_SPEECH_LENGTH) {
            this.onEnd(true); // cancelled as noise
        } else {
            this.onAutoStop(finalText);
        }
    }

    start() {
        if (!this.recognition) return;
        
        this.isActive = true;
        this.fullTranscript = "";
        this.lastSessionTranscript = "";
        this.firstSpeechTime = 0;
        this.lastSpeechTime = 0;

        if (this.silenceTimeout) clearTimeout(this.silenceTimeout);
        if (this.maxRecordingTimeout) clearTimeout(this.maxRecordingTimeout);

        this.maxRecordingTimeout = setTimeout(() => {
            const currentText = this.fullTranscript + " " + this.lastSessionTranscript;
            this.handleAutoStop(this.cleanTranscript(currentText));
        }, this.MAX_RECORDING_LENGTH);

        try {
            this.recognition.start();
        } catch (e) {}
    }

    stop() {
        this.isActive = false;
        if (this.silenceTimeout) clearTimeout(this.silenceTimeout);
        if (this.maxRecordingTimeout) clearTimeout(this.maxRecordingTimeout);

        if (this.recognition) {
            try { this.recognition.stop(); } catch(e) {}
        }
    }
}
