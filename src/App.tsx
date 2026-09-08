import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { save as showSaveDialog } from "@tauri-apps/plugin-dialog";
import { ProjectPanel } from "./components/ProjectPanel";
import { Reader } from "./components/Reader";
import { Dialog } from "./components/Dialog";
import { LarkDialog } from "./components/LarkDialog";
import { QuickOpen } from "./components/QuickOpen";
import { copyAbsolutePath, createProjectDoc, createProjectEntry, downloadUpdate, exportDocument, hasReadPermission, isDesktop, moveProjectEntry, pickProject, projectFromHandle, projectFromPath, readDoc, renameMarkdown, renameProjectFolder, requestReadPermission, restoreTrashedEntry, revealInFinder, supportsDirectoryPicker, trashProjectEntry, writeDoc, writePdfFile } from "./file-system";
import { loadLarkBindings, saveLarkBindings, type LarkBinding } from "./lark";
import { forgetProject, loadStoredProjects, storeProject } from "./project-store";
import type { DocFile, DocsProject, ViewMode } from "./types";

type DeferredAction = { type: "open"; doc: DocFile } | { type: "remove"; projectId: string } | { type: "export"; doc: DocFile; format: "pdf" | "docx" };
type PendingDialog =
  | { kind: "unsaved"; action: DeferredAction }
  | { kind: "remove"; projectId: string; projectName: string }
  | { kind: "conflict"; diskContent: string; diskModified: number }
  | { kind: "rename"; doc: DocFile }
  | { kind: "create"; projectId: string; folderPath: string; entryType: "file" | "folder" }
  | { kind: "delete-entry"; projectId: string; path: string; name: string; entryType: "file" | "folder" }
  | { kind: "rename-folder"; projectId: string; path: string; name: string }
  | { kind: "shortcuts" };
type UpdateInfo = { version: string; url: string; fileName: string };

function readStoredList(key: string) {
  try { return JSON.parse(localStorage.getItem(key) ?? "[]") as string[]; } catch { return []; }
}

