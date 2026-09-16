//! Source control for the open folder, using the Git installed on the user's machine.
//! Paths sent to and from the frontend are relative to the repository root.

use std::{
    path::PathBuf,
    process::{Command, Stdio},
};

use serde::Serialize;

use crate::executable;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// The repository's top-level folder, which may contain the open folder.
    root: String,
    /// `None` when HEAD is detached.
    branch: Option<String>,
    /// Abbreviated HEAD commit, `None` before the first commit.
    commit: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    files: Vec<FileChange>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    path: String,
    /// The source of a rename or copy.
    orig_path: Option<String>,
    /// Status letter in the index (`M`, `A`, `D`, `R`, `C`, `T`), if staged.
    staged: Option<char>,
    /// Status letter in the working tree (`M`, `D`, `T`, or `?` when untracked), if changed.
    unstaged: Option<char>,
    /// Unmerged, with both sides' letters in `staged` and `unstaged`.
    conflict: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    /// Short name, like `main` or `origin/main`.
    name: String,
    remote: bool,
    current: bool,
}

/// The repository containing `cwd`, or `None` when it isn't in one.
#[tauri::command]
pub async fn git_status(cwd: String) -> Result<Option<Status>, String> {
    blocking(move || {
        // Untranslated, to recognize the error.
        let mut toplevel = command(&cwd, &["rev-parse", "--show-toplevel"])?;
        toplevel.env("LC_ALL", "C");
        let root = match run(toplevel) {
            Ok(root) => root.trim_end_matches(['\n', '\r']).to_owned(),
            Err(error) if error.contains("not a git repository") => return Ok(None),
            Err(error) => return Err(error),
        };
        let output = git(
            &root,
            &[
                "status",
                "--porcelain=v2",
                "--branch",
                "-z",
                "--untracked-files=all",
            ],
        )?;
        Ok(Some(parse_status(root, &output)))
    })
    .await
}

#[tauri::command]
pub async fn git_init(cwd: String) -> Result<(), String> {
    blocking(move || git(&cwd, &["init"]).map(drop)).await
}

#[tauri::command]
pub async fn git_stage(root: String, paths: Vec<String>) -> Result<(), String> {
    blocking(move || git_paths(&root, &["add", "-A"], &paths)).await
}

#[tauri::command]
pub async fn git_unstage(root: String, paths: Vec<String>) -> Result<(), String> {
    blocking(move || {
        if has_commits(&root) {
            git_paths(&root, &["restore", "--staged"], &paths)
        } else {
            git_paths(&root, &["rm", "--cached", "-r", "-q"], &paths)
        }
    })
    .await
}

/// Reverts working tree changes: restores tracked files from the index and deletes untracked ones.
#[tauri::command]
pub async fn git_discard(
    root: String,
    tracked: Vec<String>,
    untracked: Vec<String>,
) -> Result<(), String> {
    blocking(move || {
        git_paths(&root, &["restore"], &tracked)?;
        git_paths(&root, &["clean", "-f", "-q"], &untracked)
    })
    .await
}

/// Commits the staged changes, or every change when `all` is set.
#[tauri::command]
pub async fn git_commit(root: String, message: String, all: bool) -> Result<(), String> {
    blocking(move || {
        if all {
            git(&root, &["add", "-A"])?;
        }
        git(&root, &["commit", "-m", &message]).map(drop)
    })
    .await
}

/// Undoes the last commit, keeping its changes staged, and returns its message.
#[tauri::command]
pub async fn git_undo_commit(root: String) -> Result<String, String> {
    blocking(move || {
        let message = git(&root, &["log", "-1", "--format=%B"])?;
        if git(&root, &["rev-parse", "--verify", "-q", "HEAD~1"]).is_ok() {
            git(&root, &["reset", "--soft", "HEAD~1"])?;
        } else {
            // The first commit has no parent to reset to: unborn the branch instead.
            git(&root, &["update-ref", "-d", "HEAD"])?;
        }
        Ok(message.trim_end().to_owned())
    })
    .await
}

