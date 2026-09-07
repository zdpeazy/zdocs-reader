import type { DocFile, DocsProject, TreeNode } from "./types";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  }
}

const IGNORED_DIRECTORIES = new Set([
  ".git", ".idea", ".vscode", "node_modules", "dist", "build", "coverage", ".next", ".nuxt", "target", "vendor",
]);

async function scanDirectory(
  directory: FileSystemDirectoryHandle,
  projectId: string,
  prefix = "",
): Promise<{ tree: TreeNode[]; files: DocFile[] }> {
  const tree: TreeNode[] = [];
  const files: DocFile[] = [];

  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === "directory" && IGNORED_DIRECTORIES.has(name)) continue;
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      const child = await scanDirectory(handle, projectId, path);
      if (child.tree.length) {
        tree.push({ type: "folder", name, path, children: child.tree });
        files.push(...child.files);
      }
    } else if (name.toLowerCase().endsWith(".md")) {
      const doc: DocFile = {
        id: `${projectId}:${path}`,
        name,
        path,
        projectId,
        handle,
      };
      tree.push({ type: "file", name, path, doc });
      files.push(doc);
    }
  }

  tree.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN", { numeric: true });
  });
  return { tree, files };
}

export function supportsDirectoryPicker() {
  return isDesktop() || typeof window.showDirectoryPicker === "function";
}

export function isDesktop() {
  return "__TAURI_INTERNALS__" in window;
}

export function projectFromPath(rootPath: string, id: string = crypto.randomUUID()) {
  return invoke<DocsProject>("scan_project", { rootPath, projectId: id });
}

export async function projectFromHandle(rootHandle: FileSystemDirectoryHandle, id: string = crypto.randomUUID()): Promise<DocsProject> {
  const { tree, files } = await scanDirectory(rootHandle, id);
  return { id, name: rootHandle.name, rootHandle, accessStatus: "granted", tree, files };
}

export async function pickProject(): Promise<DocsProject> {
  if (isDesktop()) {
    const selected = await open({ directory: true, multiple: false, title: "选择项目目录" });
    if (!selected || Array.isArray(selected)) throw new DOMException("已取消", "AbortError");
    return projectFromPath(selected);
  }
  if (!window.showDirectoryPicker) {
    throw new Error("当前浏览器不支持目录读取，请使用最新版 Chrome 或 Edge");
  }
  const rootHandle = await window.showDirectoryPicker({ mode: "readwrite" });
  return projectFromHandle(rootHandle);
}

export async function hasReadPermission(handle: FileSystemDirectoryHandle) {
  const permissionHandle = handle as FileSystemDirectoryHandle & { queryPermission(options: { mode: "read" | "readwrite" }): Promise<PermissionState> };
  return (await permissionHandle.queryPermission({ mode: "readwrite" })) === "granted";
}

export async function requestReadPermission(handle: FileSystemDirectoryHandle) {
  const permissionHandle = handle as FileSystemDirectoryHandle & { requestPermission(options: { mode: "read" | "readwrite" }): Promise<PermissionState> };
  return (await permissionHandle.requestPermission({ mode: "readwrite" })) === "granted";
}

export async function readDoc(doc: DocFile) {
  if (doc.nativePath) return invoke<{ content: string; lastModified: number }>("read_markdown", { path: doc.nativePath });
  if (!doc.handle) throw new Error("文件句柄不可用");
  const file = await doc.handle.getFile();
  return { content: await file.text(), lastModified: file.lastModified };
}

export async function writeDoc(doc: DocFile, content: string) {
  if (doc.nativePath) return invoke<number>("write_markdown", { path: doc.nativePath, content });
  if (!doc.handle) throw new Error("文件句柄不可用");
  const writable = await doc.handle.createWritable();
  await writable.write(content);
  await writable.close();
  return (await doc.handle.getFile()).lastModified;
}

export function resolveRelativePath(fromDocumentPath: string, relativePath: string) {
  const clean = decodeURIComponent(relativePath.split(/[?#]/)[0]);
  if (!clean || /^(?:[a-z]+:|\/|#)/i.test(clean)) return undefined;
  const parts = [...fromDocumentPath.split("/").slice(0, -1), ...clean.split("/")];
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  return normalized.join("/");
}

export async function getProjectFile(root: FileSystemDirectoryHandle, path: string) {
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error("无效文件路径");
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part);
  return directory.getFileHandle(fileName);
}

export async function createProjectDoc(project: DocsProject, path: string, content: string) {
  if (project.rootPath) return invoke<string>("create_markdown", { rootPath: project.rootPath, relativePath: path, content });
  if (!project.rootHandle) throw new Error("项目目录不可用");
  const parts = path.split("/").filter(Boolean);
  const rawName = parts.pop() || "feishu-document.md";
  const fileName = rawName.toLowerCase().endsWith(".md") ? rawName : `${rawName}.md`;
  let directory = project.rootHandle;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
  const dot = fileName.toLowerCase().endsWith(".md") ? fileName.length - 3 : fileName.length;
  const base = fileName.slice(0, dot);
  const extension = fileName.slice(dot);
  let finalName = fileName;
  for (let index = 1; ; index += 1) {
    try { await directory.getFileHandle(finalName); finalName = `${base} (${index})${extension}`; } catch { break; }
  }
  const handle = await directory.getFileHandle(finalName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
  return [...parts, finalName].join("/");
}

export function readNativeAsset(project: DocsProject, relativePath: string) {
  if (!project.rootPath) throw new Error("不是桌面项目");
  return invoke<string>("read_asset", { rootPath: project.rootPath, relativePath });
}

export async function copyText(content: string) {
  if (isDesktop()) return invoke<void>("copy_text", { content });
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(content);
  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("复制失败");
}

export function revealInFinder(doc: DocFile) {
  if (!doc.nativePath) throw new Error("仅桌面端支持在 Finder 中打开");
  return invoke<void>("reveal_in_finder", { path: doc.nativePath });
}

export function copyAbsolutePath(doc: DocFile) {
  if (!doc.nativePath) throw new Error("仅桌面端支持复制绝对路径");
  return invoke<void>("copy_path", { path: doc.nativePath });
}

export function renameMarkdown(doc: DocFile, newName: string) {
  if (!doc.nativePath) throw new Error("仅桌面端支持重命名");
  return invoke<string>("rename_markdown", { path: doc.nativePath, newName });
}

export function exportDocument(outputPath: string, format: "pdf" | "docx", title: string, html: string) {
  return invoke<string>("export_document", { outputPath, format, title, html });
}

export function writePdfFile(outputPath: string, base64Data: string) {
  return invoke<string>("write_pdf_file", { outputPath, base64Data });
}

export function openExternalLink(url: string) {
  if (isDesktop()) return invoke<void>("open_external_link", { url });
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve();
}

export function downloadUpdate(url: string, fileName: string) {
  if (!isDesktop()) throw new Error("自动下载更新仅支持桌面端");
  return invoke<string>("download_update", { url, fileName });
}
