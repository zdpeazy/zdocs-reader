import { useEffect, useRef, useState } from "react";
import { ProjectPanel } from "./components/ProjectPanel";
import { Reader } from "./components/Reader";
import { Dialog } from "./components/Dialog";
import { LarkDialog } from "./components/LarkDialog";
import { createProjectDoc, hasReadPermission, isDesktop, pickProject, projectFromHandle, projectFromPath, readDoc, requestReadPermission, supportsDirectoryPicker, writeDoc } from "./file-system";
import { loadLarkBindings, saveLarkBindings, type LarkBinding } from "./lark";
import { forgetProject, loadStoredProjects, storeProject } from "./project-store";
import type { DocFile, DocsProject, ViewMode } from "./types";

type DeferredAction = { type: "open"; doc: DocFile } | { type: "remove"; projectId: string };
type PendingDialog =
  | { kind: "unsaved"; action: DeferredAction }
  | { kind: "remove"; projectId: string; projectName: string }
  | { kind: "conflict"; diskContent: string; diskModified: number }
  | { kind: "shortcuts" };

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
  const dragStart = useRef<{ x: number; width: number } | undefined>(undefined);

  useEffect(() => localStorage.setItem("zdocs:view-mode", mode), [mode]);
  useEffect(() => localStorage.setItem("zdocs:sidebar-width", String(sidebarWidth)), [sidebarWidth]);
  useEffect(() => localStorage.setItem("zdocs:favorites", JSON.stringify(favoriteIds)), [favoriteIds]);
  useEffect(() => localStorage.setItem("zdocs:recent", JSON.stringify(recentIds)), [recentIds]);
  useEffect(() => localStorage.setItem("zdocs:theme", theme), [theme]);
  useEffect(() => saveLarkBindings(larkBindings), [larkBindings]);
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

  async function performOpenDoc(doc: DocFile) {
    try {
      const snapshot = await readDoc(doc);
      setSource(snapshot.content);
      setSavedSource(snapshot.content);
      setLoadedLastModified(snapshot.lastModified);
      setActiveDoc(doc);
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

  function toggleFavorite() {
    if (!activeDoc) return;
    setFavoriteIds((current) => current.includes(activeDoc.id) ? current.filter((id) => id !== activeDoc.id) : [activeDoc.id, ...current]);
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
    else {
      const project = projects.find((item) => item.id === action.projectId);
      if (project) setDialog({ kind: "remove", projectId: project.id, projectName: project.name });
    }
  }

  async function saveThenRun(action: DeferredAction) {
    setDialog(undefined);
    if (await saveActiveDoc()) await runDeferredAction(action);
  }

  const activeProject = projects.find((project) => project.id === activeDoc?.projectId);

  function reorderProjects(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    setProjects((current) => {
      const from = current.findIndex((project) => project.id === draggedId);
      const to = current.findIndex((project) => project.id === targetId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [dragged] = next.splice(from, 1);
      next.splice(to, 0, dragged);
      localStorage.setItem("zdocs:project-order", JSON.stringify(next.map((project) => project.id)));
      return next;
    });
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

  return (
    <div className={`app-shell theme-${theme}`}>
      <ProjectPanel width={sidebarWidth} projects={projects} activeId={activeDoc?.id} onAdd={addProject} onOpen={openDoc} onRemove={requestRemoveProject} onRestore={restoreProject} onRefresh={refreshProjects} onReorder={reorderProjects} favoriteIds={favoriteIds} recentIds={recentIds} theme={theme} onToggleTheme={() => setTheme((value) => value === "light" ? "dark" : "light")} onShowShortcuts={() => setDialog({ kind: "shortcuts" })} onOpenLark={() => setLarkOpen(true)} />
      <div
        className="sidebar-resizer"
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
      <Reader doc={activeDoc} project={activeProject} source={source} mode={mode} onModeChange={setMode} onSourceChange={setSource} onSave={saveActiveDoc} isDirty={source !== savedSource} isSaving={isSaving} isFavorite={Boolean(activeDoc && favoriteIds.includes(activeDoc.id))} onToggleFavorite={toggleFavorite} onOpenDoc={openDoc} theme={theme} />
      {notice && <div className="toast" role="alert"><span>{notice}</span><button type="button" onClick={() => setNotice(undefined)}>×</button></div>}
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
      {dialog?.kind === "shortcuts" && <Dialog title="快捷键" description={<div className="shortcut-list"><span>全局搜索 <kbd>⌘ K</kbd></span><span>添加项目 <kbd>⌘ O</kbd></span><span>保存文档 <kbd>⌘ S</kbd></span><span>关闭弹窗 <kbd>Esc</kbd></span><span>编辑器查找 <kbd>⌘ F</kbd></span></div>} onClose={() => setDialog(undefined)} actions={[{ label: "知道了", variant: "primary", onClick: () => setDialog(undefined) }]} />}
      {larkOpen && <LarkDialog projects={projects} activeDoc={activeDoc} source={source} binding={activeDoc ? larkBindings[activeDoc.id] : undefined} onClose={() => setLarkOpen(false)} onImported={importFromLark} onPublished={bindPublishedDocument} />}
    </div>
  );
}