/// Local branches, then remote ones, most recently committed first.
#[tauri::command]
pub async fn git_branches(root: String) -> Result<Vec<Branch>, String> {
    blocking(move || {
        let output = git(
            &root,
            &[
                "for-each-ref",
                "--sort=-committerdate",
                "--format=%(HEAD)%00%(refname)%00%(refname:short)",
                "refs/heads",
                "refs/remotes",
            ],
        )?;
        let mut branches: Vec<Branch> = output
            .lines()
            .filter_map(|line| {
                let mut fields = line.split('\0');
                let (head, refname, name) = (fields.next()?, fields.next()?, fields.next()?);
                // Skip `origin/HEAD`, a pointer to the remote's default branch.
                if refname.starts_with("refs/remotes/") && refname.ends_with("/HEAD") {
                    return None;
                }
                Some(Branch {
                    name: name.to_owned(),
                    remote: refname.starts_with("refs/remotes/"),
                    current: head == "*",
                })
            })
            .collect();
        branches.sort_by_key(|branch| branch.remote);
        Ok(branches)
    })
    .await
}

/// Switches to a local branch, or to a new local branch tracking `name` when it is remote.
#[tauri::command]
pub async fn git_checkout(root: String, name: String, remote: bool) -> Result<(), String> {
    blocking(move || {
        if remote {
            git(&root, &["switch", "--track", &name]).map(drop)
        } else {
            git(&root, &["switch", &name]).map(drop)
        }
    })
    .await
}

#[tauri::command]
pub async fn git_create_branch(root: String, name: String) -> Result<(), String> {
    blocking(move || git(&root, &["switch", "-c", &name]).map(drop)).await
}

/// Pushes the current branch, publishing it to the first remote if it has no upstream yet.
#[tauri::command]
pub async fn git_push(root: String) -> Result<(), String> {
    blocking(move || {
        if git(&root, &["rev-parse", "--abbrev-ref", "@{upstream}"]).is_ok() {
            return git(&root, &["push"]).map(drop);
        }
        let remotes = git(&root, &["remote"])?;
        let remote = remotes
            .lines()
            .find(|remote| *remote == "origin")
            .or_else(|| remotes.lines().next())
            .ok_or(
                "El repositorio no tiene remotos configurados. Añade uno con `git remote add`.",
            )?;
        git(&root, &["push", "-u", remote, "HEAD"]).map(drop)
    })
    .await
}

#[tauri::command]
pub async fn git_pull(root: String) -> Result<(), String> {
    blocking(move || git(&root, &["pull"]).map(drop)).await
}

async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| e.to_string())?
}

/// Runs git in `cwd` and returns its standard output, or its error output if it fails.
fn git(cwd: &str, args: &[&str]) -> Result<String, String> {
    run(command(cwd, args)?)
}

fn command(cwd: &str, args: &[&str]) -> Result<Command, String> {
    let git = find_git()
        .ok_or("No se encontró Git. Instálalo o define la variable de entorno MESHCODE_GIT.")?;
    let mut command = Command::new(git);
    command
        // Paths are file names, not patterns; status must not rewrite the index while it's watched.
        .args(["--literal-pathspecs", "--no-optional-locks"])
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        // Fail instead of waiting for credentials on a terminal nobody sees.
        .env("GIT_TERMINAL_PROMPT", "0");
    Ok(command)
}

fn run(mut command: Command) -> Result<String, String> {
    let output = command.output().map_err(|e| {
        format!(
            "No se pudo ejecutar Git ({}): {e}",
            command.get_program().to_string_lossy()
        )
    })?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let message = if stderr.trim().is_empty() {
        String::from_utf8_lossy(&output.stdout)
    } else {
        stderr
    };
    Err(message.trim().to_owned())
}

fn git_paths(root: &str, args: &[&str], paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args = args.to_vec();
    args.push("--");
    args.extend(paths.iter().map(String::as_str));
    git(root, &args).map(drop)
}