export default function App() {
  const [projects, setProjects] = useState<DocsProject[]>([]);
  const [activeDoc, setActiveDoc] = useState<DocFile>();
  const [source, setSource] = useState("");
  const [savedSource, setSavedSource] = useState("");
  const [loadedLastModified, setLoadedLastModified] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [dialog, setDialog] = useState<PendingDialog>();
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => readStoredList("zdocs:favorites"));
  const [recentIds, setRecentIds] = useState<string[]>(() => readStoredList("zdocs:recent"));
  const [theme, setTheme] = useState<"light" | "dark">(() => localStorage.getItem("zdocs:theme") === "dark" ? "dark" : "light");
  const [larkOpen, setLarkOpen] = useState(false);
  const [larkBindings, setLarkBindings] = useState<Record<string, LarkBinding>>(() => loadLarkBindings());
  const [mode, setMode] = useState<ViewMode>(() => (localStorage.getItem("zdocs:view-mode") as ViewMode) || "source");
  const [notice, setNotice] = useState<string>();
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem("zdocs:sidebar-width")) || 276);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("zdocs:sidebar-collapsed") === "true");
  const [renameValue, setRenameValue] = useState("");
  const [createValue, setCreateValue] = useState("");
  const [temporaryFolderKeys, setTemporaryFolderKeys] = useState<string[]>([]);
  const [openTabIds, setOpenTabIds] = useState<string[]>(() => readStoredList("zdocs:open-tabs"));
  const [closedTabIds, setClosedTabIds] = useState<string[]>([]);
  const [quickOpen, setQuickOpen] = useState(false);
  const [navigation, setNavigation] = useState<{ ids: string[]; index: number }>({ ids: [], index: -1 });
  const [trashedEntry, setTrashedEntry] = useState<{ projectId: string; path: string; trashPath: string }>();
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo>();
  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);
  const dragStart = useRef<{ x: number; width: number } | undefined>(undefined);

  useEffect(() => localStorage.setItem("zdocs:view-mode", mode), [mode]);
  useEffect(() => localStorage.setItem("zdocs:sidebar-width", String(sidebarWidth)), [sidebarWidth]);
  useEffect(() => localStorage.setItem("zdocs:sidebar-collapsed", String(sidebarCollapsed)), [sidebarCollapsed]);
  useEffect(() => localStorage.setItem("zdocs:favorites", JSON.stringify(favoriteIds)), [favoriteIds]);
  useEffect(() => localStorage.setItem("zdocs:recent", JSON.stringify(recentIds)), [recentIds]);
  useEffect(() => localStorage.setItem("zdocs:theme", theme), [theme]);
  useEffect(() => localStorage.setItem("zdocs:open-tabs", JSON.stringify(openTabIds)), [openTabIds]);
  useEffect(() => saveLarkBindings(larkBindings), [larkBindings]);
  useEffect(() => {
    if (!isDesktop()) return;
    let cancelled = false;
    const check = async () => {
      try {
        const current = await getVersion();
        const response = await fetch("https://api.github.com/repos/zdpeazy/zdocs-reader/releases/latest", { headers: { Accept: "application/vnd.github+json" } });
        if (!response.ok) return;
        const release = await response.json() as { tag_name?: string; html_url?: string; assets?: Array<{ name: string; browser_download_url: string }> };
        const version = release.tag_name?.replace(/^v/i, "");
        const asset = release.assets?.find((item) => /aarch64\.dmg$/i.test(item.name)) ?? release.assets?.find((item) => /\.dmg$/i.test(item.name));
        if (!cancelled && version && asset && isNewerVersion(version, current) && localStorage.getItem("zdocs:dismissed-update") !== version) {
          setAvailableUpdate({ version, url: asset.browser_download_url, fileName: asset.name });
        }
      } catch { /* 离线时静默跳过，避免干扰本地阅读 */ }
    };
    void check();
    const timer = window.setInterval(check, 6 * 60 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    loadStoredProjects().then(async (stored) => {
      const projectOrder = readStoredList("zdocs:project-order");
      stored.sort((a, b) => {
        const aIndex = projectOrder.indexOf(a.id);
        const bIndex = projectOrder.indexOf(b.id);
        return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex);
      });
      const restored: DocsProject[] = [];
      for (const item of stored) {
        if (item.rootPath) {
          try { restored.push(await projectFromPath(item.rootPath, item.id)); } catch { restored.push({ id: item.id, name: item.name, rootPath: item.rootPath, accessStatus: "needs-permission", tree: [], files: [] }); }
        } else if (item.rootHandle && await hasReadPermission(item.rootHandle)) {
          restored.push(await projectFromHandle(item.rootHandle, item.id));
        } else if (item.rootHandle) {
          restored.push({ id: item.id, name: item.name, rootHandle: item.rootHandle, accessStatus: "needs-permission", tree: [], files: [] });
        }
      }
      if (cancelled) return;
      setProjects(restored);
      const lastDocId = localStorage.getItem("zdocs:last-doc");
      const lastDoc = restored.flatMap((project) => project.files).find((doc) => doc.id === lastDocId);
      if (lastDoc) await openDoc(lastDoc);
    }).catch(() => setNotice("项目记录恢复失败，请重新添加目录"));
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const protectUnsavedWork = (event: BeforeUnloadEvent) => {
      if (source === savedSource) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsavedWork);
    return () => window.removeEventListener("beforeunload", protectUnsavedWork);
  }, [source, savedSource]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".search-box input")?.focus();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setQuickOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        document.querySelector<HTMLButtonElement>(".save-button.dirty")?.click();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        document.querySelector<HTMLButtonElement>('.icon-button[aria-label="添加项目"]')?.click();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    if (!activeDoc || source !== savedSource) return;
    const timer = window.setInterval(async () => {
      try {
        const disk = await readDoc(activeDoc);
        if (disk.lastModified !== loadedLastModified) {
          setSource(disk.content);
          setSavedSource(disk.content);
          setLoadedLastModified(disk.lastModified);
          setNotice("检测到外部修改，已重新加载");
          window.setTimeout(() => setNotice(undefined), 1800);
        }
      } catch { /* permission recovery UI handles inaccessible projects */ }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [activeDoc, source, savedSource, loadedLastModified]);

  async function addProject() {
    try {
      const project = await pickProject();
      if (projects.some((item) => item.name === project.name)) {
        setNotice(`项目“${project.name}”已经添加`);
        return;
      }
      setProjects((current) => [...current, project]);
      localStorage.setItem("zdocs:project-order", JSON.stringify([...projects.map((item) => item.id), project.id]));
      await storeProject({ id: project.id, name: project.name, rootHandle: project.rootHandle, rootPath: project.rootPath });
      if (!activeDoc && project.files[0]) await performOpenDoc(project.files[0]);
      setNotice(undefined);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNotice(error instanceof Error ? error.message : "添加项目失败");
    }
  }

  async function performOpenDoc(doc: DocFile, recordNavigation = true) {
    try {
      const snapshot = await readDoc(doc);
      setSource(snapshot.content);
      setSavedSource(snapshot.content);
      setLoadedLastModified(snapshot.lastModified);
      setActiveDoc(doc);
      const storedMode = localStorage.getItem(`zdocs:view-mode:${doc.id}`) as ViewMode | null;
      if (storedMode === "source" || storedMode === "preview" || storedMode === "split") setMode(storedMode);
      setOpenTabIds((current) => current.includes(doc.id) ? current : [...current, doc.id]);
      if (recordNavigation) setNavigation((current) => {
        if (current.ids[current.index] === doc.id) return current;
        const ids = [...current.ids.slice(0, current.index + 1), doc.id].slice(-80);
        return { ids, index: ids.length - 1 };
      });
      setRecentIds((current) => [doc.id, ...current.filter((id) => id !== doc.id)].slice(0, 20));
      localStorage.setItem("zdocs:last-doc", doc.id);
      setNotice(undefined);
    } catch {
      setNotice("文档读取失败，请重新授权项目目录");
    }
  }

  function openDoc(doc: DocFile) {
    if (doc.id === activeDoc?.id) return;
    if (source !== savedSource) {
      setDialog({ kind: "unsaved", action: { type: "open", doc } });
      return;
    }
    void performOpenDoc(doc);
  }

  function navigateHistory(direction: -1 | 1) {
    const nextIndex = navigation.index + direction;
    const id = navigation.ids[nextIndex];
    const doc = projects.flatMap((project) => project.files).find((item) => item.id === id);
    if (!doc || source !== savedSource) return;
    setNavigation((current) => ({ ...current, index: nextIndex }));
    void performOpenDoc(doc, false);
  }

  function closeTabs(ids: string[]) {
    const targets = new Set(ids);
    if (activeDoc && targets.has(activeDoc.id) && source !== savedSource) { setNotice("请先保存当前文档再关闭标签"); return; }
    setOpenTabIds((current) => {
      const index = activeDoc ? current.indexOf(activeDoc.id) : -1;
      const closed = current.filter((item) => targets.has(item));
      const next = current.filter((item) => !targets.has(item));
      if (closed.length) setClosedTabIds((history) => [...history, ...closed].slice(-30));
      if (activeDoc && targets.has(activeDoc.id)) {
        const nextId = next[Math.min(index, next.length - 1)];
        const nextDoc = projects.flatMap((project) => project.files).find((doc) => doc.id === nextId);
        if (nextDoc) void performOpenDoc(nextDoc);
        else { setActiveDoc(undefined); setSource(""); setSavedSource(""); localStorage.removeItem("zdocs:last-doc"); }
      }
      return next;
    });
  }

  function closeTab(id: string) {
    closeTabs([id]);
  }

  async function reloadActiveDoc() {
    if (!activeDoc) return;
    if (source !== savedSource) { setNotice("当前文档有未保存修改，保存后才能重新载入"); return; }
    await performOpenDoc(activeDoc, false);
    setNotice("已重新载入当前文档");
    window.setTimeout(() => setNotice(undefined), 1400);
  }

  function switchTab(offset: number) {
    if (!openDocs.length || !activeDoc || source !== savedSource) return;
    const index = openDocs.findIndex((item) => item.id === activeDoc.id);
    const next = openDocs[(index + offset + openDocs.length) % openDocs.length];
    if (next && next.id !== activeDoc.id) void performOpenDoc(next);
  }

  function reopenClosedTab() {
    const id = [...closedTabIds].reverse().find((item) => !openTabIds.includes(item));
    const reopened = projects.flatMap((project) => project.files).find((item) => item.id === id);
    if (!reopened) { setNotice("没有可恢复的标签页"); return; }
    setClosedTabIds((history) => { const next = [...history]; next.splice(next.lastIndexOf(reopened.id), 1); return next; });
    openDoc(reopened);
  }

  function requestRemoveProject(id: string) {
    const project = projects.find((item) => item.id === id);
    if (!project) return;
    if (activeDoc?.projectId === id && source !== savedSource) {
      setDialog({ kind: "unsaved", action: { type: "remove", projectId: id } });
      return;
    }
    setDialog({ kind: "remove", projectId: id, projectName: project.name });
  }

  async function removeProject(id: string) {
    setProjects((current) => {
      const next = current.filter((item) => item.id !== id);
      localStorage.setItem("zdocs:project-order", JSON.stringify(next.map((item) => item.id)));
      return next;
    });
    await forgetProject(id);
    if (activeDoc?.projectId === id) {
      setActiveDoc(undefined);
      setSource("");
      setSavedSource("");
      setLoadedLastModified(0);
      localStorage.removeItem("zdocs:last-doc");
    }
  }

  async function restoreProject(id: string) {
    const project = projects.find((item) => item.id === id);
    if (!project) return;
    try {
      let restored: DocsProject;
      if (project.rootPath) {
        restored = await projectFromPath(project.rootPath, project.id);
      } else {
        if (!project.rootHandle || !(await requestReadPermission(project.rootHandle))) return;
        restored = await projectFromHandle(project.rootHandle, project.id);
      }
      setProjects((current) => current.map((item) => item.id === id ? restored : item));
      setNotice(`项目“${project.name}”已恢复`);
    } catch {
      setNotice("目录授权失败，请检查浏览器权限");
    }
  }

  async function refreshProjects() {
    try {
      const refreshed = await Promise.all(projects.map(async (project) => {
        if (project.accessStatus !== "granted") return project;
        if (project.rootPath) return projectFromPath(project.rootPath, project.id);
        if (project.rootHandle) return projectFromHandle(project.rootHandle, project.id);
        return project;
      }));
      setProjects(refreshed);
      setNotice("项目目录已重新扫描");
      window.setTimeout(() => setNotice(undefined), 1600);
    } catch {
      setNotice("部分项目扫描失败，请检查目录权限");
    }
  }

  async function refreshProject(project: DocsProject) {
    if (project.rootPath) return projectFromPath(project.rootPath, project.id);
    if (project.rootHandle) return projectFromHandle(project.rootHandle, project.id);
    return project;
  }

  function toggleFavorite() {
    if (!activeDoc) return;
    setFavoriteIds((current) => current.includes(activeDoc.id) ? current.filter((id) => id !== activeDoc.id) : [activeDoc.id, ...current]);
  }

  function changeViewMode(nextMode: ViewMode) {
    setMode(nextMode);
    if (activeDoc) localStorage.setItem(`zdocs:view-mode:${activeDoc.id}`, nextMode);
  }

  async function importFromLark(projectId: string, path: string, content: string, binding: LarkBinding) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) throw new Error("目标项目不存在或需要重新授权");
    const createdPath = await createProjectDoc(project, path, content);
    const refreshed = project.rootPath ? await projectFromPath(project.rootPath, project.id) : project.rootHandle ? await projectFromHandle(project.rootHandle, project.id) : project;
    setProjects((current) => current.map((item) => item.id === project.id ? refreshed : item));
    const doc = refreshed.files.find((item) => item.path === createdPath);
    if (doc) {
      setLarkBindings((current) => ({ ...current, [doc.id]: binding }));
      openDoc(doc);
    }
    setNotice("飞书文档已导入本地");
  }

  function bindPublishedDocument(binding: LarkBinding) {
    if (!activeDoc) return;
    setLarkBindings((current) => ({ ...current, [activeDoc.id]: binding }));
    setNotice("飞书文档发布成功");
    window.setTimeout(() => setNotice(undefined), 1800);
  }

  async function saveActiveDoc(force = false) {
    if (!activeDoc || source === savedSource) return true;
    try {
      setIsSaving(true);
      if (!force) {
        const disk = await readDoc(activeDoc);
        if (disk.lastModified !== loadedLastModified) {
          setDialog({ kind: "conflict", diskContent: disk.content, diskModified: disk.lastModified });
          return false;
        }
      }
      const lastModified = await writeDoc(activeDoc, source);
      setSavedSource(source);
      setLoadedLastModified(lastModified);
      setNotice("文档已保存");
      window.setTimeout(() => setNotice(undefined), 1600);
      return true;
    } catch {
      setNotice("保存失败，请重新添加项目并授予编辑权限");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function runDeferredAction(action: DeferredAction) {
    if (action.type === "open") await performOpenDoc(action.doc);
    else if (action.type === "remove") {
      const project = projects.find((item) => item.id === action.projectId);
      if (project) setDialog({ kind: "remove", projectId: project.id, projectName: project.name });
    } else await performExport(action.doc, action.format);
  }

  async function saveThenRun(action: DeferredAction) {
    setDialog(undefined);
    if (await saveActiveDoc()) await runDeferredAction(action);
  }

  const activeProject = projects.find((project) => project.id === activeDoc?.projectId);
  const allDocs = projects.flatMap((project) => project.files);
  const openDocs = openTabIds.map((id) => allDocs.find((doc) => doc.id === id)).filter((doc): doc is DocFile => Boolean(doc));

  function reorderProjects(draggedId: string, targetId: string, position: "before" | "after") {
    if (draggedId === targetId) return;
    setProjects((current) => {
      const from = current.findIndex((project) => project.id === draggedId);
      if (from < 0 || !current.some((project) => project.id === targetId)) return current;
      const next = [...current];
      const [dragged] = next.splice(from, 1);
      const targetIndex = next.findIndex((project) => project.id === targetId);
      next.splice(targetIndex + (position === "after" ? 1 : 0), 0, dragged);
      localStorage.setItem("zdocs:project-order", JSON.stringify(next.map((project) => project.id)));
      return next;
    });
  }

  async function performExport(doc: DocFile, format: "pdf" | "docx") {
    if (!isDesktop()) { setNotice("文档导出仅支持桌面端"); return; }
    const extension = format === "pdf" ? "pdf" : "docx";
    const baseName = doc.name.replace(/\.md$/i, "");
    const outputPath = await showSaveDialog({
      title: format === "pdf" ? "导出 PDF" : "导出 Word 文档",
      defaultPath: `${baseName}.${extension}`,
      filters: [{ name: format === "pdf" ? "PDF 文档" : "Word 文档", extensions: [extension] }],
    });
    if (!outputPath) return;
    if (doc.id !== activeDoc?.id) await performOpenDoc(doc);
    setMode("preview");
    setNotice(`正在生成 ${format === "pdf" ? "PDF" : "Word"} 文档…`);
    window.setTimeout(async () => {
      try {
        const article = document.querySelector<HTMLElement>(".preview-pane .markdown-body");
        if (!article) throw new Error("预览内容尚未准备完成，请重试");
        const savedPath = format === "pdf"
          ? await writePdfFile(outputPath, await createPdfBase64(article))
          : await exportDocument(outputPath, format, baseName, formatExportHtml(article));
        setNotice(`已导出到 ${savedPath}`);
        window.setTimeout(() => setNotice(undefined), 3500);
      } catch (error) { setNotice(error instanceof Error ? error.message : "导出失败"); }
    }, 1200);
  }

  function requestExport(doc: DocFile, format: "pdf" | "docx") {
    if (doc.id !== activeDoc?.id && source !== savedSource) {
      setDialog({ kind: "unsaved", action: { type: "export", doc, format } });
      return;
    }
    void performExport(doc, format);
  }

  async function submitRename(doc: DocFile) {
    const project = projects.find((item) => item.id === doc.projectId);
    if (!project) return;
    try {
      const newNativePath = await renameMarkdown(doc, renameValue);
      const refreshed = await refreshProject(project);
      const renamedDoc = refreshed.files.find((item) => item.nativePath === newNativePath);
      if (!renamedDoc) throw new Error("重命名后未找到文件");
      setProjects((current) => current.map((item) => item.id === project.id ? refreshed : item));
      setFavoriteIds((current) => current.map((id) => id === doc.id ? renamedDoc.id : id));
      setRecentIds((current) => current.map((id) => id === doc.id ? renamedDoc.id : id));
      setLarkBindings((current) => {
        if (!current[doc.id]) return current;
        const next = { ...current, [renamedDoc.id]: current[doc.id] };
        delete next[doc.id];
        return next;
      });
      if (activeDoc?.id === doc.id) { setActiveDoc(renamedDoc); localStorage.setItem("zdocs:last-doc", renamedDoc.id); }
      setDialog(undefined);
      setNotice(`已重命名为“${renamedDoc.name}”`);
      window.setTimeout(() => setNotice(undefined), 1800);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "重命名失败");
    }
  }

  function handleDocAction(action: "reveal" | "copy-path" | "rename" | "export-pdf" | "export-docx" | "delete", doc: DocFile) {
    if (action === "delete") { setDialog({ kind: "delete-entry", projectId: doc.projectId, path: doc.path, name: doc.name, entryType: "file" }); return; }
    if (action === "export-pdf" || action === "export-docx") { requestExport(doc, action === "export-pdf" ? "pdf" : "docx"); return; }
    if (action === "rename") { setRenameValue(doc.name); setDialog({ kind: "rename", doc }); return; }
    void (async () => {
      try {
        if (action === "reveal") await revealInFinder(doc);
        else { await copyAbsolutePath(doc); setNotice(`绝对路径已复制：${doc.nativePath}`); window.setTimeout(() => setNotice(undefined), 2600); }
      } catch (error) { setNotice(error instanceof Error ? error.message : "操作失败"); }
    })();
  }

  async function submitDeleteEntry(projectId: string, path: string, entryType: "file" | "folder") {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    try {
      const trashPath = await trashProjectEntry(project, path, entryType);
      const removesActive = activeDoc?.projectId === projectId && (entryType === "file" ? activeDoc.path === path : activeDoc.path.startsWith(`${path}/`));
      const refreshed = await refreshProject(project);
      setProjects((current) => current.map((item) => item.id === project.id ? refreshed : item));
      if (removesActive) { setActiveDoc(undefined); setSource(""); setSavedSource(""); localStorage.removeItem("zdocs:last-doc"); }
      setFavoriteIds((current) => current.filter((id) => refreshed.files.some((doc) => doc.id === id)));
      setRecentIds((current) => current.filter((id) => refreshed.files.some((doc) => doc.id === id)));
      if (entryType === "folder") setTemporaryFolderKeys((current) => current.filter((key) => key !== `${projectId}:${path}` && !key.startsWith(`${projectId}:${path}/`)));
      setDialog(undefined);
      if (trashPath) setTrashedEntry({ projectId, path, trashPath });
      setNotice(entryType === "file" ? "文档已移入废纸篓" : "文件夹已移入废纸篓");
      window.setTimeout(() => { setNotice(undefined); setTrashedEntry(undefined); }, 6500);
    } catch (error) { setNotice(error instanceof Error ? error.message : "删除失败"); }
  }

  async function undoTrash() {
    if (!trashedEntry) return;
    const project = projects.find((item) => item.id === trashedEntry.projectId);
    if (!project) return;
    try {
      await restoreTrashedEntry(project, trashedEntry.path, trashedEntry.trashPath);
      const refreshed = await refreshProject(project);
      setProjects((current) => current.map((item) => item.id === project.id ? refreshed : item));
      setTrashedEntry(undefined);
      setNotice("已恢复到原位置");
      window.setTimeout(() => setNotice(undefined), 1800);
    } catch (error) { setNotice(error instanceof Error ? error.message : "恢复失败"); }
  }

  async function moveEntry(projectId: string, sourcePath: string, targetFolder: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project || sourcePath.split("/").slice(0, -1).join("/") === targetFolder) return;
    try {
      const movedPath = await moveProjectEntry(project, sourcePath, targetFolder);
      const oldPrefix = `${projectId}:${sourcePath}`;
      const newPrefix = `${projectId}:${movedPath}`;
      const remapId = (id: string) => id === oldPrefix || id.startsWith(`${oldPrefix}/`) ? `${newPrefix}${id.slice(oldPrefix.length)}` : id;
      const activePath = activeDoc?.projectId === projectId && (activeDoc.path === sourcePath || activeDoc.path.startsWith(`${sourcePath}/`)) ? `${movedPath}${activeDoc.path.slice(sourcePath.length)}` : undefined;
      const refreshed = await refreshProject(project);
      setProjects((current) => current.map((item) => item.id === projectId ? refreshed : item));
      setFavoriteIds((current) => current.map(remapId));
      setRecentIds((current) => current.map(remapId));
      setOpenTabIds((current) => current.map(remapId));
      if (activePath) {
        const movedDoc = refreshed.files.find((doc) => doc.path === activePath);
        if (movedDoc) { setActiveDoc(movedDoc); localStorage.setItem("zdocs:last-doc", movedDoc.id); }
      }
      setNotice(`已移动到 ${targetFolder || project.name}`);
      window.setTimeout(() => setNotice(undefined), 1800);
    } catch (error) { setNotice(error instanceof Error ? error.message : "移动失败"); }
  }

  async function submitRenameFolder(projectId: string, path: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project || !renameValue.trim()) return;
    try {
      const renamedPath = await renameProjectFolder(project, path, renameValue);
      const oldPrefix = `${projectId}:${path}`;
      const newPrefix = `${projectId}:${renamedPath}`;
      const remapId = (id: string) => id === oldPrefix || id.startsWith(`${oldPrefix}/`) ? `${newPrefix}${id.slice(oldPrefix.length)}` : id;
      const activePath = activeDoc?.projectId === projectId && activeDoc.path.startsWith(`${path}/`) ? `${renamedPath}${activeDoc.path.slice(path.length)}` : undefined;
      const refreshed = await refreshProject(project);
      setProjects((current) => current.map((item) => item.id === projectId ? refreshed : item));
      setFavoriteIds((current) => current.map(remapId));
      setRecentIds((current) => current.map(remapId));
      setTemporaryFolderKeys((current) => current.map((key) => key === oldPrefix || key.startsWith(`${oldPrefix}/`) ? `${newPrefix}${key.slice(oldPrefix.length)}` : key));
      if (activePath) {
        const renamedDoc = refreshed.files.find((doc) => doc.path === activePath);
        if (renamedDoc) { setActiveDoc(renamedDoc); localStorage.setItem("zdocs:last-doc", renamedDoc.id); }
      }
      setDialog(undefined);
      setNotice(`文件夹已重命名为“${renameValue.trim()}”`);
      window.setTimeout(() => setNotice(undefined), 2200);
    } catch (error) { setNotice(error instanceof Error ? error.message : "文件夹重命名失败"); }
  }

  function requestCreateEntry(projectId: string, folderPath: string, entryType: "file" | "folder") {
    setCreateValue("");
    setDialog({ kind: "create", projectId, folderPath, entryType });
  }

  async function submitCreateEntry(projectId: string, folderPath: string, entryType: "file" | "folder") {
    const project = projects.find((item) => item.id === projectId);
    if (!project || !createValue.trim()) return;
    try {
      const createdPath = await createProjectEntry(project, folderPath, createValue, entryType);
      const refreshed = await refreshProject(project);
      setProjects((current) => current.map((item) => item.id === project.id ? refreshed : item));
      setDialog(undefined);
      if (entryType === "folder") setTemporaryFolderKeys((current) => [...new Set([...current, `${projectId}:${createdPath}`])]);
      if (entryType === "file" && source === savedSource) {
        const created = refreshed.files.find((item) => item.path === createdPath);
        if (created) await performOpenDoc(created);
      }
      setNotice(entryType === "file" ? `已创建 ${createdPath}` : `已创建文件夹 ${createdPath}`);
      window.setTimeout(() => setNotice(undefined), 2200);
    } catch (error) { setNotice(error instanceof Error ? error.message : "创建失败"); }
  }

  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    dragStart.current = { x: event.clientX, width: sidebarWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing");
  }

  function resize(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const nextWidth = dragStart.current.width + event.clientX - dragStart.current.x;
    setSidebarWidth(Math.min(520, Math.max(220, nextWidth)));
  }

  function stopResize(event: React.PointerEvent<HTMLDivElement>) {
    dragStart.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.classList.remove("is-resizing");
  }

  useEffect(() => {
    const handleNavigationShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.metaKey && !event.ctrlKey) {
        if (key === "r") { event.preventDefault(); void reloadActiveDoc(); return; }
        if (key === "w") { event.preventDefault(); if (activeDoc) closeTab(activeDoc.id); return; }
        if (key === "t") { event.preventDefault(); if (event.shiftKey) reopenClosedTab(); else setQuickOpen(true); return; }
        if (key === "l") { event.preventDefault(); setQuickOpen(true); return; }
        if (/^[1-9]$/.test(key) && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          const index = key === "9" ? openDocs.length - 1 : Number(key) - 1;
          const target = openDocs[index];
          if (target) openDoc(target);
          return;
        }
        if ((key === "[" || key === "]") && event.shiftKey) { event.preventDefault(); switchTab(key === "[" ? -1 : 1); return; }
        if ((event.altKey && (key === "arrowleft" || key === "arrowright"))) { event.preventDefault(); switchTab(key === "arrowleft" ? -1 : 1); return; }
        if ((key === "[" || key === "]") && !event.shiftKey) { event.preventDefault(); navigateHistory(key === "[" ? -1 : 1); }
      }
      if (event.ctrlKey && !event.metaKey && key === "tab") { event.preventDefault(); switchTab(event.shiftKey ? -1 : 1); }
    };
    window.addEventListener("keydown", handleNavigationShortcut);
    return () => window.removeEventListener("keydown", handleNavigationShortcut);
  }, [navigation, projects, source, savedSource, activeDoc, openDocs, closedTabIds, openTabIds]);

  return (
    <div className={`app-shell theme-${theme}`}>
      <ProjectPanel width={sidebarWidth} collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed((value) => !value)} projects={projects} activeId={activeDoc?.id} onAdd={addProject} onOpen={openDoc} onRemove={requestRemoveProject} onRestore={restoreProject} onRefresh={refreshProjects} onReorder={reorderProjects} onDocAction={handleDocAction} onCreateEntry={requestCreateEntry} onDeleteFolder={(projectId, path, name) => setDialog({ kind: "delete-entry", projectId, path, name, entryType: "folder" })} onRenameFolder={(projectId, path, name) => { setRenameValue(name); setDialog({ kind: "rename-folder", projectId, path, name }); }} temporaryFolderKeys={temporaryFolderKeys} onMoveEntry={moveEntry} favoriteIds={favoriteIds} recentIds={recentIds} theme={theme} onToggleTheme={() => setTheme((value) => value === "light" ? "dark" : "light")} onShowShortcuts={() => setDialog({ kind: "shortcuts" })} onOpenLark={() => setLarkOpen(true)} />
      <div
        className={`sidebar-resizer ${sidebarCollapsed ? "hidden" : ""}`}
        role="separator"
        aria-label="调整目录宽度"
        aria-orientation="vertical"
        aria-valuemin={220}
        aria-valuemax={520}
        aria-valuenow={Math.round(sidebarWidth)}
        tabIndex={0}
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
        onDoubleClick={() => setSidebarWidth(276)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") setSidebarWidth((value) => Math.max(220, value - 10));
          if (event.key === "ArrowRight") setSidebarWidth((value) => Math.min(520, value + 10));
        }}
      />
      <Reader doc={activeDoc} project={activeProject} source={source} mode={mode} onModeChange={changeViewMode} onSourceChange={setSource} onSave={saveActiveDoc} isDirty={source !== savedSource} isSaving={isSaving} isFavorite={Boolean(activeDoc && favoriteIds.includes(activeDoc.id))} onToggleFavorite={toggleFavorite} onOpenDoc={openDoc} theme={theme} openDocs={openDocs} onCloseTab={closeTab} onCloseTabs={closeTabs} canGoBack={navigation.index > 0} canGoForward={navigation.index >= 0 && navigation.index < navigation.ids.length - 1} onNavigate={navigateHistory} />
      {quickOpen && <QuickOpen projects={projects} onOpen={openDoc} onClose={() => setQuickOpen(false)} />}
      {availableUpdate && <div className="update-banner" role="status"><span><strong>发现新版本 v{availableUpdate.version}</strong><small>已发布到 GitHub</small></span><button type="button" disabled={isDownloadingUpdate} onClick={() => { setIsDownloadingUpdate(true); setNotice("正在下载更新包…"); void downloadUpdate(availableUpdate.url, availableUpdate.fileName).then((path) => { setNotice(`更新包已下载并打开：${path}`); }).catch((error) => setNotice(error instanceof Error ? error.message : "更新下载失败")).finally(() => setIsDownloadingUpdate(false)); }}>{isDownloadingUpdate ? "下载中…" : "下载更新"}</button><button className="update-dismiss" type="button" aria-label="暂不更新" onClick={() => { localStorage.setItem("zdocs:dismissed-update", availableUpdate.version); setAvailableUpdate(undefined); }}>×</button></div>}
      {notice && <div className="toast" role="alert"><span>{notice}</span>{trashedEntry && <button className="toast-action" type="button" onClick={() => void undoTrash()}>撤销</button>}<button type="button" onClick={() => { setNotice(undefined); setTrashedEntry(undefined); }}>×</button></div>}
      {!supportsDirectoryPicker() && !isDesktop() && <div className="browser-warning">请使用 Chrome 或 Edge 打开，以授权读取本地项目目录。</div>}
      {dialog?.kind === "unsaved" && <Dialog title="文档尚未保存" description="继续操作前，要保存当前修改吗？" onClose={() => setDialog(undefined)} actions={[
        { label: "取消", onClick: () => setDialog(undefined) },
        { label: "不保存并继续", variant: "danger", onClick: () => { const action = dialog.action; setDialog(undefined); void runDeferredAction(action); } },
        { label: "保存并继续", variant: "primary", onClick: () => void saveThenRun(dialog.action) },
      ]} />}
      {dialog?.kind === "remove" && <Dialog title="从列表移除项目？" description={<>将移除项目“<strong>{dialog.projectName}</strong>”的记录，不会删除本地目录或任何文件。</>} onClose={() => setDialog(undefined)} actions={[
        { label: "取消", onClick: () => setDialog(undefined) },
        { label: "移除项目", variant: "danger", onClick: () => { const id = dialog.projectId; setDialog(undefined); void removeProject(id); } },
      ]} />}
      {dialog?.kind === "conflict" && <Dialog title="文件已在其他位置修改" description="磁盘上的文件比当前编辑版本更新。请选择保留哪个版本，避免覆盖重要内容。" onClose={() => setDialog(undefined)} actions={[
        { label: "取消", onClick: () => setDialog(undefined) },
        { label: "重新加载磁盘版本", onClick: () => { setSource(dialog.diskContent); setSavedSource(dialog.diskContent); setLoadedLastModified(dialog.diskModified); setDialog(undefined); } },
        { label: "用当前内容覆盖", variant: "danger", onClick: () => { setDialog(undefined); void saveActiveDoc(true); } },
      ]} />}
      {dialog?.kind === "rename" && <Dialog title="重命名文档" description={<label className="rename-field"><span>文件名</span><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onFocus={(event) => { const dot = event.currentTarget.value.toLowerCase().lastIndexOf(".md"); event.currentTarget.setSelectionRange(0, dot > 0 ? dot : event.currentTarget.value.length); }} onKeyDown={(event) => { if (event.key === "Enter" && renameValue.trim()) void submitRename(dialog.doc); }} /></label>} onClose={() => setDialog(undefined)} actions={[
        { label: "取消", onClick: () => setDialog(undefined) },
        { label: "确认重命名", variant: "primary", onClick: () => void submitRename(dialog.doc) },
      ]} />}
      {dialog?.kind === "rename-folder" && <Dialog title="重命名文件夹" description={<label className="rename-field"><span>文件夹名称</span><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onFocus={(event) => event.currentTarget.select()} onKeyDown={(event) => { if (event.key === "Enter" && renameValue.trim()) void submitRenameFolder(dialog.projectId, dialog.path); }} /></label>} onClose={() => setDialog(undefined)} actions={[
        { label: "取消", onClick: () => setDialog(undefined) },
        { label: "确认重命名", variant: "primary", onClick: () => void submitRenameFolder(dialog.projectId, dialog.path) },
      ]} />}
      {dialog?.kind === "create" && <Dialog title={dialog.entryType === "file" ? "新建 Markdown" : "新建文件夹"} description={<label className="rename-field"><span>{dialog.folderPath || "项目根目录"}</span><input autoFocus value={createValue} placeholder={dialog.entryType === "file" ? "例如：接口说明.md" : "例如：设计文档"} onChange={(event) => setCreateValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && createValue.trim()) void submitCreateEntry(dialog.projectId, dialog.folderPath, dialog.entryType); }} /></label>} onClose={() => setDialog(undefined)} actions={[
        { label: "取消", onClick: () => setDialog(undefined) },
        { label: "创建", variant: "primary", onClick: () => void submitCreateEntry(dialog.projectId, dialog.folderPath, dialog.entryType) },
      ]} />}
      {dialog?.kind === "delete-entry" && <Dialog title={dialog.entryType === "file" ? "将文档移入废纸篓？" : "将文件夹移入废纸篓？"} description={dialog.entryType === "file" ? <>文档“<strong>{dialog.name}</strong>”将移入 macOS 废纸篓，操作完成后可立即撤销。</> : <>文件夹“<strong>{dialog.name}</strong>”及其中所有内容将移入 macOS 废纸篓，操作完成后可立即撤销。</>} onClose={() => setDialog(undefined)} actions={[
        { label: "取消", onClick: () => setDialog(undefined) },
        { label: "确认删除", variant: "danger", onClick: () => void submitDeleteEntry(dialog.projectId, dialog.path, dialog.entryType) },
      ]} />}
      {dialog?.kind === "shortcuts" && <Dialog title="快捷键" description={<div className="shortcut-list"><span>快速打开文档 <kbd>⌘ T / ⌘ P</kbd></span><span>全局搜索 <kbd>⌘ K</kbd></span><span>重新载入当前文档 <kbd>⌘ R</kbd></span><span>关闭当前标签页 <kbd>⌘ W</kbd></span><span>恢复关闭的标签页 <kbd>⌘ ⇧ T</kbd></span><span>切换指定标签页 <kbd>⌘ 1…9</kbd></span><span>上一个 / 下一个标签页 <kbd>⌃ ⇧ Tab / ⌃ Tab</kbd></span><span>后退 / 前进 <kbd>⌘ [ / ⌘ ]</kbd></span><span>添加项目 <kbd>⌘ O</kbd></span><span>保存文档 <kbd>⌘ S</kbd></span><span>编辑器查找 <kbd>⌘ F</kbd></span><span>关闭弹窗 <kbd>Esc</kbd></span></div>} onClose={() => setDialog(undefined)} actions={[{ label: "知道了", variant: "primary", onClick: () => setDialog(undefined) }]} />}
      {larkOpen && <LarkDialog projects={projects} activeDoc={activeDoc} source={source} binding={activeDoc ? larkBindings[activeDoc.id] : undefined} onClose={() => setLarkOpen(false)} onImported={importFromLark} onPublished={bindPublishedDocument} />}
    </div>
  );
}

