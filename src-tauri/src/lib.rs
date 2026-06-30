mod ai;
mod character;
mod commands;
mod state;
mod storage;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("failed to get app data dir");
            let state = state::AppState::new(app_data_dir);
            app.manage(state);
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Some(s) = app_handle.try_state::<state::AppState>() {
                    s.restore_provider_configs().await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::generate,
            commands::list_providers,
            commands::has_api_key,
            commands::set_api_key,
            commands::delete_api_key,
            commands::list_chats,
            commands::load_chat,
            commands::save_chat,
            commands::delete_chat,
            commands::list_characters,
            commands::load_character,
            commands::save_character,
            commands::delete_character,
            commands::import_character,
            commands::list_world_books,
            commands::get_character_world_books,
            commands::set_character_world_book,
            commands::load_world_book,
            commands::save_world_book_entries,
            commands::rename_world_book,
            commands::delete_world_book,
            commands::save_app_settings,
            commands::load_app_settings,
            commands::update_provider_base_url,
            commands::update_provider_name,
            commands::fetch_models,
            commands::update_provider_models,
            commands::test_connection,
            commands::register_provider,
            commands::remove_provider,
            commands::list_personas,
            commands::load_persona,
            commands::save_persona,
            commands::delete_persona,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TipsyTavern");
}