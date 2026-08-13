//! 密码安全存储。
//! - macOS / iOS：系统钥匙串（Keychain）
//! - Windows：Credential Manager
//! - Linux：Secret Service（无服务时由调用方降级明文并告警）
//! - Android：无钥匙串支持，统一返回错误 → 调用方降级明文存储（config.json）

const SERVICE: &str = "com.piweb.desktop";

#[cfg(not(target_os = "android"))]
pub fn set(account: &str, password: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())?;
    entry
        .set_password(password)
        .map_err(|e| format!("keyring set failed: {e}"))
}

#[cfg(target_os = "android")]
pub fn set(_account: &str, _password: &str) -> Result<(), String> {
    Err("Android 无系统钥匙串，使用明文降级存储".into())
}

#[cfg(not(target_os = "android"))]
pub fn get(account: &str) -> Result<String, String> {
    let entry = keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())?;
    entry
        .get_password()
        .map_err(|e| format!("keyring get failed: {e}"))
}

#[cfg(target_os = "android")]
pub fn get(_account: &str) -> Result<String, String> {
    Err("Android 无系统钥匙串".into())
}

#[cfg(not(target_os = "android"))]
pub fn delete(account: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())?;
    entry
        .delete_credential()
        .map_err(|e| format!("keyring delete failed: {e}"))
}

#[cfg(target_os = "android")]
pub fn delete(_account: &str) -> Result<(), String> {
    Ok(())
}
