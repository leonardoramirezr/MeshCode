//! Native application menu. Menu clicks are forwarded to the frontend as `menu` events.

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuBuilder, MenuEvent, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Emitter, Wry,
};

use crate::recent;

const RECENT_PREFIX: &str = "recent:";

#[derive(Clone, Serialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum MenuAction {
    OpenFolder,
    OpenRecent { path: String },
    ClearRecent,
    CloseFolder,
    CloseEditor,
    ShowExplorer,
    ShowChat,
    ToggleSidebar,
}

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let recents = recent::existing(app);
    let home = std::env::var("HOME").ok().filter(|home| !home.is_empty());

    let mut open_recent = SubmenuBuilder::new(app, "Abrir reciente");
    if recents.is_empty() {
        open_recent = open_recent.item(
            &MenuItemBuilder::new("Sin carpetas recientes")
                .enabled(false)
                .build(app)?,
        );
    }
    for folder in &recents {
        let label = match &home {
            Some(home) if folder.starts_with(home.as_str()) => {
                format!("~{}", &folder[home.len()..])
            }
            _ => folder.clone(),
        };
        open_recent = open_recent
            .item(&MenuItemBuilder::with_id(format!("{RECENT_PREFIX}{folder}"), label).build(app)?);
    }
    let open_recent = open_recent
        .separator()
        .item(
            &MenuItemBuilder::with_id("clear_recent", "Limpiar recientes")
                .enabled(!recents.is_empty())
                .build(app)?,
        )
        .build()?;

    let file = SubmenuBuilder::new(app, "Archivo")
        .item(
            &MenuItemBuilder::with_id("open_folder", "Abrir carpeta…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .item(&open_recent)
        .separator()
        .item(
            &MenuItemBuilder::with_id("close_editor", "Cerrar editor")
                .accelerator("CmdOrCtrl+W")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("close_folder", "Cerrar carpeta").build(app)?);
    #[cfg(not(target_os = "macos"))]
    let file = file.separator().quit();

    let edit = SubmenuBuilder::new(app, "Editar")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view = SubmenuBuilder::new(app, "Ver")
        .item(
            &MenuItemBuilder::with_id("show_explorer", "Explorador")
                .accelerator("CmdOrCtrl+Shift+E")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("show_chat", "Chat")
                .accelerator(if cfg!(target_os = "macos") {
                    "Ctrl+Cmd+I"
                } else {
                    "Ctrl+Alt+I"
                })
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("toggle_sidebar", "Mostrar u ocultar la barra lateral")
                .accelerator("CmdOrCtrl+B")
                .build(app)?,
        )
        .build()?;

    let window = SubmenuBuilder::new(app, "Ventana")
        .minimize()
        .maximize()
        .fullscreen()
        .build()?;

    let menu = MenuBuilder::new(app);
    #[cfg(target_os = "macos")]
    let menu = menu.item(
        &SubmenuBuilder::new(app, "MeshCode")
            .about(None)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?,
    );

    menu.item(&file.build()?)
        .item(&edit)
        .item(&view)
        .item(&window)
        .build()
}

/// Rebuilds the menu, e.g. after the recent folders changed.
pub fn refresh(app: &AppHandle) {
    match build(app) {
        Ok(menu) => {
            let _ = app.set_menu(menu);
        }
        Err(error) => eprintln!("failed to rebuild menu: {error}"),
    }
}

pub fn handle_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    let action = match id {
        "open_folder" => MenuAction::OpenFolder,
        "clear_recent" => MenuAction::ClearRecent,
        "close_folder" => MenuAction::CloseFolder,
        "close_editor" => MenuAction::CloseEditor,
        "show_explorer" => MenuAction::ShowExplorer,
        "show_chat" => MenuAction::ShowChat,
        "toggle_sidebar" => MenuAction::ToggleSidebar,
        _ => match id.strip_prefix(RECENT_PREFIX) {
            Some(path) => MenuAction::OpenRecent {
                path: path.to_owned(),
            },
            None => return,
        },
    };
    let _ = app.emit("menu", action);
}
