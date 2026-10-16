#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{create_dir_all, OpenOptions};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};

const PORT: u16 = 4300;

struct Server(Mutex<Option<Child>>);

fn server_is_up() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

fn login_shell_path() -> String {
    const MARKER: &str = "__PR_DASHBOARD_PATH__";
    Command::new("/bin/zsh")
        .args(["-ilc", &format!("printf '{MARKER}%s' \"$PATH\"")])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|out| out.rsplit_once(MARKER).map(|(_, path)| path.trim().to_string()))
        .filter(|path| !path.is_empty())
        .unwrap_or_else(|| "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin".into())
}

fn start_server(app: &tauri::App, home: &PathBuf) -> Result<Child, Box<dyn std::error::Error>> {
    let node = std::env::current_exe()?.with_file_name("node");
    let script = app.path().resource_dir()?.join("server/server.js");
    let data = home.join("data");
    create_dir_all(&data)?;
    let log = OpenOptions::new().create(true).append(true).open(data.join("server.log"))?;

    Ok(Command::new(node)
        .arg(script)
        .env("PATH", login_shell_path())
        .env("PR_DASHBOARD_HOME", home)
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log)
        .spawn()?)
}

fn is_local(url: &Url) -> bool {
    url.scheme() == "tauri" || matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "tauri.localhost"))
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let home = app.path().app_data_dir()?;
            let child = if server_is_up() { None } else { Some(start_server(app, &home)?) };
            app.manage(Server(Mutex::new(child)));

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("PR Dashboard")
                .inner_size(1400.0, 900.0)
                .min_inner_size(800.0, 500.0)
                .initialization_script("window.__PR_DASHBOARD_APP__ = true;")
                .on_navigation(|url| {
                    if is_local(url) {
                        return true;
                    }
                    let _ = Command::new("open").arg(url.as_str()).spawn();
                    false
                })
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the app")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(mut child) = app.state::<Server>().0.lock().unwrap().take() {
                    let _ = Command::new("kill").args(["-TERM", &child.id().to_string()]).status();
                    let _ = child.wait();
                }
            }
        });
}
