use dotenvy::dotenv;
use enigo::{Enigo, Keyboard, Settings};
use tauri::{Manager, Emitter};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use serde_json::json;

// --- Recording State ---
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};

struct RecordingState {
    is_recording: Arc<AtomicBool>,
    stop_tx: Arc<Mutex<Option<std::sync::mpsc::Sender<()>>>>,
}

impl Default for RecordingState {
    fn default() -> Self {
        Self {
            is_recording: Arc::new(AtomicBool::new(false)),
            stop_tx: Arc::new(Mutex::new(None)),
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Existing commands
// ─────────────────────────────────────────────────────────────

#[tauri::command]
fn type_text(text: String) {
    if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
        let _ = enigo.text(&text);
    }
}

#[tauri::command]
fn erase_text(count: usize) {
    use enigo::Key;
    if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
        for _ in 0..count {
            let _ = enigo.key(Key::Backspace, enigo::Direction::Click);
        }
    }
}

#[tauri::command]
fn press_enter() {
    use enigo::Key;
    if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
        let _ = enigo.key(Key::Return, enigo::Direction::Click);
    }
}

#[tauri::command]
fn request_focus(handle: tauri::AppHandle) {
    if let Some(window) = handle.get_webview_window("main") {
        let _ = window.set_focus();
    }
}

// ─────────────────────────────────────────────────────────────
// Native Speech Recording (cpal + Whisper API)
// ─────────────────────────────────────────────────────────────

