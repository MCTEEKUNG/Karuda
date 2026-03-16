use dotenvy::dotenv;
use enigo::{Enigo, Keyboard, Settings};
use tauri::{Manager, Emitter};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use serde_json::json;

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

#[tauri::command]
async fn process_ai_prompt(transcript: String, provider: Option<String>, mode: Option<String>) -> Result<String, String> {
    let provider = provider.unwrap_or_else(|| "anthropic".to_string());
    let mode = mode.unwrap_or_else(|| "dev".to_string());
    let client = reqwest::Client::new();
    
    let prompt_json = match mode.as_str() {
        "translate" => json!({
            "iam": "Garuda, your personal language companion.",
            "goal": "I'm here to help our conversation flow naturally by translating and making things clear in English.",
            "how": [
                "I'll listen to the heart of what you're saying and express it naturally.",
                "I'll keep things simple and easy for anyone to understand.",
                "I'll give you just one clear paragraph, no lists or extra bits.",
                "I'll only say the meaningful part of the message."
            ],
            "message": transcript,
            "style": "Friendly, clear, and natural human speech."
        }),
        "design" => json!({
            "consultant": "Garuda, your UX/UI Design Partner.",
            "mission": "I'll take your creative ideas and shape them into clear, professional design specifications that designers and developers can use.",
            "protocol": [
                "I'll interpret your vision and describe it in a refined, actionable design language.",
                "I'll focus on user experience, layout, and visual flow.",
                "I'll provide a single, elegant paragraph of design instruction.",
                "I'll use professional design terminology where it adds clarity."
            ],
            "vision": transcript,
            "output": "A professional and actionable design specification paragraph."
        }),
        _ => json!({
            "assistant": "Garuda, your developer friend.",
            "purpose": "I'm here to help you turn your thoughts into clear steps that any developer can immediately understand and follow.",
            "guideline": [
                "I'll help you find the best professional English for your ideas.",
                "I'll cut out the 'ums' and 'ahs' to keep things clean.",
                "I'll give you a single direct paragraph that gets straight to the point.",
                "I'll focus on technical accuracy while keeping it human and readable."
            ],
            "thought": transcript,
            "output": "A single, professional, and clear developer paragraph."
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();
    
    tauri::Builder::default()
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
        .invoke_handler(tauri::generate_handler![type_text, erase_text, press_enter, request_focus, process_ai_prompt])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
