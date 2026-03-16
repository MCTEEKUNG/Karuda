import React, { useState, useEffect, useRef } from "react";
import { Mic, Copy, Globe, Trash2, Settings, X, Minus, Palette, Code, History } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { SpeechService } from "../services/SpeechService";
import appIcon from "../assets/app-icon.png";

const Overlay: React.FC = () => {
    const [isRecording, setIsRecording] = useState(false);
    const [rawText, setRawText] = useState("");
    const [refinedText, setRefinedText] = useState("");
    const [status, setStatus] = useState("Idle");
    const [aiProvider, setAiProvider] = useState<string>(() => localStorage.getItem("aiProvider") || "anthropic");
    const [showSettings, setShowSettings] = useState(false);
    const [isReadyToType, setIsReadyToType] = useState(false);
    const [appMode, setAppMode] = useState<"dev" | "translate" | "design">(() => (localStorage.getItem("appMode") as any) || "dev");
    const [showHistory, setShowHistory] = useState(false);

    const [history, setHistory] = useState<{raw: string, refined: string, timestamp: number}[]>(() => {
        const saved = localStorage.getItem("history");
        return saved ? JSON.parse(saved).slice(0, 20) : [];
    });
    const [toast, setToast] = useState<{message: string, type: 'success' | 'info'} | null>(null);

    const speechServiceRef = useRef<SpeechService | null>(null);
    const isRecordingRef = useRef(false);
    const rawTextRef = useRef("");
    const lastTypedCountRef = useRef(0);
    const aiProviderRef = useRef(aiProvider);

    const handleProviderChange = (provider: string) => {
        setAiProvider(provider);
        aiProviderRef.current = provider;
        localStorage.setItem("aiProvider", provider);
        setShowSettings(false);
    };

    const handleModeChange = (mode: "dev" | "translate" | "design") => {
        setAppMode(mode);
        localStorage.setItem("appMode", mode);
    };

    useEffect(() => {
        speechServiceRef.current = new SpeechService(
            (text) => {
                setRawText(text);
                rawTextRef.current = text;

                // Live typing logic - only type if recording and not cancelled
                if (isRecordingRef.current) {
                    const newChars = text.slice(lastTypedCountRef.current);
                    if (newChars.length > 0) {
                        invoke("type_text", { text: newChars });
                        lastTypedCountRef.current = text.length;
                    }
                }
            },
            (wasCancelled) => {
                setIsRecording(false);
                isRecordingRef.current = false;
                if (wasCancelled) {
                    setStatus("Idle");
                    setRawText("");
                    rawTextRef.current = "";
                    setRefinedText("");
                    lastTypedCountRef.current = 0;
                }
            },
            (finalText) => {
                // Auto-stop triggered by VAD
                stopRecording(finalText);
            }
        );

        // Listen for global shortcut trigger
        const unlistenStart = listen("start-recording", () => {
            if (!isRecordingRef.current) {
                startRecording();
            }
        });

        const unlistenToggle = listen("toggle-recording", () => {
            if (!isRecordingRef.current) {
                startRecording();
            } else {
                stopRecording(rawTextRef.current);
            }
        });

        const unlistenCancel = listen("cancel-recording", () => {
            cancelRecording();
        });

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Enter" && !e.shiftKey) {
                // We use a ref-like check or functional update if needed, 
                // but since this is inside useEffect with [] it won't see latest state.
                // However, we can use a ref for refinedText or just handle it in the UI buttons.
                // For simplicity, I'll add the listener to the window in a separate useEffect or 
                // just rely on the UI buttons for now, OR use a ref for the ready state.
            }
            if (e.key === "Escape") {
                const win = getCurrentWebviewWindow();
                win.hide();
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            unlistenStart.then(f => f());
            unlistenToggle.then(f => f());
            unlistenCancel.then(f => f());
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    // Effect to handle Enter confirmation when text is ready
    useEffect(() => {
        const handleEnter = (e: KeyboardEvent) => {
            if (e.key === "Enter" && !e.shiftKey && isReadyToType && refinedText) {
                e.preventDefault(); // Prevent accidental newline if textarea is focused
                handleConfirm();
            }
        };
        window.addEventListener("keydown", handleEnter, true); // Use capture to intercept before textarea
        return () => window.removeEventListener("keydown", handleEnter, true);
    }, [isReadyToType, refinedText]);

    const cancelRecording = () => {
        speechServiceRef.current?.stop();
        setIsRecording(false);
        isRecordingRef.current = false;
        setStatus("Idle");
        setRawText("");
        rawTextRef.current = "";
        setRefinedText("");
        lastTypedCountRef.current = 0;
    };

    const startRecording = () => {
        setRawText("");
        rawTextRef.current = "";
        setRefinedText("");
        setIsRecording(true);
        isRecordingRef.current = true;
        setIsReadyToType(false);
        lastTypedCountRef.current = 0;
        setStatus("Listening...");
        speechServiceRef.current?.start();
    };

    const stopRecording = async (transcriptOverride?: string) => {
        speechServiceRef.current?.stop();
        setIsRecording(false);
        isRecordingRef.current = false;
        setStatus("Processing...");
        
        const textToProcess = transcriptOverride !== undefined ? transcriptOverride : rawTextRef.current;
        if (!textToProcess || textToProcess.trim().length === 0) {
            setStatus("Idle");
            return;
        }

        try {
            const refined = await invoke<string>("process_ai_prompt", { 
                transcript: textToProcess,
                provider: aiProviderRef.current,
                mode: appMode
            });
            setRefinedText(refined);
            setIsReadyToType(true);
            setStatus("Ready to Type");
            // AI is ready, now we take focus to allow user review
            await invoke("request_focus");
        } catch (error) {
            console.error(error);
            setRefinedText(`Error: ${error}`);
            setStatus("Error");
            setTimeout(() => setStatus("Idle"), 2000);
        }
    };

    const handleConfirm = async () => {
        if (!refinedText) return;
        
        setStatus("Typing...");
        try {
            // How many chars did we type in "Raw" mode?
            const rawLength = lastTypedCountRef.current;
            
            const window = getCurrentWebviewWindow();
            await window.hide(); 
            
            // Small delay to ensure focus shift back to the original app
            setTimeout(async () => {
                // 1. Erase the raw text
                if (rawLength > 0) {
                    await invoke("erase_text", { count: rawLength });
                }
                // 2. Type the refined text
                await invoke("type_text", { text: refinedText });
                
                // 3. Automatic Submission (Single Prompt)
                await invoke("press_enter");
                
                // 4. Save to History
                const newHistory = [{
                    raw: rawTextRef.current,
                    refined: refinedText,
                    timestamp: Date.now()
                }, ...history].slice(0, 20);
                setHistory(newHistory);
                localStorage.setItem("history", JSON.stringify(newHistory));

                setStatus("Done");
                setTimeout(() => {
                    setStatus("Idle");
                    setIsReadyToType(false);
                    setRefinedText("");
                    setRawText("");
                    lastTypedCountRef.current = 0;
                }, 1000);
            }, 100);
        } catch (error) {
            console.error(error);
            setStatus("Error");
        }
    };

    const toggleRecording = () => {
        if (!isRecording) {
            startRecording();
        } else {
            stopRecording();
        }
    };

    const copyToClipboard = (text: string, label: string) => {
        if (text) {
            navigator.clipboard.writeText(text);
            showToast(`Copied ${label} to clipboard`, 'success');
        }
    };

    const showToast = (message: string, type: 'success' | 'info' = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 2500);
    };

    const clearAll = () => {
        setRawText("");
        setRefinedText("");
        setStatus("Idle");
        setIsRecording(false);
    };

    return (
        <div 
            className="overlay-root"
            style={{
                width: '100vw',
                height: '100vh',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                background: 'transparent'
            }}
        >
            <div 
                className="overlay-container glass" 
                style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: 'var(--radius-window)',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: 'clamp(10px, 2vmin, 16px)',
                    animation: 'fadeInScale 0.2s ease-out',
                    cursor: 'default'
                }}
            >
                {/* Header - Drag Handle */}
                <header 
                    onMouseDown={(e) => {
                        if ((e.target as HTMLElement).closest('button')) return;
                        const windowTitleBar = getCurrentWebviewWindow();
                        windowTitleBar.startDragging();
                    }}
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 'clamp(10px, 2.5vh, 20px)',
                        cursor: 'grab'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', pointerEvents: 'none' }}>
                        <img 
                            src={appIcon} 
                            alt="Karuda Icon" 
                            style={{ 
                                width: '24px', 
                                height: '24px', 
                                borderRadius: '4px',
                                objectFit: 'contain'
                            }} 
                        />
                        <span style={{ fontWeight: 600, fontSize: '14px', letterSpacing: '0.2px' }}>Garuda</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {status !== "Idle" && (
                            <div className="status-pill" style={{ 
                                background: status === "Listening..." ? 'rgba(255, 82, 82, 0.1)' : 'rgba(79, 195, 247, 0.1)',
                                color: status === "Listening..." ? 'var(--danger)' : 'var(--accent-blue)',
                                padding: '2px 8px',
                                borderRadius: '20px',
                                fontSize: '11px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                            }}>
                                {status === "Listening..." && <div className="pulse-dot"></div>}
                                {status}
                            </div>
                        )}
                        <button 
                            className="icon-btn tool-btn"
                            onMouseDown={async (e) => {
                                e.stopPropagation();
                                console.log("Minimize button clicked");
                                const window = getCurrentWebviewWindow();
                                try {
                                    await window.minimize();
                                } catch (err) {
                                    console.error("Minimize failed:", err);
                                }
                            }}
                        >
                            <Minus size={18} />
                        </button>
                        <button 
                            className="icon-btn close-btn"
                            onMouseDown={async (e) => {
                                e.stopPropagation();
                                const window = getCurrentWebviewWindow();
                                await window.hide();
                            }}
                        >
                            <X size={18} />
                        </button>
                    </div>
                </header>

                {/* Mic Section */}
                <div 
                    className="mic-section" 
                    style={{ 
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: 'clamp(8px, 2vh, 16px)'
                    }}
                >
                    {!isRecording && !rawText && !refinedText && status === "Idle" && (
                        <div className="quick-start-guide" style={{
                            textAlign: 'center',
                            marginBottom: '10px',
                            animation: 'fadeIn 0.5s ease-in'
                        }}>
                            <div style={{ fontSize: '11px', color: 'var(--accent-blue)', textTransform: 'uppercase', marginBottom: '8px', opacity: 0.8 }}>Quick Start</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', color: 'white' }}>Ctrl + Space</span>
                                    <span>Toggle Refined Flow</span>
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', color: 'white' }}>Ctrl + Shift + Space</span>
                                    <span>Quick Raw Mode</span>
                                </div>
                            </div>
                        </div>
                    )}
                    <div 
                        className={`mic-ring ${isRecording ? 'active' : ''}`} 
                        onClick={(e) => {
                                e.stopPropagation();
                                toggleRecording();
                        }}
                        style={{
                            width: 'clamp(60px, 10vmin, 80px)',
                            height: 'clamp(60px, 10vmin, 80px)',
                            borderRadius: '50%',
                            background: isRecording ? 'var(--danger)' : 'rgba(255, 255, 255, 0.05)',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            cursor: 'pointer',
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                            boxShadow: isRecording ? '0 0 20px rgba(255, 82, 82, 0.4)' : 'none'
                        }}
                    >
                        <Mic size={32} color={isRecording ? 'white' : 'var(--text-secondary)'} />
                    </div>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                        {isRecording ? 'Tap to stop' : 'Tap to start speaking'}
                    </span>
                </div>

                {/* Content Panels */}
                <div 
                    className="panels-container" 
                    style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(6px, 1vh, 8px)', marginBottom: 'clamp(8px, 2vh, 16px)' }}
                >
                    <div className="panel raw-panel" style={{ 
                        background: 'var(--bg-panel-light)', 
                        borderRadius: 'var(--radius-panel)',
                        padding: '10px',
                        position: 'relative'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <div style={{ fontSize: '9px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Raw Transcript</div>
                            {rawText && (
                                <button 
                                    onClick={(e) => { e.stopPropagation(); copyToClipboard(rawText, 'transcript'); }}
                                    className="icon-btn"
                                    style={{ padding: '2px', opacity: 0.6 }}
                                    title="Copy Transcript"
                                >
                                    <Copy size={12} />
                                </button>
                            )}
                        </div>
                        <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.7)', fontStyle: 'italic', minHeight: '28px', maxHeight: 'clamp(40px, 8vh, 60px)', overflowY: 'auto' }}>
                            {rawText || "Transcription will appear here..."}
                        </div>
                    </div>

                    <div className="panel refined-panel" style={{ 
                        background: 'var(--bg-panel-dark)', 
                        borderRadius: 'var(--radius-panel)',
                        padding: '12px',
                        border: isReadyToType ? '1px solid var(--accent-blue)' : '1px solid rgba(79, 195, 247, 0.1)',
                        boxShadow: isReadyToType ? '0 0 10px rgba(79, 195, 247, 0.2)' : 'none',
                        transition: 'all 0.3s ease'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <div style={{ fontSize: '9px', color: 'var(--accent-blue)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>AI Refined Output</div>
                            {isReadyToType && (
                                <div style={{ fontSize: '9px', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px' }}>
                                    Press Enter to Type
                                </div>
                            )}
                        </div>
                        <textarea 
                            value={refinedText}
                            onChange={(e) => setRefinedText(e.target.value)}
                            disabled={!isReadyToType && status !== "Error"}
                            style={{ 
                                width: '100%',
                                background: 'transparent',
                                border: 'none',
                                color: 'white',
                                fontSize: '15px', 
                                fontWeight: 400, 
                                lineHeight: '1.4', 
                                minHeight: 'clamp(36px, 6vh, 50px)',
                                maxHeight: 'clamp(70px, 14vh, 120px)',
                                overflowY: 'auto',
                                resize: 'none',
                                outline: 'none',
                                padding: 0,
                                fontFamily: 'inherit'
                            }}
                            placeholder="Refined context will appear here..."
                        />
                        
                        {isReadyToType && (
                            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                                <button 
                                    onClick={handleConfirm}
                                    style={{
                                        flex: 2,
                                        background: 'var(--accent-blue)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '8px',
                                        fontSize: '13px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        transition: 'opacity 0.2s'
                                    }}
                                    onMouseOver={(e) => (e.currentTarget.style.opacity = '0.9')}
                                    onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
                                >
                                    Confirm & Type
                                </button>
                                <button 
                                    onClick={() => {
                                        setIsReadyToType(false);
                                        setStatus("Idle");
                                    }}
                                    style={{
                                        flex: 1,
                                        background: 'rgba(255, 255, 255, 0.05)',
                                        color: 'var(--text-secondary)',
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '8px',
                                        fontSize: '13px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Toolbar */}
                <footer style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    paddingTop: '8px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.05)'
                }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                        <button onClick={(e) => { e.stopPropagation(); copyToClipboard(refinedText, 'refined output'); }} className="icon-btn tool-btn" title="Copy Output"><Copy size={18} /></button>
                        
                        {/* Mode Selector */}
                        <div className="mode-selector" style={{ display: 'flex', gap: '4px', marginLeft: '8px', paddingLeft: '8px', borderLeft: '1px solid rgba(255,255,255,0.05)' }}>
                            <button 
                                onClick={(e) => { e.stopPropagation(); handleModeChange("dev"); }} 
                                className={`icon-btn tool-btn ${appMode === "dev" ? 'active' : ''}`}
                                style={{ 
                                    color: appMode === "dev" ? 'var(--accent-blue)' : 'var(--text-secondary)',
                                    background: appMode === "dev" ? 'rgba(79, 195, 247, 0.1)' : 'transparent'
                                }}
                                title="Developer Mode"
                            >
                                <Code size={18} />
                            </button>
                            <button 
                                onClick={(e) => { e.stopPropagation(); handleModeChange("translate"); }} 
                                className={`icon-btn tool-btn ${appMode === "translate" ? 'active' : ''}`}
                                style={{ 
                                    color: appMode === "translate" ? 'var(--accent-blue)' : 'var(--text-secondary)',
                                    background: appMode === "translate" ? 'rgba(79, 195, 247, 0.1)' : 'transparent'
                                }}
                                title="Translator Mode"
                            >
                                <Globe size={18} />
                            </button>
                            <button 
                                onClick={(e) => { e.stopPropagation(); handleModeChange("design"); }} 
                                className={`icon-btn tool-btn ${appMode === "design" ? 'active' : ''}`}
                                style={{ 
                                    color: appMode === "design" ? 'var(--accent-blue)' : 'var(--text-secondary)',
                                    background: appMode === "design" ? 'rgba(79, 195, 247, 0.1)' : 'transparent'
                                }}
                                title="UX/UI Design Consultant"
                            >
                                <Palette size={18} />
                            </button>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '4px', position: 'relative' }}>
                        <button onClick={(e) => { e.stopPropagation(); setShowHistory(!showHistory); }} className={`icon-btn tool-btn ${showHistory ? 'active' : ''}`} title="History"><History size={18} /></button>
                        <button onClick={(e) => { e.stopPropagation(); clearAll(); }} className="icon-btn tool-btn" title="Clear"><Trash2 size={18} /></button>
                        <button onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); }} className="icon-btn tool-btn" title="Settings"><Settings size={18} /></button>
                        
                        {showHistory && (
                            <div style={{
                                position: 'absolute',
                                bottom: '100%',
                                right: '0',
                                marginBottom: '8px',
                                background: 'rgba(20, 20, 28, 0.98)',
                                backdropFilter: 'blur(30px)',
                                WebkitBackdropFilter: 'blur(30px)',
                                border: '1px solid rgba(255, 255, 255, 0.12)',
                                borderRadius: '12px',
                                padding: '12px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px',
                                zIndex: 20,
                                width: 'min(300px, 80vw)',
                                maxHeight: '350px',
                                overflowY: 'auto',
                                boxShadow: '0 8px 32px rgba(0,0,0,0.8)'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                    <div style={{ fontSize: '10px', color: 'var(--accent-blue)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Recent History</div>
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setHistory([]);
                                            localStorage.removeItem("history");
                                        }}
                                        style={{ background: 'transparent', border: 'none', color: 'var(--danger)', fontSize: '10px', cursor: 'pointer', opacity: 0.7 }}
                                    >
                                        Clear All
                                    </button>
                                </div>
                                {history.length === 0 ? (
                                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '12px', opacity: 0.6 }}>No history yet</div>
                                ) : (
                                    history.map((item, i) => (
                                        <div 
                                            key={item.timestamp} 
                                            onClick={() => {
                                                setRefinedText(item.refined);
                                                setIsReadyToType(true);
                                                setShowHistory(false);
                                                setStatus("From History");
                                            }}
                                            style={{
                                                padding: '8px',
                                                borderRadius: '6px',
                                                background: 'rgba(255,255,255,0.03)',
                                                cursor: 'pointer',
                                                border: '1px solid rgba(255,255,255,0.05)',
                                                transition: 'all 0.2s'
                                            }}
                                            onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                                            onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                                        >
                                            <div style={{ fontSize: '12px', color: 'white', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.3 }}>{item.refined}</div>
                                            <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
                                                <span>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                <span style={{ fontStyle: 'italic', opacity: 0.5 }}>{item.raw.slice(0, 15)}...</span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                        
                        {showSettings && (
                            <div style={{
                                position: 'absolute',
                                bottom: '100%',
                                right: '0',
                                marginBottom: '8px',
                                background: 'rgba(20, 20, 28, 0.97)',
                                backdropFilter: 'blur(20px)',
                                WebkitBackdropFilter: 'blur(20px)',
                                border: '1px solid rgba(255, 255, 255, 0.12)',
                                borderRadius: '8px',
                                padding: '8px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '4px',
                                zIndex: 10,
                                minWidth: '150px',
                                boxShadow: '0 8px 24px rgba(0,0,0,0.6)'
                            }}>
                                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', padding: '0 4px 4px', textTransform: 'uppercase' }}>AI Provider</div>
                                <button 
                                    style={{
                                        background: aiProvider === 'anthropic' ? 'rgba(79, 195, 247, 0.2)' : 'transparent',
                                        color: aiProvider === 'anthropic' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                                        border: 'none',
                                        padding: '6px 12px',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        fontSize: '12px',
                                        transition: 'all 0.2s'
                                    }}
                                    onClick={(e) => { e.stopPropagation(); handleProviderChange('anthropic'); }}
                                >
                                    Anthropic (Claude)
                                </button>
                                <button 
                                    style={{
                                        background: aiProvider === 'google' ? 'rgba(79, 195, 247, 0.2)' : 'transparent',
                                        color: aiProvider === 'google' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                                        border: 'none',
                                        padding: '6px 12px',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        fontSize: '12px',
                                        transition: 'all 0.2s'
                                    }}
                                    onClick={(e) => { e.stopPropagation(); handleProviderChange('google'); }}
                                >
                                    Google (Gemini)
                                </button>
                                <button 
                                    style={{
                                        background: aiProvider === 'openai' ? 'rgba(79, 195, 247, 0.2)' : 'transparent',
                                        color: aiProvider === 'openai' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                                        border: 'none',
                                        padding: '6px 12px',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        fontSize: '12px',
                                        transition: 'all 0.2s'
                                    }}
                                    onClick={(e) => { e.stopPropagation(); handleProviderChange('openai'); }}
                                >
                                    OpenAI (ChatGPT)
                                </button>
                            </div>
                        )}
                    </div>
                </footer>

                {/* Toast Notification */}
                {toast && (
                    <div style={{
                        position: 'absolute',
                        bottom: '70px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: 'rgba(0, 0, 0, 0.85)',
                        backdropFilter: 'blur(10px)',
                        color: 'white',
                        padding: '8px 16px',
                        borderRadius: '30px',
                        fontSize: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                        animation: 'slideUpFade 0.3s ease-out',
                        zIndex: 100
                    }}>
                        <div style={{ 
                            width: '6px', 
                            height: '6px', 
                            borderRadius: '50%', 
                            background: 'var(--accent-blue)' 
                        }} />
                        {toast.message}
                    </div>
                )}

            <style>{`
                @keyframes fadeInScale {
                    from { opacity: 0; transform: scale(0.95); }
                    to { opacity: 1; transform: scale(1); }
                }
                @keyframes slideUpFade {
                    from { opacity: 0; transform: translate(-50%, 10px); }
                    to { opacity: 1; transform: translate(-50%, 0); }
                }
                .pulse-dot {
                    width: 6px;
                    height: 6px;
                    background: var(--danger);
                    border-radius: 50%;
                    animation: pulse 1.5s infinite;
                }
                @keyframes pulse {
                    0% { transform: scale(0.8); opacity: 0.5; }
                    50% { transform: scale(1.2); opacity: 1; }
                    100% { transform: scale(0.8); opacity: 0.5; }
                }
                .icon-btn {
                    background: transparent;
                    border: none;
                    color: var(--text-secondary);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: clamp(5px, 1vmin, 8px);
                    border-radius: 8px;
                    transition: all 0.2s;
                }
                .icon-btn:hover {
                    background: rgba(255, 255, 255, 0.05);
                    color: white;
                }
                .tool-btn:hover {
                    background: rgba(79, 195, 247, 0.1);
                    color: var(--accent-blue);
                }
                .close-btn:hover {
                    background: rgba(255, 82, 82, 0.1);
                    color: var(--danger);
                }

                /* ── Responsive: compact height ── */
                @media (max-height: 480px) {
                    .quick-start-guide { display: none !important; }
                    .mic-section { flex: 0 0 auto !important; padding: 8px 0 !important; }
                }

                /* ── Responsive: narrow width ── */
                @media (max-width: 320px) {
                    .mode-selector { display: none !important; }
                }

                /* ── Responsive: very narrow ── */
                @media (max-width: 260px) {
                    .status-pill { display: none !important; }
                }
            `}</style>
        </div>
    </div>
    );
};

export default Overlay;