#[tauri::command]
async fn start_recording(
    state: tauri::State<'_, RecordingState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use std::sync::mpsc;

    if state.is_recording.load(Ordering::SeqCst) {
        return Err("Already recording".into());
    }
    state.is_recording.store(true, Ordering::SeqCst);

    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    {
        let mut lock = state.stop_tx.lock().unwrap();
        *lock = Some(stop_tx);
    }

    let is_recording = Arc::clone(&state.is_recording);
    let app_clone = app.clone();

    std::thread::spawn(move || {
        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                let _ = app_clone.emit("speech-error", "No input device found");
                is_recording.store(false, Ordering::SeqCst);
                return;
            }
        };

        let config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                let _ = app_clone.emit("speech-error", format!("Config error: {}", e));
                is_recording.store(false, Ordering::SeqCst);
                return;
            }
        };

        let sample_rate = config.sample_rate().0;
        let channels = config.channels() as u16;

        let samples: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
        let samples_clone = Arc::clone(&samples);

        let stream_result = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config.into(),
                move |data: &[f32], _| {
                    let mut s = samples_clone.lock().unwrap();
                    s.extend_from_slice(data);
                },
                |e| eprintln!("Stream error: {}", e),
                None,
            ),
            cpal::SampleFormat::I16 => {
                let samples_clone2 = Arc::clone(&samples);
                device.build_input_stream(
                    &config.into(),
                    move |data: &[i16], _| {
                        let mut s = samples_clone2.lock().unwrap();
                        for &sample in data {
                            s.push(sample as f32 / i16::MAX as f32);
                        }
                    },
                    |e| eprintln!("Stream error: {}", e),
                    None,
                )
            },
            cpal::SampleFormat::U16 => {
                let samples_clone3 = Arc::clone(&samples);
                device.build_input_stream(
                    &config.into(),
                    move |data: &[u16], _| {
                        let mut s = samples_clone3.lock().unwrap();
                        for &sample in data {
                            s.push((sample as f32 / u16::MAX as f32) * 2.0 - 1.0);
                        }
                    },
                    |e| eprintln!("Stream error: {}", e),
                    None,
                )
            },
            _ => {
                let _ = app_clone.emit("speech-error", "Unsupported sample format");
                is_recording.store(false, Ordering::SeqCst);
                return;
            }
        };

        let stream = match stream_result {
            Ok(s) => s,
            Err(e) => {
                let _ = app_clone.emit("speech-error", format!("Stream build error: {}", e));
                is_recording.store(false, Ordering::SeqCst);
                return;
            }
        };

        if let Err(e) = stream.play() {
            let _ = app_clone.emit("speech-error", format!("Stream play error: {}", e));
            is_recording.store(false, Ordering::SeqCst);
            return;
        }

        let _ = app_clone.emit("speech-started", ());

        // Wait for stop signal or timeout (max 120s)
        let timeout = std::time::Duration::from_secs(120);
        let _ = stop_rx.recv_timeout(timeout);

        drop(stream);
        is_recording.store(false, Ordering::SeqCst);

        // --- Write WAV to temp file ---
        let recorded_samples = samples.lock().unwrap().clone();
        if recorded_samples.is_empty() {
            let _ = app_clone.emit("speech-result", "");
            return;
        }

        let temp_path = std::env::temp_dir().join("karuda_recording.wav");
        {
            let spec = hound::WavSpec {
                channels,
                sample_rate,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            };
            let mut writer = match hound::WavWriter::create(&temp_path, spec) {
                Ok(w) => w,
                Err(e) => {
                    let _ = app_clone.emit("speech-error", format!("WAV write error: {}", e));
                    return;
                }
            };
            for sample in &recorded_samples {
                let s = (sample * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
                let _ = writer.write_sample(s);
            }
        }

        // --- Send WAV to Whisper API ---
        let api_key = match std::env::var("OPENAI_API_KEY") {
            Ok(k) => k,
            Err(_) => {
                let _ = app_clone.emit("speech-error", "OPENAI_API_KEY not set in .env");
                return;
            }
        };

        let app_for_async = app_clone.clone();
        let temp_path_clone = temp_path.clone();

        // Use a new tokio runtime for the async HTTP call from this sync thread
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();

        rt.block_on(async move {
            let wav_bytes = match tokio::fs::read(&temp_path_clone).await {
                Ok(b) => b,
                Err(e) => {
                    let _ = app_for_async.emit("speech-error", format!("File read error: {}", e));
                    return;
                }
            };

            let part = reqwest::multipart::Part::bytes(wav_bytes)
                .file_name("audio.wav")
                .mime_str("audio/wav")
                .unwrap();

            let form = reqwest::multipart::Form::new()
                .text("model", "whisper-1")
                .text("language", "th")
                .part("file", part);

            let client = reqwest::Client::new();
            let res = client
                .post("https://api.openai.com/v1/audio/transcriptions")
                .header("Authorization", format!("Bearer {}", api_key))
                .multipart(form)
                .send()
                .await;

            match res {
                Ok(r) => {
                    let body: serde_json::Value = r.json().await.unwrap_or_default();
                    let text = body["text"].as_str().unwrap_or("").to_string();
                    let _ = app_for_async.emit("speech-result", text);
                }
                Err(e) => {
                    let _ = app_for_async.emit("speech-error", format!("Whisper API error: {}", e));
                }
            }

            // Cleanup temp file
            let _ = tokio::fs::remove_file(&temp_path_clone).await;
        });
    });

    Ok(())
}

