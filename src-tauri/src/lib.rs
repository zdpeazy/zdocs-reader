use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum TreeNode {
    Folder { name: String, path: String, children: Vec<TreeNode> },
    File { name: String, path: String, doc: NativeDoc },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeDoc {
    id: String,
    name: String,
    path: String,
    project_id: String,
    native_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeProject {
    id: String,
    name: String,
    root_path: String,
    access_status: String,
    tree: Vec<TreeNode>,
    files: Vec<NativeDoc>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileSnapshot {
    content: String,
    last_modified: u64,
}

const IGNORED: &[&str] = &[".git", ".idea", ".vscode", "node_modules", "dist", "build", "coverage", ".next", ".nuxt", "target", "vendor"];

fn scan_dir(root: &Path, current: &Path, project_id: &str, files: &mut Vec<NativeDoc>) -> Result<Vec<TreeNode>, String> {
    let mut nodes = Vec::new();
    let entries = fs::read_dir(current).map_err(|error| error.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() && IGNORED.contains(&name.as_str()) { continue; }
        let relative = path.strip_prefix(root).map_err(|error| error.to_string())?.to_string_lossy().replace('\\', "/");
        if path.is_dir() {
            let children = scan_dir(root, &path, project_id, files)?;
            if !children.is_empty() { nodes.push(TreeNode::Folder { name, path: relative, children }); }
        } else if path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("md")) {
            let doc = NativeDoc { id: format!("{}:{}", project_id, relative), name: name.clone(), path: relative.clone(), project_id: project_id.to_string(), native_path: path.to_string_lossy().to_string() };
            files.push(doc.clone());
            nodes.push(TreeNode::File { name, path: relative, doc });
        }
    }
    nodes.sort_by(|left, right| match (left, right) {
        (TreeNode::Folder { name: a, .. }, TreeNode::Folder { name: b, .. }) | (TreeNode::File { name: a, .. }, TreeNode::File { name: b, .. }) => a.to_lowercase().cmp(&b.to_lowercase()),
        (TreeNode::Folder { .. }, TreeNode::File { .. }) => std::cmp::Ordering::Less,
        _ => std::cmp::Ordering::Greater,
    });
    Ok(nodes)
}

#[tauri::command]
fn scan_project(root_path: String, project_id: String) -> Result<NativeProject, String> {
    let root = PathBuf::from(&root_path).canonicalize().map_err(|error| error.to_string())?;
    let mut files = Vec::new();
    let tree = scan_dir(&root, &root, &project_id, &mut files)?;
    let name = root.file_name().map(|value| value.to_string_lossy().to_string()).unwrap_or_else(|| root_path.clone());
    Ok(NativeProject { id: project_id, name, root_path: root.to_string_lossy().to_string(), access_status: "granted".into(), tree, files })
}

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path).and_then(|metadata| metadata.modified()).ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map(|duration| duration.as_millis() as u64).unwrap_or(0)
}

#[tauri::command]
fn read_markdown(path: String) -> Result<FileSnapshot, String> {
    let path = PathBuf::from(path);
    Ok(FileSnapshot { content: fs::read_to_string(&path).map_err(|error| error.to_string())?, last_modified: modified_ms(&path) })
}

#[tauri::command]
fn write_markdown(path: String, content: String) -> Result<u64, String> {
    let path = PathBuf::from(path);
    fs::write(&path, content).map_err(|error| error.to_string())?;
    Ok(modified_ms(&path))
}

