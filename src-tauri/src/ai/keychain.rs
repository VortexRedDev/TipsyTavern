//! OS keychain 封装。
//! Windows Credential Manager / macOS Keychain / Linux Secret Service。
//! 密钥不入配置明文、不进备份。

use keyring::Entry;

use crate::ai::error::ProviderError;

/// keychain 中的 service 名（与 tauri.conf.json identifier 对齐）
const SERVICE: &str = "com.tipsytavern.app";

pub fn get(provider_id: &str) -> Result<Option<String>, ProviderError> {
    let entry = Entry::new(SERVICE, provider_id)
        .map_err(|e| ProviderError::Keyring(e.to_string()))?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(ProviderError::Keyring(e.to_string())),
    }
}

pub fn set(provider_id: &str, key: &str) -> Result<(), ProviderError> {
    let entry = Entry::new(SERVICE, provider_id)
        .map_err(|e| ProviderError::Keyring(e.to_string()))?;
    entry
        .set_password(key)
        .map_err(|e| ProviderError::Keyring(e.to_string()))
}

pub fn delete(provider_id: &str) -> Result<(), ProviderError> {
    let entry = Entry::new(SERVICE, provider_id)
        .map_err(|e| ProviderError::Keyring(e.to_string()))?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(ProviderError::Keyring(e.to_string())),
    }
}