function isNewerVersion(latest: string, current: string) {
  const left = latest.split(".").map((value) => Number(value) || 0);
  const right = current.split(".").map((value) => Number(value) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) > (right[index] || 0);
  }
  return false;
}

function formatExportHtml(article: HTMLElement) {
  const clone = article.cloneNode(true) as HTMLElement;
  const originals = [article, ...Array.from(article.querySelectorAll<HTMLElement>("*"))];
  const copies = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))];
  const properties = ["display", "color", "background-color", "font-family", "font-size", "font-weight", "font-style", "line-height", "text-align", "text-decoration", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left", "border-top", "border-right", "border-bottom", "border-left", "border-radius", "width", "max-width", "vertical-align", "white-space", "list-style-type"];
  originals.forEach((element, index) => {
    const target = copies[index];
    if (!target) return;
    const computed = window.getComputedStyle(element);
    properties.forEach((property) => target.style.setProperty(property, computed.getPropertyValue(property)));
    target.removeAttribute("class");
  });
  return clone.innerHTML;
}

async function createPdfBase64(article: HTMLElement) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  await Promise.all(Array.from(article.querySelectorAll("img")).map((image) => image.complete ? Promise.resolve() : new Promise<void>((resolve) => { image.addEventListener("load", () => resolve(), { once: true }); image.addEventListener("error", () => resolve(), { once: true }); })));
  const canvas = await html2canvas(article, { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false });
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: true });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 32;
  const printableWidth = pageWidth - margin * 2;
  const printableHeight = pageHeight - margin * 2;
  const scale = printableWidth / canvas.width;
  const sliceHeight = Math.max(1, Math.floor(printableHeight / scale));
  let page = 0;
  for (let top = 0; top < canvas.height; top += sliceHeight) {
    const height = Math.min(sliceHeight, canvas.height - top);
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = height;
    slice.getContext("2d")?.drawImage(canvas, 0, top, canvas.width, height, 0, 0, canvas.width, height);
    if (page > 0) pdf.addPage();
    pdf.addImage(slice.toDataURL("image/jpeg", .94), "JPEG", margin, margin, printableWidth, height * scale, undefined, "FAST");
    page += 1;
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  const bytes = new Uint8Array(pdf.output("arraybuffer"));
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