#[tauri::command]
fn create_markdown(root_path: String, relative_path: String, content: String) -> Result<String, String> {
    let root = PathBuf::from(root_path).canonicalize().map_err(|error| error.to_string())?;
    let requested = root.join(relative_path);
    let parent = requested.parent().ok_or("无效文件路径")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let stem = requested.file_stem().and_then(|value| value.to_str()).unwrap_or("feishu-document");
    let extension = requested.extension().and_then(|value| value.to_str()).unwrap_or("md");
    let mut target = requested.clone();
    let mut index = 1;
    while target.exists() { target = parent.join(format!("{} ({}).{}", stem, index, extension)); index += 1; }
    fs::write(&target, content).map_err(|error| error.to_string())?;
    Ok(target.strip_prefix(&root).map_err(|error| error.to_string())?.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
fn read_asset(root_path: String, relative_path: String) -> Result<String, String> {
    let root = PathBuf::from(root_path).canonicalize().map_err(|error| error.to_string())?;
    let path = root.join(relative_path).canonicalize().map_err(|error| error.to_string())?;
    if !path.starts_with(&root) { return Err("资源路径超出项目目录".into()); }
    let mime = match path.extension().and_then(|value| value.to_str()).unwrap_or("").to_lowercase().as_str() { "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "gif" => "image/gif", "webp" => "image/webp", "svg" => "image/svg+xml", _ => "application/octet-stream" };
    let data = fs::read(path).map_err(|error| error.to_string())?;
    Ok(format!("data:{};base64,{}", mime, STANDARD.encode(data)))
}

#[tauri::command]
fn copy_text(content: String) -> Result<(), String> {
    let mut child = Command::new("pbcopy").stdin(Stdio::piped()).spawn().map_err(|error| error.to_string())?;
    child.stdin.as_mut().ok_or("无法访问系统剪贴板")?.write_all(content.as_bytes()).map_err(|error| error.to_string())?;
    drop(child.stdin.take());
    let status = child.wait().map_err(|error| error.to_string())?;
    if status.success() { Ok(()) } else { Err("复制源码失败".into()) }
}

fn lark_binary() -> Result<PathBuf, String> {
    if let Ok(output) = Command::new("which").arg("lark-cli").output() {
        if output.status.success() { return Ok(PathBuf::from(String::from_utf8_lossy(&output.stdout).trim())); }
    }
    let home = std::env::var("HOME").map(PathBuf::from).map_err(|_| "无法定位用户目录")?;
    let versions = home.join(".nvm/versions/node");
    if let Ok(entries) = fs::read_dir(versions) {
        for entry in entries.flatten() { let candidate = entry.path().join("bin/lark-cli"); if candidate.exists() { return Ok(candidate); } }
    }
    Err("未找到 lark-cli，请先安装并配置飞书 CLI".into())
}

fn run_lark(args: &[&str], input: Option<&str>) -> Result<Value, String> {
    let mut child = Command::new(lark_binary()?).args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|error| error.to_string())?;
    if let Some(content) = input { child.stdin.as_mut().ok_or("无法写入飞书命令")?.write_all(content.as_bytes()).map_err(|error| error.to_string())?; }
    let output = child.wait_with_output().map_err(|error| error.to_string())?;
    let value: Value = serde_json::from_slice(&output.stdout).map_err(|_| String::from_utf8_lossy(&output.stderr).to_string())?;
    if !output.status.success() || value.get("ok") != Some(&Value::Bool(true)) { return Err(value.pointer("/error/message").and_then(Value::as_str).unwrap_or("飞书命令执行失败").into()); }
    Ok(value)
}

fn doc_data(value: &Value) -> Value { value.pointer("/data/document").cloned().unwrap_or_else(|| json!({})) }

#[tauri::command]
fn lark_status() -> Result<Value, String> { run_lark(&["auth", "status", "--json"], None) }

#[tauri::command]
fn lark_import(url: String) -> Result<Value, String> {
    let fetched = run_lark(&["docs", "+fetch", "--as", "user", "--doc", &url, "--doc-format", "markdown", "--detail", "simple"], None)?;
    let document = doc_data(&fetched);
    Ok(json!({ "ok": true, "document": { "token": document.get("document_id"), "revision": document.get("revision_id"), "content": document.get("content").and_then(Value::as_str).unwrap_or(""), "title": document.get("title").and_then(Value::as_str).unwrap_or("飞书文档"), "url": url } }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublishInput { title: String, content: String, doc_url: Option<String> }

#[tauri::command]
fn lark_publish(input: PublishInput) -> Result<Value, String> {
    let (document, warnings) = if let Some(url) = input.doc_url.as_deref() {
        run_lark(&["docs", "+fetch", "--as", "user", "--doc", url, "--doc-format", "markdown", "--detail", "with-ids"], None)?;
        let updated = run_lark(&["docs", "+update", "--as", "user", "--doc", url, "--command", "overwrite", "--doc-format", "markdown", "--content", "-"], Some(&input.content))?;
        let verified = run_lark(&["docs", "+fetch", "--as", "user", "--doc", url, "--doc-format", "markdown", "--detail", "simple"], None)?;
        let mut document = doc_data(&verified); document["url"] = Value::String(url.into());
        (document, updated.pointer("/data/warnings").cloned().unwrap_or_else(|| json!([])))
    } else {
        let created = run_lark(&["docs", "+create", "--as", "user", "--title", &input.title, "--doc-format", "markdown", "--content", "-"], Some(&input.content))?;
        let created_doc = doc_data(&created);
        let target = created_doc.get("url").or_else(|| created_doc.get("document_id")).and_then(Value::as_str).ok_or("飞书未返回文档地址")?;
        let verified = run_lark(&["docs", "+fetch", "--as", "user", "--doc", target, "--doc-format", "markdown", "--detail", "simple"], None)?;
        let mut document = doc_data(&verified); if let Some(url) = created_doc.get("url") { document["url"] = url.clone(); }
        (document, created.pointer("/data/warnings").cloned().unwrap_or_else(|| json!([])))
    };
    Ok(json!({ "ok": true, "document": { "token": document.get("document_id"), "revision": document.get("revision_id"), "url": document.get("url") }, "warnings": warnings }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![scan_project, read_markdown, write_markdown, create_markdown, read_asset, copy_text, lark_status, lark_import, lark_publish])
        .run(tauri::generate_context!())
        .expect("error while running ZDocs");
}
