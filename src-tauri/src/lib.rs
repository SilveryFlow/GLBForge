use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;
use tauri::Manager;

#[derive(Serialize, Clone)]
struct ToolResult {
    tool: String,
    output_path: String,
    input_size: u64,
    output_size: u64,
    elapsed_ms: u64,
}

const TARGET_TRIPLE: &str = match option_env!("TAURI_ENV_TARGET_TRIPLE") {
    Some(triple) => triple,
    None => "x86_64-pc-windows-msvc",
};

fn tool_candidates(tool: &str) -> Vec<PathBuf> {
    let mut names = vec![format!("{tool}-{TARGET_TRIPLE}")];
    if cfg!(windows) {
        names = names.into_iter().map(|n| format!("{n}.exe")).collect();
        names.push(format!("{tool}.exe"));
    } else {
        names.push(tool.to_string());
    }

    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd.join("binaries"));
        roots.push(cwd.join("src-tauri").join("binaries"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.join("binaries"));
            roots.push(dir.to_path_buf());
        }
    }

    let mut out = Vec::new();
    for root in &roots {
        for name in &names {
            out.push(root.join(name));
        }
    }
    out
}

fn find_tool(tool: &str) -> Option<PathBuf> {
    tool_candidates(tool).into_iter().find(|p| p.is_file())
}

fn kill_pid(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    let out = if cfg!(windows) {
        std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
    } else {
        std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output()
    };
    matches!(&out, Ok(o) if o.status.success())
}

static JOBS: Mutex<Option<HashMap<u32, u32>>> = Mutex::new(None);

#[tauri::command]
fn cancel_job(job_id: u32) -> bool {
    if let Ok(mut guard) = JOBS.lock() {
        if let Some(jobs) = guard.as_mut() {
            if let Some(pid) = jobs.remove(&job_id) {
                return kill_pid(pid);
            }
        }
    }
    false
}

#[tauri::command]
async fn run_tool(
    tool: String,
    input: String,
    output: String,
    args: Vec<String>,
    job_id: Option<u32>,
) -> Result<ToolResult, String> {
    let exe = find_tool(&tool).ok_or_else(|| {
        let tried = tool_candidates(&tool)
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ");
        format!("未找到 {tool}，已尝试: {tried}")
    })?;
    let input_size = fs::metadata(&input)
        .map_err(|e| format!("读取输入失败: {e}"))?
        .len();

    let tool_name = tool.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let start = Instant::now();
        let child = std::process::Command::new(&exe)
            .arg("-i")
            .arg(&input)
            .arg("-o")
            .arg(&output)
            .args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("启动 {tool_name} 失败: {e}"))?;

        if let Some(id) = job_id {
            if let Ok(mut guard) = JOBS.lock() {
                guard
                    .get_or_insert_with(HashMap::new)
                    .insert(id, child.id());
            }
        }

        let out = match child.wait_with_output() {
            Ok(o) => o,
            Err(e) => return Err(format!("执行 {tool_name} 失败: {e}")),
        };

        if let Some(id) = job_id {
            if let Ok(mut guard) = JOBS.lock() {
                guard.get_or_insert_with(HashMap::new).remove(&id);
            }
        }

        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!(
                "{tool_name} 退出码 {:?}: {}",
                out.status.code(),
                stderr.trim()
            ));
        }
        let output_size = fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
        Ok(ToolResult {
            tool: tool_name,
            output_path: output,
            input_size,
            output_size,
            elapsed_ms: start.elapsed().as_millis() as u64,
        })
    })
    .await
    .map_err(|e| format!("任务失败: {e}"))?
}

static LOG_LOCK: Mutex<()> = Mutex::new(());

fn log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create app data dir: {e}"))?;
    Ok(dir.join("operations.jsonl"))
}

#[tauri::command]
fn append_log(app: tauri::AppHandle, entry: String) -> Result<(), String> {
    use std::io::Write;
    let _guard = LOG_LOCK.lock().map_err(|e| format!("log lock: {e}"))?;
    let path = log_path(&app)?;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("open log: {e}"))?;
    writeln!(f, "{entry}").map_err(|e| format!("write log: {e}"))
}

#[tauri::command]
fn read_logs(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let _guard = LOG_LOCK.lock().map_err(|e| format!("log lock: {e}"))?;
    let path = log_path(&app)?;
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("read log: {e}")),
    };
    Ok(content.lines().filter(|l| !l.is_empty()).map(String::from).collect())
}

#[tauri::command]
fn clear_logs(app: tauri::AppHandle) -> Result<(), String> {
    let _guard = LOG_LOCK.lock().map_err(|e| format!("log lock: {e}"))?;
    fs::write(log_path(&app)?, b"").map_err(|e| format!("clear log: {e}"))
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    #[cfg(windows)]
    let program = "explorer";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开 {path} 失败: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            run_tool,
            cancel_job,
            append_log,
            read_logs,
            clear_logs,
            open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
