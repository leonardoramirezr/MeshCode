mod agent;
mod agent_view;
mod auth;
mod blend;
mod claude_code;
mod executable;
mod git;
mod menu;
mod recent;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(workspace::WatcherState::default())
        .manage(agent::AgentState::default())
        .manage(agent_view::AgentViewState::default())
        .manage(claude_code::ClaudeCodeState::default())
        .setup(|app| {
            // Built here rather than with `Builder::menu`, which runs before app paths are available.
            menu::refresh(app.handle());
            agent_view::watch(app.handle());
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
            git::git_status,
            git::git_init,
            git::git_stage,
            git::git_unstage,
            git::git_discard,
            git::git_commit,
            git::git_undo_commit,
            git::git_branches,
            git::git_checkout,
            git::git_create_branch,
            git::git_push,
            git::git_pull,
            agent::agent_start,
            agent::agent_send,
            agent::agent_stop,
            claude_code::claude_code_start,
            claude_code::claude_code_write,
            claude_code::claude_code_resize,
            claude_code::claude_code_stop,
            auth::auth_status,
            auth::save_api_key,
            auth::remove_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
