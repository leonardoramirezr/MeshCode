mod blend;
mod menu;
mod recent;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(workspace::WatcherState::default())
        .setup(|app| {
            // Built here rather than with `Builder::menu`, which runs before app paths are available.
            menu::refresh(app.handle());
            Ok(())
        })
        .on_menu_event(menu::handle_event)
        .invoke_handler(tauri::generate_handler![
            workspace::open_folder,
            workspace::close_folder,
            workspace::read_dir,
            recent::recent_folders,
            recent::remove_recent_folder,
            recent::clear_recent_folders,
            blend::load_blend,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