#[tauri::command]
fn stop_recording(state: tauri::State<'_, RecordingState>) -> Result<(), String> {
    if !state.is_recording.load(Ordering::SeqCst) {
        return Ok(()); // Not recording, nothing to do
    }
    let mut lock = state.stop_tx.lock().unwrap();
    if let Some(tx) = lock.take() {
        let _ = tx.send(());
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────
// AI Prompt Processing
// ─────────────────────────────────────────────────────────────

#[tauri::command]
async fn process_ai_prompt(transcript: String, provider: Option<String>, mode: Option<String>) -> Result<String, String> {
    let provider = provider.unwrap_or_else(|| "anthropic".to_string());
    let mode = mode.unwrap_or_else(|| "dev".to_string());
    let client = reqwest::Client::new();
    
    let prompt_json = match mode.as_str() {
        "translate" => json!({
            "role": "You are Garuda, a professional language companion.",
            "task": "Translate the user's spoken thoughts into natural, clear English.",
            "constraints": [
                "Output ONLY the translated text.",
                "No preamble like 'Here is the translation'.",
                "No quotation marks around the output.",
                "Keep it as a single natural paragraph.",
                "Express the heart of the message naturally."
            ],
            "input_speech": transcript
        }),
        "design" => json!({
            "role": "You are Garuda, a professional UX/UI Design Partner.",
            "task": "Transform raw creative ideas into a polished, professional design specification.",
            "constraints": [
                "Output ONLY the refined specification text.",
                "No preamble or conversational filler.",
                "No quotation marks.",
                "Focus on actionable design language (layout, UX, flow).",
                "Keep it as a single elegant paragraph."
            ],
            "input_vision": transcript
        }),
        _ => json!({
            "role": "You are Garuda, a senior developer's logic refiner.",
            "task": "Convert raw developer thoughts/speech into a clear, professional technical prompt or instruction.",
            "constraints": [
                "Output ONLY the refined technical text.",
                "No preamble (e.g., 'Sure, here is...')",
                "No quotation marks.",
                "Remove filler words (ums, ahs).",
                "Maintain technical accuracy and professional tone.",
                "Keep it as a single direct paragraph."
            ],
            "raw_thought": transcript
        }),
    };

    
    let prompt = prompt_json.to_string();

    if provider == "google" {
        let api_key = std::env::var("GOOGLE_API_KEY").map_err(|_| "GOOGLE_API_KEY is not set in .env".to_string())?;
        
        let url = format!("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key={}", api_key);
        
        let res = client.post(&url)
            .header("content-type", "application/json")
            .json(&json!({
                "contents": [{
                    "parts": [{"text": prompt}]
                }]
            }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            let err_text = res.text().await.unwrap_or_default();
            return Err(format!("Google API Error: {}", err_text));
        }

        let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        if let Some(text) = body["candidates"][0]["content"]["parts"][0]["text"].as_str() {
            return Ok(text.to_string());
        } else {
            return Err("Failed to parse Google API response".to_string());
        }
    } else if provider == "openai" {
        let api_key = std::env::var("OPENAI_API_KEY").map_err(|_| "OPENAI_API_KEY is not set in .env".to_string())?;
        
        let res = client.post("https://api.openai.com/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("content-type", "application/json")
            .json(&json!({
                "model": "gpt-4o-mini",
                "messages": [
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            let err_text = res.text().await.unwrap_or_default();
            return Err(format!("OpenAI API Error: {}", err_text));
        }

        let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        if let Some(text) = body["choices"][0]["message"]["content"].as_str() {
            return Ok(text.to_string());
        } else {
            return Err("Failed to parse OpenAI API response".to_string());
        }
    } else {
        let api_key = std::env::var("ANTHROPIC_API_KEY").map_err(|_| "ANTHROPIC_API_KEY is not set in .env".to_string())?;
        let res = client.post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&json!({
                "model": "claude-3-haiku-20240307",
                "max_tokens": 1024,
                "messages": [
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            let err_text = res.text().await.unwrap_or_default();
            return Err(format!("Anthropic API Error: {}", err_text));
        }

        let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        if let Some(text) = body["content"][0]["text"].as_str() {
            return Ok(text.to_string());
        } else {
            return Err("Failed to parse Anthropic API response".to_string());
        }
    }
}

// ─────────────────────────────────────────────────────────────
// App Entry Point
// ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();
    
    tauri::Builder::default()
        .manage(RecordingState::default())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let ctrl_space = Shortcut::new(Some(Modifiers::CONTROL), Code::Space);
                        let ctrl_shift_space = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
                        
                        if let Some(window) = app.get_webview_window("main") {
                            let visible = window.is_visible().unwrap_or(false);
                            
                            if shortcut.id() == ctrl_space.id() {
                                if !visible {
                                    let _ = window.show();
                                }
                                let _ = app.emit("toggle-recording", ());
                            } else if shortcut.id() == ctrl_shift_space.id() {
                                if !visible {
                                    let _ = window.show();
                                    let _ = app.emit("start-recording", ());
                                } else {
                                    let _ = window.hide();
                                    let _ = app.emit("cancel-recording", ());
                                }
                            }
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let ctrl_space = Shortcut::new(Some(Modifiers::CONTROL), Code::Space);
            let _ = app.global_shortcut().register(ctrl_space);
            
            let ctrl_shift_space = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
            let _ = app.global_shortcut().register(ctrl_shift_space);
            
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            type_text, erase_text, press_enter, request_focus,
            process_ai_prompt,
            start_recording, stop_recording
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