fn has_commits(root: &str) -> bool {
    git(root, &["rev-parse", "--verify", "-q", "HEAD"]).is_ok()
}

/// Parses `git status --porcelain=v2 --branch -z`.
fn parse_status(root: String, output: &str) -> Status {
    let mut status = Status {
        root,
        branch: None,
        commit: None,
        upstream: None,
        ahead: 0,
        behind: 0,
        files: Vec::new(),
    };
    let letter = |c: char| (c != '.').then_some(c);
    let mut records = output.split('\0').filter(|record| !record.is_empty());
    while let Some(record) = records.next() {
        if let Some(header) = record.strip_prefix("# ") {
            let (key, value) = header.split_once(' ').unwrap_or((header, ""));
            match key {
                "branch.oid" if value != "(initial)" => {
                    status.commit = Some(value.chars().take(7).collect())
                }
                "branch.head" if value != "(detached)" => status.branch = Some(value.to_owned()),
                "branch.upstream" => status.upstream = Some(value.to_owned()),
                "branch.ab" => {
                    for count in value.split(' ') {
                        if let Some(ahead) = count.strip_prefix('+') {
                            status.ahead = ahead.parse().unwrap_or(0);
                        } else if let Some(behind) = count.strip_prefix('-') {
                            status.behind = behind.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }

        // Ordinary (`1`), renamed or copied (`2`) and unmerged (`u`) entries have a fixed number of
        // fields before the path, which may itself contain spaces; untracked (`?`) ones only the path.
        let (kind, rest) = record.split_at(1);
        let fields = match kind {
            "1" => 8,
            "2" => 9,
            "u" => 10,
            "?" => {
                status.files.push(FileChange {
                    path: rest.trim_start().to_owned(),
                    orig_path: None,
                    staged: None,
                    unstaged: Some('?'),
                    conflict: false,
                });
                continue;
            }
            _ => continue,
        };
        let parts: Vec<&str> = record.splitn(fields + 1, ' ').collect();
        let (Some(xy), Some(path)) = (parts.get(1), parts.get(fields)) else {
            continue;
        };
        let mut xy = xy.chars();
        let (x, y) = (xy.next().unwrap_or('.'), xy.next().unwrap_or('.'));
        status.files.push(FileChange {
            path: (*path).to_owned(),
            // With `-z`, a rename's source follows as its own record.
            orig_path: if kind == "2" {
                records.next().map(str::to_owned)
            } else {
                None
            },
            staged: letter(x),
            unstaged: letter(y),
            conflict: kind == "u",
        });
    }
    status
}

fn find_git() -> Option<PathBuf> {
    executable::find("MESHCODE_GIT", "git", install_locations())
}

#[cfg(target_os = "windows")]
fn install_locations() -> Vec<PathBuf> {
    vec![PathBuf::from(r"C:\Program Files\Git\cmd\git.exe")]
}

#[cfg(not(target_os = "windows"))]
fn install_locations() -> Vec<PathBuf> {
    // Homebrew's Git before the system one, which on macOS may be the Command Line Tools stub.
    [
        "/opt/homebrew/bin/git",
        "/usr/local/bin/git",
        "/usr/bin/git",
    ]
    .map(PathBuf::from)
    .to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2() {
        let output = [
            "# branch.oid 1234567890abcdef",
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +2 -1",
            "1 .M N... 100644 100644 100644 aaa bbb scene one.blend",
            "2 R. N... 100644 100644 100644 aaa bbb R100 new.blend",
            "old.blend",
            "u UU N... 100644 100644 100644 100644 aaa bbb ccc both.txt",
            "? untracked file.txt",
            "",
        ]
        .join("\0");
        let status = parse_status("/repo".into(), &output);
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.commit.as_deref(), Some("1234567"));
        assert_eq!(status.upstream.as_deref(), Some("origin/main"));
        assert_eq!((status.ahead, status.behind), (2, 1));

        let files: Vec<_> = status
            .files
            .iter()
            .map(|f| {
                (
                    f.path.as_str(),
                    f.orig_path.as_deref(),
                    f.staged,
                    f.unstaged,
                    f.conflict,
                )
            })
            .collect();
        assert_eq!(
            files,
            [
                ("scene one.blend", None, None, Some('M'), false),
                ("new.blend", Some("old.blend"), Some('R'), None, false),
                ("both.txt", None, Some('U'), Some('U'), true),
                ("untracked file.txt", None, None, Some('?'), false),
            ]
        );
    }

    #[test]
    fn runs_the_workflow() {
        use tauri::async_runtime::block_on;

        let dir = std::env::temp_dir().join(format!("meshcode-git-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        let cwd = dunce::canonicalize(&dir)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let status = |path: &str| block_on(git_status(path.to_owned())).unwrap();

        assert!(status(&cwd).is_none());
        block_on(git_init(cwd.clone())).unwrap();
        git(&cwd, &["config", "user.name", "Test"]).unwrap();
        git(&cwd, &["config", "user.email", "test@example.com"]).unwrap();
        std::fs::write(dir.join("sub/a b.txt"), "one").unwrap();
        std::fs::write(dir.join(":weird.txt"), "one").unwrap();

        // From a subfolder, paths are still relative to the root.
        let current = status(&format!("{cwd}/sub")).unwrap();
        assert_eq!(current.root, cwd);
        let paths: Vec<_> = current.files.iter().map(|f| f.path.clone()).collect();
        assert_eq!(paths, [":weird.txt", "sub/a b.txt"]);

        block_on(git_stage(cwd.clone(), vec!["sub/a b.txt".into()])).unwrap();
        block_on(git_unstage(cwd.clone(), vec!["sub/a b.txt".into()])).unwrap();
        block_on(git_commit(cwd.clone(), "First".into(), true)).unwrap();
        let current = status(&cwd).unwrap();
        assert!(current.files.is_empty() && current.commit.is_some());

        std::fs::write(dir.join("sub/a b.txt"), "two").unwrap();
        block_on(git_stage(cwd.clone(), vec!["sub/a b.txt".into()])).unwrap();
        block_on(git_commit(cwd.clone(), "Second\n\nBody".into(), false)).unwrap();
        let message = block_on(git_undo_commit(cwd.clone())).unwrap();
        assert_eq!(message, "Second\n\nBody");
        assert_eq!(status(&cwd).unwrap().files[0].staged, Some('M'));
        block_on(git_unstage(cwd.clone(), vec!["sub/a b.txt".into()])).unwrap();
        std::fs::write(dir.join("new.txt"), "new").unwrap();
        block_on(git_discard(
            cwd.clone(),
            vec!["sub/a b.txt".into()],
            vec!["new.txt".into()],
        ))
        .unwrap();
        assert!(status(&cwd).unwrap().files.is_empty());
        assert_eq!(
            std::fs::read_to_string(dir.join("sub/a b.txt")).unwrap(),
            "one"
        );

        let main = status(&cwd).unwrap().branch.unwrap();
        block_on(git_create_branch(cwd.clone(), "feature".into())).unwrap();
        assert_eq!(status(&cwd).unwrap().branch.as_deref(), Some("feature"));
        let branches = block_on(git_branches(cwd.clone())).unwrap();
        assert!(branches.iter().any(|b| b.name == "feature" && b.current));
        block_on(git_checkout(cwd.clone(), main.clone(), false)).unwrap();
        assert_eq!(status(&cwd).unwrap().branch, Some(main));

        let error = block_on(git_push(cwd.clone())).unwrap_err();
        assert!(error.contains("no tiene remotos"), "{error}");
        block_on(git_undo_commit(cwd.clone())).unwrap();
        assert!(status(&cwd).unwrap().commit.is_none());

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn parses_new_repository() {
        let status = parse_status(
            "/repo".into(),
            "# branch.oid (initial)\0# branch.head main\0",
        );
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.commit, None);
        assert!(status.files.is_empty());
    }
}
