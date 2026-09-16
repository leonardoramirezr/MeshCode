//! The Anthropic API key the chat agent authenticates with, stored in the system keychain.

use keyring::Entry;
use serde::Serialize;

const SERVICE: &str = "com.leonardo.meshcode";
const ACCOUNT: &str = "anthropic-api-key";
const ENV_VAR: &str = "ANTHROPIC_API_KEY";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    /// Where the key comes from: `keychain`, `env`, or `None` when there is no key.
    source: Option<&'static str>,
    /// The last characters of the key, to tell keys apart without showing them.
    hint: Option<String>,
}

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("No se pudo acceder al llavero: {e}"))
}

/// The API key and its source. A key saved in the app wins over the environment variable.
pub fn api_key() -> Result<Option<(String, &'static str)>, String> {
    match entry()?.get_password() {
        Ok(key) => return Ok(Some((key, "keychain"))),
        Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(format!("No se pudo leer la API key del llavero: {e}")),
    }
    Ok(std::env::var(ENV_VAR)
        .ok()
        .filter(|key| !key.trim().is_empty())
        .map(|key| (key, "env")))
}

fn status() -> Result<AuthStatus, String> {
    Ok(match api_key()? {
        Some((key, source)) => AuthStatus {
            source: Some(source),
            hint: Some(format!(
                "…{}",
                key.get(key.len().saturating_sub(4)..).unwrap_or("")
            )),
        },
        None => AuthStatus {
            source: None,
            hint: None,
        },
    })
}

// Keychain access can block on a system prompt, so these commands stay off the main thread.

#[tauri::command]
pub async fn auth_status() -> Result<AuthStatus, String> {
    status()
}

#[tauri::command]
pub async fn save_api_key(key: String) -> Result<AuthStatus, String> {
    let key = key.trim();
    if !key.starts_with("sk-ant-") {
        return Err("La API key debe empezar por «sk-ant-».".into());
    }
    entry()?
        .set_password(key)
        .map_err(|e| format!("No se pudo guardar la API key: {e}"))?;
    status()
}

#[tauri::command]
pub async fn remove_api_key() -> Result<AuthStatus, String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => status(),
        Err(e) => Err(format!("No se pudo borrar la API key: {e}")),
    }
}
