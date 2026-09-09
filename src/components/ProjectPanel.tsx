import { ChevronDown, ChevronRight, CircleHelp, Clock3, Cloud, Copy, FileOutput, FilePlus2, FileText, FolderOpen, FolderPlus, GripVertical, KeyRound, Moon, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RefreshCw, Search, Star, Sun, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { readDoc } from "../file-system";
import type { DocFile, DocsProject, TreeNode } from "../types";
import { Tree } from "./Tree";

interface ProjectPanelProps {
  width: number;
  projects: DocsProject[];
  activeId?: string;
  revealTarget?: { docId: string; request: number };
  onAdd: () => void;
  onOpen: (doc: DocFile) => void;
  onRemove: (projectId: string) => void;
  onRestore: (projectId: string) => void;
  onRefresh: () => void;
  onReorder: (draggedId: string, targetId: string, position: "before" | "after") => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onDocAction: (action: "reveal" | "copy-path" | "rename" | "export-pdf" | "export-docx" | "delete", doc: DocFile) => void;
  onCreateEntry: (projectId: string, folderPath: string, kind: "file" | "folder") => void;
  onDeleteFolder: (projectId: string, folderPath: string, name: string) => void;
  onRenameFolder: (projectId: string, folderPath: string, name: string) => void;
  temporaryFolderKeys: string[];
  onMoveEntry: (projectId: string, sourcePath: string, targetFolder: string) => void;
  favoriteIds: string[];
  recentIds: string[];
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onShowShortcuts: () => void;
  onOpenLark: () => void;
}

export function ProjectPanel({ width, projects, activeId, revealTarget, onAdd, onOpen, onRemove, onRestore, onRefresh, onReorder, collapsed, onToggleCollapsed, onDocAction, onCreateEntry, onDeleteFolder, onRenameFolder, temporaryFolderKeys, onMoveEntry, favoriteIds, recentIds, theme, onToggleTheme, onShowShortcuts, onOpenLark }: ProjectPanelProps) {
  const [query, setQuery] = useState("");
  const [contentMatches, setContentMatches] = useState<Set<string>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [draggingId, setDraggingId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<{ id: string; position: "before" | "after" }>();
  const draggingRef = useRef<string | undefined>(undefined);
  const dropTargetRef = useRef<{ id: string; position: "before" | "after" } | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; doc: DocFile }>();
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; projectId: string; path: string; name: string }>();
  const [showEmptyFolders, setShowEmptyFolders] = useState(() => localStorage.getItem("zdocs:show-empty-folders") === "true");
  const normalized = query.trim().toLowerCase();
  const allFiles = useMemo(() => projects.flatMap((project) => project.files), [projects]);
  const filesById = useMemo(() => new Map(allFiles.map((doc) => [doc.id, doc])), [allFiles]);
  const favoriteDocs = favoriteIds.map((id) => filesById.get(id)).filter((doc): doc is DocFile => Boolean(doc)).slice(0, 6);
  const recentDocs = recentIds.map((id) => filesById.get(id)).filter((doc): doc is DocFile => Boolean(doc)).slice(0, 3);
  const activeProjectId = activeId ? filesById.get(activeId)?.projectId : undefined;

  useEffect(() => {
    if (normalized.length < 2) { setContentMatches(new Set()); setIsSearching(false); return; }
    let cancelled = false;
    setIsSearching(true);
    const timer = window.setTimeout(async () => {
      const matches = new Set<string>();
      await Promise.all(allFiles.map(async (doc) => {
        if (doc.path.toLowerCase().includes(normalized)) return;
        try { if ((await readDoc(doc)).content.toLowerCase().includes(normalized)) matches.add(doc.id); } catch { /* permission state is shown separately */ }
      }));
      if (!cancelled) { setContentMatches(matches); setIsSearching(false); }
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [allFiles, normalized]);
  const filterTree = (nodes: TreeNode[]): TreeNode[] => nodes.reduce<TreeNode[]>((result, node) => {
    if (node.type === "file") {
      if (node.path.toLowerCase().includes(normalized) || contentMatches.has(node.doc.id)) result.push(node);
      return result;
    }
    const children = filterTree(node.children);
    if (children.length) result.push({ ...node, children });
    return result;
  }, []);
  const visible = useMemo(() => projects.map((project) => {
    const keepUsefulFolders = (nodes: TreeNode[]): TreeNode[] => nodes.reduce<TreeNode[]>((result, node) => {
      if (node.type === "file") { result.push(node); return result; }
      const children = keepUsefulFolders(node.children);
      const key = `${project.id}:${node.path}`;
      const containsTemporary = temporaryFolderKeys.some((item) => item === key || item.startsWith(`${key}/`));
      if (showEmptyFolders || children.length || containsTemporary) result.push({ ...node, children });
      return result;
    }, []);
    const usefulTree = keepUsefulFolders(project.tree);
    return { ...project, tree: normalized ? filterTree(usefulTree) : usefulTree };
  }), [projects, normalized, contentMatches, showEmptyFolders, temporaryFolderKeys]);
  const hasSearchResults = visible.some((project) => project.tree.length > 0);

  useEffect(() => {
    if (!revealTarget) return;
    setQuery("");
    const reveal = () => document.querySelector<HTMLElement>(`[data-doc-id="${CSS.escape(revealTarget.docId)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    const first = window.setTimeout(reveal, 40);
    const second = window.setTimeout(reveal, 180);
    return () => { window.clearTimeout(first); window.clearTimeout(second); };
  }, [revealTarget]);

  useEffect(() => {
    if (!contextMenu && !folderMenu) return;
    const close = () => { setContextMenu(undefined); setFolderMenu(undefined); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); window.removeEventListener("keydown", onKey); };
  }, [contextMenu, folderMenu]);

  function showDocMenu(event: React.MouseEvent, doc: DocFile) {
    event.preventDefault();
    setFolderMenu(undefined);
    const menuWidth = 218;
    const menuHeight = 260;
    setContextMenu({ x: Math.min(event.clientX, window.innerWidth - menuWidth - 8), y: Math.min(event.clientY, window.innerHeight - menuHeight - 8), doc });
  }

  function showFolderMenu(event: React.MouseEvent, projectId: string, path: string, name: string) {
    event.preventDefault();
    setContextMenu(undefined);
    setFolderMenu({ x: Math.min(event.clientX, window.innerWidth - 218), y: Math.min(event.clientY, window.innerHeight - 180), projectId, path, name });
  }

  function moveProject(event: React.PointerEvent<HTMLButtonElement>) {
    if (!draggingRef.current) return;
    const shell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-project-id]");
    const id = shell?.dataset.projectId;
    if (!id || id === draggingRef.current) { dropTargetRef.current = undefined; setDropTarget(undefined); return; }
    const position = event.clientY < shell.getBoundingClientRect().top + shell.offsetHeight / 2 ? "before" : "after";
    dropTargetRef.current = { id, position };
    setDropTarget({ id, position });
  }

  function stopProjectDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const draggedId = draggingRef.current;
    const target = dropTargetRef.current;
    if (draggedId && target) onReorder(draggedId, target.id, target.position);
    draggingRef.current = undefined;
    dropTargetRef.current = undefined;
    setDraggingId(undefined);
    setDropTarget(undefined);
    document.body.classList.remove("is-project-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`} style={{ width: collapsed ? 52 : width, flexBasis: collapsed ? 52 : width }}>
      <div className="brand-row">
        <div className="brand-mark">Z</div>
        {!collapsed && <><div><strong>ZDocs</strong><span>文档中心</span></div><button className="icon-button refresh-button" type="button" onClick={onOpenLark} aria-label="飞书文档" title="导入或发布飞书文档"><Cloud size={16} /></button><button className="icon-button compact-button" type="button" onClick={onRefresh} aria-label="重新扫描项目" title="重新扫描项目"><RefreshCw size={16} /></button><button className="icon-button" type="button" onClick={onAdd} aria-label="添加项目" title="添加项目"><Plus size={18} /></button></>}
      </div>
      {collapsed && <nav className="collapsed-projects" aria-label="项目缩略列表">
        {projects.map((project) => <button key={project.id} type="button" className={project.id === activeProjectId ? "active" : ""} onClick={onToggleCollapsed} title={`${project.name} · ${project.files.length} 篇文档`} aria-label={`展开项目 ${project.name}`}>
          <span>{project.name.trim().charAt(0).toLocaleUpperCase() || "项"}</span>
          <small>{project.files.length > 99 ? "99+" : project.files.length}</small>
        </button>)}
        <button className="collapsed-add" type="button" onClick={onAdd} title="添加项目" aria-label="添加项目"><Plus size={17} /></button>
      </nav>}
      {!collapsed && <>
      <label className="search-box">
        <Search size={15} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setQuery(""); event.currentTarget.blur(); } }} placeholder="搜索文档名或正文…" />
        {query ? <button className="search-clear" type="button" onClick={() => setQuery("")} aria-label="清除搜索" title="清除搜索"><X size={14} /></button> : <kbd>⌘K</kbd>}
      </label>
      <div className="sidebar-label"><span>项目</span><button className={showEmptyFolders ? "active" : ""} type="button" title={showEmptyFolders ? "隐藏不含 Markdown 的文件夹" : "显示空文件夹和不含 Markdown 的文件夹"} onClick={() => { const next = !showEmptyFolders; setShowEmptyFolders(next); localStorage.setItem("zdocs:show-empty-folders", String(next)); }}>{showEmptyFolders ? "隐藏空目录" : "显示空目录"}</button><span>{projects.length}</span></div>
      <div className="projects-scroll">
        {!normalized && favoriteDocs.length > 0 && <QuickDocs title="收藏" icon={<Star size={13} />} docs={favoriteDocs} activeId={activeId} onOpen={onOpen} onContextMenu={showDocMenu} />}
        {!normalized && recentDocs.length > 0 && <QuickDocs title="最近访问" icon={<Clock3 size={13} />} docs={recentDocs} activeId={activeId} onOpen={onOpen} onContextMenu={showDocMenu} />}
        {normalized && isSearching && <div className="searching-state"><span />正在搜索正文…</div>}
        {normalized && !isSearching && !hasSearchResults && <div className="search-empty">没有找到“{query.trim()}”<span>试试文件名、路径或正文关键词</span></div>}
        {visible.map((project) => <div key={project.id} data-project-id={project.id} className={`project-drag-shell ${draggingId === project.id ? "dragging" : ""} ${dropTarget?.id === project.id ? `drop-${dropTarget.position}` : ""}`}><ProjectTree project={project} activeId={activeId} revealDocId={revealTarget?.docId} revealRequest={revealTarget?.request} onOpen={onOpen} onContextMenu={showDocMenu} onFolderContextMenu={(event, path, name) => showFolderMenu(event, project.id, path, name)} onCreateEntry={(path) => onCreateEntry(project.id, path, "file")} onMoveEntry={(source, target) => onMoveEntry(project.id, source, target)} onRemove={onRemove} onRestore={onRestore} forceOpen={Boolean(normalized)} onDragStart={(event) => { draggingRef.current = project.id; setDraggingId(project.id); event.currentTarget.setPointerCapture(event.pointerId); document.body.classList.add("is-project-dragging"); }} onDragMove={moveProject} onDragEnd={stopProjectDrag} /></div>)}
        {!projects.length && (
          <div className="sidebar-empty">
            <div className="empty-folder"><FolderOpen size={24} /></div>
            <strong>还没有项目</strong>
            <p>添加项目目录，自动汇总其中的 Markdown 文档。</p>
            <button type="button" onClick={onAdd}><Plus size={15} /> 添加项目</button>
          </div>
        )}
      </div>
      </>}
      <div className="sidebar-footer"><button className="sidebar-collapse-button" type="button" onClick={onToggleCollapsed} aria-label={collapsed ? "展开左侧栏" : "收起左侧栏"} title={collapsed ? "展开左侧栏" : "收起左侧栏"}>{collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}</button>{!collapsed && <><span className="status-dot" />本地模式<button type="button" onClick={onShowShortcuts} aria-label="查看快捷键" title="快捷键"><CircleHelp size={14} /></button><button type="button" onClick={onToggleTheme} aria-label="切换主题" title="切换明暗主题">{theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}</button></>}</div>
      {contextMenu && <div className="doc-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>{[
        { action: "reveal" as const, label: "在 Finder 中显示", icon: <FolderOpen size={15} /> },
        { action: "copy-path" as const, label: "复制绝对路径", icon: <Copy size={15} /> },
        { action: "rename" as const, label: "重命名", icon: <Pencil size={15} /> },
        { action: "export-pdf" as const, label: "导出 PDF…", icon: <FileOutput size={15} /> },
        { action: "export-docx" as const, label: "导出 Word…", icon: <FileOutput size={15} /> },
        { action: "delete" as const, label: "删除文档", icon: <Trash2 size={15} /> },
      ].map((item) => <button key={item.action} type="button" role="menuitem" onClick={() => { onDocAction(item.action, contextMenu.doc); setContextMenu(undefined); }}>{item.icon}<span>{item.label}</span></button>)}</div>}
      {folderMenu && <div className="doc-context-menu folder-context-menu" role="menu" aria-label={`${folderMenu.name} 文件夹操作`} style={{ left: folderMenu.x, top: folderMenu.y }} onPointerDown={(event) => event.stopPropagation()}><button type="button" role="menuitem" onClick={() => { onCreateEntry(folderMenu.projectId, folderMenu.path, "file"); setFolderMenu(undefined); }}><FilePlus2 size={15} /><span>新建 Markdown</span></button><button type="button" role="menuitem" onClick={() => { onCreateEntry(folderMenu.projectId, folderMenu.path, "folder"); setFolderMenu(undefined); }}><FolderPlus size={15} /><span>新建文件夹</span></button>{folderMenu.path && <><button type="button" role="menuitem" onClick={() => { onRenameFolder(folderMenu.projectId, folderMenu.path, folderMenu.name); setFolderMenu(undefined); }}><Pencil size={15} /><span>重命名文件夹</span></button><button className="danger" type="button" role="menuitem" onClick={() => { onDeleteFolder(folderMenu.projectId, folderMenu.path, folderMenu.name); setFolderMenu(undefined); }}><Trash2 size={15} /><span>删除文件夹</span></button></>}</div>}
    </aside>
  );
}

