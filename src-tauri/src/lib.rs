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
            nodes.push(TreeNode::Folder { name, path: relative, children });
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
fn create_project_entry(root_path: String, folder_path: String, name: String, kind: String) -> Result<String, String> {
    let root = PathBuf::from(root_path).canonicalize().map_err(|error| error.to_string())?;
    let clean_name = name.trim();
    if clean_name.is_empty() || clean_name == "." || clean_name == ".." || clean_name.contains('/') || clean_name.contains('\\') {
        return Err("名称无效，请勿包含路径分隔符".into());
    }
    let parent = root.join(&folder_path).canonicalize().map_err(|error| error.to_string())?;
    if !parent.starts_with(&root) { return Err("目标目录超出项目范围".into()); }
    let final_name = if kind == "file" && !clean_name.to_lowercase().ends_with(".md") { format!("{}.md", clean_name) } else { clean_name.to_string() };
    let target = parent.join(&final_name);
    if target.exists() { return Err("同名文件或文件夹已经存在".into()); }
    if kind == "folder" { fs::create_dir(&target).map_err(|error| error.to_string())?; }
    else if kind == "file" { fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|error| error.to_string())?; }
    else { return Err("不支持的创建类型".into()); }
    Ok(target.strip_prefix(&root).map_err(|error| error.to_string())?.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
fn delete_project_entry(root_path: String, relative_path: String, kind: String) -> Result<(), String> {
    if relative_path.trim().is_empty() { return Err("不能删除项目根目录".into()); }
    let root = PathBuf::from(root_path).canonicalize().map_err(|error| error.to_string())?;
    let target = root.join(relative_path).canonicalize().map_err(|error| error.to_string())?;
    if target == root || !target.starts_with(&root) { return Err("删除目标超出项目范围".into()); }
    if kind == "folder" {
        if !target.is_dir() { return Err("目标不是文件夹".into()); }
        fs::remove_dir_all(target).map_err(|error| error.to_string())
    } else if kind == "file" {
        if !target.is_file() { return Err("目标不是文件".into()); }
        fs::remove_file(target).map_err(|error| error.to_string())
    } else {
        Err("不支持的删除类型".into())
    }
}

#[tauri::command]
fn rename_project_folder(root_path: String, folder_path: String, new_name: String) -> Result<String, String> {
    let clean_name = new_name.trim();
    if clean_name.is_empty() || clean_name == "." || clean_name == ".." || clean_name.contains('/') || clean_name.contains('\\') { return Err("文件夹名称无效，请勿包含路径分隔符".into()); }
    let root = PathBuf::from(root_path).canonicalize().map_err(|error| error.to_string())?;
    let source = root.join(&folder_path).canonicalize().map_err(|error| error.to_string())?;
    if source == root || !source.starts_with(&root) || !source.is_dir() { return Err("无法重命名该文件夹".into()); }
    let target = source.parent().ok_or("无法定位上级目录")?.join(clean_name);
    if target.exists() && target != source { return Err("同名文件或文件夹已经存在".into()); }
    fs::rename(&source, &target).map_err(|error| error.to_string())?;
    Ok(target.strip_prefix(&root).map_err(|error| error.to_string())?.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
fn move_project_entry(root_path: String, source_path: String, target_folder: String) -> Result<String, String> {
    let root = PathBuf::from(root_path).canonicalize().map_err(|error| error.to_string())?;
    let source = root.join(&source_path).canonicalize().map_err(|error| error.to_string())?;
    let destination = root.join(&target_folder).canonicalize().map_err(|error| error.to_string())?;
    if source == root || !source.starts_with(&root) || !destination.starts_with(&root) || !destination.is_dir() { return Err("移动路径超出项目范围".into()); }
    if source.is_dir() && destination.starts_with(&source) { return Err("不能将文件夹移动到自身内部".into()); }
    let target = destination.join(source.file_name().ok_or("无法读取名称")?);
    if target.exists() { return Err("目标文件夹中存在同名项目".into()); }
    fs::rename(&source, &target).map_err(|error| error.to_string())?;
    Ok(target.strip_prefix(&root).map_err(|error| error.to_string())?.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
fn trash_project_entry(root_path: String, relative_path: String) -> Result<String, String> {
    let root = PathBuf::from(root_path).canonicalize().map_err(|error| error.to_string())?;
    let source = root.join(&relative_path).canonicalize().map_err(|error| error.to_string())?;
    if source == root || !source.starts_with(&root) { return Err("删除目标超出项目范围".into()); }
    let trash = PathBuf::from(std::env::var("HOME").map_err(|_| "无法定位用户目录")?).join(".Trash");
    fs::create_dir_all(&trash).map_err(|error| error.to_string())?;
    let name = source.file_name().and_then(|value| value.to_str()).ok_or("无法读取名称")?;
    let mut target = trash.join(name);
    let mut index = 1;
    while target.exists() { target = trash.join(format!("{} {}", name, index)); index += 1; }
    fs::rename(&source, &target).map_err(|error| error.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn restore_trashed_entry(root_path: String, relative_path: String, trash_path: String) -> Result<(), String> {
    let root = PathBuf::from(root_path).canonicalize().map_err(|error| error.to_string())?;
    let trash_root = PathBuf::from(std::env::var("HOME").map_err(|_| "无法定位用户目录")?).join(".Trash").canonicalize().map_err(|error| error.to_string())?;
    let source = PathBuf::from(trash_path).canonicalize().map_err(|error| error.to_string())?;
    if !source.starts_with(&trash_root) { return Err("恢复来源不是废纸篓".into()); }
    let target = root.join(relative_path);
    if target.exists() { return Err("原位置已存在同名项目".into()); }
    let parent = target.parent().ok_or("无法定位原目录")?;
    if !parent.exists() || !parent.canonicalize().map_err(|error| error.to_string())?.starts_with(&root) { return Err("原目录已经不存在".into()); }
    fs::rename(source, target).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_pasted_image(root_path: String, document_path: String, file_name: String, base64_data: String) -> Result<String, String> {
    let root = PathBuf::from(root_path).canonicalize().map_err(|error| error.to_string())?;
    let document = root.join(document_path).canonicalize().map_err(|error| error.to_string())?;
    if !document.starts_with(&root) || !document.is_file() { return Err("文档路径超出项目范围".into()); }
    let assets = document.parent().ok_or("无法定位文档目录")?.join("assets");
    fs::create_dir_all(&assets).map_err(|error| error.to_string())?;
    let raw_name = PathBuf::from(file_name);
    let stem = raw_name.file_stem().and_then(|value| value.to_str()).unwrap_or("image");
    let extension = raw_name.extension().and_then(|value| value.to_str()).unwrap_or("png");
    let safe_stem: String = stem.chars().map(|value| if value.is_alphanumeric() || value == '-' || value == '_' { value } else { '-' }).collect();
    let mut target = assets.join(format!("{}.{}", safe_stem, extension));
    let mut index = 1;
    while target.exists() { target = assets.join(format!("{}-{}.{}", safe_stem, index, extension)); index += 1; }
    let data = STANDARD.decode(base64_data).map_err(|error| format!("图片数据无效：{}", error))?;
    fs::write(&target, data).map_err(|error| error.to_string())?;
    Ok(format!("assets/{}", target.file_name().and_then(|value| value.to_str()).ok_or("图片名称无效")?))
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
    let mut child = Command::new("/usr/bin/pbcopy").env("LANG", "en_US.UTF-8").stdin(Stdio::piped()).spawn().map_err(|error| error.to_string())?;
    child.stdin.as_mut().ok_or("无法访问系统剪贴板")?.write_all(content.as_bytes()).map_err(|error| error.to_string())?;
    drop(child.stdin.take());
    let status = child.wait().map_err(|error| error.to_string())?;
    if status.success() { Ok(()) } else { Err("复制源码失败".into()) }
}

#[tauri::command]
fn copy_path(path: String) -> Result<(), String> {
    let absolute = PathBuf::from(path).canonicalize().map_err(|error| format!("无法读取文件路径：{}", error))?;
    copy_text(absolute.to_string_lossy().to_string()).map_err(|error| format!("复制绝对路径失败：{}", error))
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    let path = PathBuf::from(path).canonicalize().map_err(|error| error.to_string())?;
    let status = Command::new("open").arg("-R").arg(path).status().map_err(|error| error.to_string())?;
    if status.success() { Ok(()) } else { Err("无法在 Finder 中定位文件".into()) }
}

#[tauri::command]
fn rename_markdown(path: String, new_name: String) -> Result<String, String> {
    let source = PathBuf::from(path).canonicalize().map_err(|error| error.to_string())?;
    let mut name = new_name.trim().to_string();
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\\') {
        return Err("文件名无效，请勿包含路径分隔符".into());
    }
    if !name.to_lowercase().ends_with(".md") { name.push_str(".md"); }
    let target = source.parent().ok_or("无法定位文件目录")?.join(name);
    if target.exists() && target != source { return Err("同名文件已存在".into()); }
    fs::rename(&source, &target).map_err(|error| error.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

fn html_document(title: &str, body: &str) -> String {
    format!(r#"<!doctype html><html><head><meta charset="utf-8"><title>{}</title><style>
@page {{ size: A4; margin: 18mm 17mm; }}
body {{ margin: 0; color: #262722; font: 14px/1.75 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }}
article {{ max-width: 820px; margin: 0 auto; }}
h1 {{ font-size: 30px; border-bottom: 1px solid #ddd; padding-bottom: 12px; }} h2 {{ font-size: 22px; margin-top: 32px; }} h3 {{ font-size: 17px; margin-top: 24px; }}
pre {{ overflow-wrap: anywhere; white-space: pre-wrap; padding: 14px; border-radius: 7px; background: #f1f1ee; }} code {{ font-family: Menlo, monospace; }}
blockquote {{ margin-left: 0; padding-left: 14px; border-left: 3px solid #d9613c; color: #666; }}
table {{ width: 100%; border-collapse: collapse; }} th, td {{ padding: 7px 9px; border: 1px solid #d8d8d2; text-align: left; }}
img, svg {{ max-width: 100%; height: auto; }} a {{ color: #b54829; }} pre, table, img, svg {{ break-inside: avoid; }}
</style></head><body><article>{}</article></body></html>"#, title.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;"), body)
}

fn export_document_blocking(output_path: String, format: String, title: String, html: String) -> Result<String, String> {
    if format != "docx" { return Err("该命令仅用于 Word 文档导出".into()); }
    let mut output = PathBuf::from(output_path);
    if output.extension().and_then(|value| value.to_str()).map(|value| !value.eq_ignore_ascii_case("docx")).unwrap_or(true) {
        output.set_extension("docx");
    }
    let export_id = format!("zdocs-export-{}", std::process::id());
    let temp = std::env::temp_dir().join(format!("{}.html", export_id));
    fs::write(&temp, html_document(&title, &html)).map_err(|error| error.to_string())?;
    let result = Command::new("/usr/bin/textutil").args(["-convert", "docx", "-output"]).arg(&output).arg(&temp).status();
    let _ = fs::remove_file(&temp);
    let status = result.map_err(|error| error.to_string())?;
    if !status.success() || !output.exists() { return Err("文档生成失败，请检查保存位置权限".into()); }
    Ok(output.to_string_lossy().to_string())
}

#[tauri::command]
async fn export_document(output_path: String, format: String, title: String, html: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || export_document_blocking(output_path, format, title, html))
        .await
        .map_err(|error| format!("导出任务执行失败：{}", error))?
}

#[tauri::command]
fn write_pdf_file(output_path: String, base64_data: String) -> Result<String, String> {
    let mut output = PathBuf::from(output_path);
    if output.extension().and_then(|value| value.to_str()).map(|value| !value.eq_ignore_ascii_case("pdf")).unwrap_or(true) {
        output.set_extension("pdf");
    }
    let data = STANDARD.decode(base64_data).map_err(|error| format!("PDF 数据无效：{}", error))?;
    fs::write(&output, data).map_err(|error| format!("PDF 保存失败：{}", error))?;
    Ok(output.to_string_lossy().to_string())
}

#[tauri::command]
async fn download_update(url: String, file_name: String) -> Result<String, String> {
    if !url.starts_with("https://github.com/zdpeazy/zdocs-reader/releases/download/") || !file_name.ends_with(".dmg") || file_name.contains('/') || file_name.contains('\\') {
        return Err("更新下载地址无效".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let home = std::env::var("HOME").map(PathBuf::from).map_err(|_| "无法定位用户目录")?;
        let downloads = home.join("Downloads");
        fs::create_dir_all(&downloads).map_err(|error| error.to_string())?;
        let target = downloads.join(file_name);
        let status = Command::new("/usr/bin/curl").args(["--location", "--fail", "--silent", "--show-error"]).arg("--output").arg(&target).arg(url).status().map_err(|error| error.to_string())?;
        if !status.success() { return Err("更新包下载失败".into()); }
        let opened = Command::new("/usr/bin/open").arg(&target).status().map_err(|error| error.to_string())?;
        if !opened.success() { return Err("更新包已下载，但无法自动打开".into()); }
        Ok(target.to_string_lossy().to_string())
    }).await.map_err(|error| format!("更新任务执行失败：{}", error))?
}

#[tauri::command]
fn open_external_link(url: String) -> Result<(), String> {
    let normalized = url.trim();
    if !(normalized.starts_with("https://") || normalized.starts_with("http://") || normalized.starts_with("mailto:")) {
        return Err("仅支持打开 http、https 或邮件链接".into());
    }
    let status = Command::new("open").arg(normalized).status().map_err(|error| error.to_string())?;
    if status.success() { Ok(()) } else { Err("无法使用系统默认浏览器打开链接".into()) }
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
        .invoke_handler(tauri::generate_handler![scan_project, read_markdown, write_markdown, create_markdown, create_project_entry, delete_project_entry, rename_project_folder, move_project_entry, trash_project_entry, restore_trashed_entry, save_pasted_image, read_asset, copy_text, copy_path, reveal_in_finder, rename_markdown, export_document, write_pdf_file, download_update, open_external_link, lark_status, lark_import, lark_publish])
        .run(tauri::generate_context!())
        .expect("error while running ZDocs");
}
