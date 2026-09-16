//! Locating external programs (Blender, Node.js) on the user's machine.

use std::{fs, path::PathBuf};

/// Finds a program from an environment variable override, then known install locations, then
/// the PATH. Apps launched from the Finder/desktop get a minimal PATH, so install spots come first.
pub fn find(env_var: &str, name: &str, install_locations: Vec<PathBuf>) -> Option<PathBuf> {
    let executable = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    };
    let on_path: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|paths| {
            std::env::split_paths(&paths)
                .map(|dir| dir.join(&executable))
                .collect()
        })
        .unwrap_or_default();

    std::env::var_os(env_var)
        .map(PathBuf::from)
        .into_iter()
        .chain(install_locations)
        .chain(on_path)
        .find(|path| path.is_file())
        // Blender locates its bundled Python scripts relative to the executable, so a symlink
        // like /usr/local/bin/blender must be resolved to the real binary inside Blender.app.
        .map(|path| fs::canonicalize(&path).unwrap_or(path))
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
}