function QuickDocs({ title, icon, docs, activeId, onOpen, onContextMenu }: { title: string; icon: React.ReactNode; docs: DocFile[]; activeId?: string; onOpen: (doc: DocFile) => void; onContextMenu: (event: React.MouseEvent, doc: DocFile) => void }) {
  return <section className="quick-section"><div className="quick-title">{icon}{title}</div>{docs.map((doc) => <button key={doc.id} type="button" className={`quick-doc ${doc.id === activeId ? "active" : ""}`} onClick={() => onOpen(doc)} onContextMenu={(event) => onContextMenu(event, doc)} title={doc.path}><FileText size={14} /><span>{doc.name.replace(/\.md$/i, "")}</span></button>)}</section>;
}

function ProjectTree({ project, activeId, revealDocId, revealRequest, onOpen, onContextMenu, onFolderContextMenu, onCreateEntry, onMoveEntry, onRemove, onRestore, forceOpen, onDragStart, onDragMove, onDragEnd }: { project: DocsProject; activeId?: string; revealDocId?: string; revealRequest?: number; onOpen: (doc: DocFile) => void; onContextMenu: (event: React.MouseEvent, doc: DocFile) => void; onFolderContextMenu: (event: React.MouseEvent, path: string, name: string) => void; onCreateEntry: (path: string) => void; onMoveEntry: (source: string, target: string) => void; onRemove: (projectId: string) => void; onRestore: (projectId: string) => void; forceOpen: boolean; onDragStart: (event: React.PointerEvent<HTMLButtonElement>) => void; onDragMove: (event: React.PointerEvent<HTMLButtonElement>) => void; onDragEnd: (event: React.PointerEvent<HTMLButtonElement>) => void }) {
  const [projectOpen, setProjectOpen] = useState(false);
  const revealHere = project.files.some((doc) => doc.id === revealDocId);
  const showProject = forceOpen || projectOpen || revealHere;
  useEffect(() => { if (revealHere) setProjectOpen(true); }, [revealHere, revealRequest]);

  return (
    <section className="project" onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-zdocs-path")) event.preventDefault(); }} onDrop={(event) => { const source = event.dataTransfer.getData("application/x-zdocs-path"); if (source) { event.preventDefault(); onMoveEntry(source, ""); } }}>
      <div className="project-title">
        <button className="collapse-button project-collapse" type="button" aria-expanded={showProject} onClick={() => setProjectOpen((value) => !value)} onContextMenu={(event) => onFolderContextMenu(event, "", project.name)}>
          {showProject ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <span className="project-dot" />
          <strong>{project.name}</strong>
          <span className="file-count">{project.accessStatus === "granted" ? project.files.length : "需授权"}</span>
        </button>
        <button className="project-add-button" type="button" onClick={() => onCreateEntry("")} aria-label={`在 ${project.name} 中新建 Markdown`} title="新建 Markdown"><Plus size={14} /></button>
        <button className="project-drag-handle" type="button" onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd} aria-label={`拖动排序 ${project.name}`} title="拖动调整项目顺序"><GripVertical size={14} /></button>
        <button className="remove-button" type="button" onClick={() => onRemove(project.id)} aria-label={`移除 ${project.name}`} title="从列表中移除项目"><Trash2 size={15} /></button>
      </div>
      {showProject && project.accessStatus === "needs-permission" && (
        <div className="permission-card"><KeyRound size={15} /><span>目录访问权限已失效</span><button type="button" onClick={() => onRestore(project.id)}>重新授权</button></div>
      )}
      {showProject && project.accessStatus === "granted" && (project.tree.length ? <Tree nodes={project.tree} activeId={activeId} revealDocId={revealHere ? revealDocId : undefined} revealRequest={revealRequest} onOpen={onOpen} onContextMenu={onContextMenu} onFolderContextMenu={onFolderContextMenu} onCreateEntry={onCreateEntry} onMoveEntry={onMoveEntry} /> : <p className="empty-tree">没有 Markdown 文档</p>)}
    </section>
  );
}
