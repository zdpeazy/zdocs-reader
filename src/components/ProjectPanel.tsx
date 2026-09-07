import { ChevronDown, ChevronRight, CircleHelp, Clock3, Cloud, Copy, FileOutput, FileText, FolderOpen, GripVertical, KeyRound, Moon, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RefreshCw, Search, Star, Sun, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { readDoc } from "../file-system";
import type { DocFile, DocsProject, TreeNode } from "../types";
import { Tree } from "./Tree";

interface ProjectPanelProps {
  width: number;
  projects: DocsProject[];
  activeId?: string;
  onAdd: () => void;
  onOpen: (doc: DocFile) => void;
  onRemove: (projectId: string) => void;
  onRestore: (projectId: string) => void;
  onRefresh: () => void;
  onReorder: (draggedId: string, targetId: string, position: "before" | "after") => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onDocAction: (action: "reveal" | "copy-path" | "rename" | "export-pdf" | "export-docx", doc: DocFile) => void;
  favoriteIds: string[];
  recentIds: string[];
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onShowShortcuts: () => void;
  onOpenLark: () => void;
}

export function ProjectPanel({ width, projects, activeId, onAdd, onOpen, onRemove, onRestore, onRefresh, onReorder, collapsed, onToggleCollapsed, onDocAction, favoriteIds, recentIds, theme, onToggleTheme, onShowShortcuts, onOpenLark }: ProjectPanelProps) {
  const [query, setQuery] = useState("");
  const [contentMatches, setContentMatches] = useState<Set<string>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [draggingId, setDraggingId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<{ id: string; position: "before" | "after" }>();
  const draggingRef = useRef<string | undefined>(undefined);
  const dropTargetRef = useRef<{ id: string; position: "before" | "after" } | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; doc: DocFile }>();
  const normalized = query.trim().toLowerCase();
  const allFiles = useMemo(() => projects.flatMap((project) => project.files), [projects]);
  const filesById = useMemo(() => new Map(allFiles.map((doc) => [doc.id, doc])), [allFiles]);
  const favoriteDocs = favoriteIds.map((id) => filesById.get(id)).filter((doc): doc is DocFile => Boolean(doc)).slice(0, 6);
  const recentDocs = recentIds.map((id) => filesById.get(id)).filter((doc): doc is DocFile => Boolean(doc)).slice(0, 3);

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
  const visible = useMemo(() => projects.map((project) => ({
    ...project,
    tree: normalized ? filterTree(project.tree) : project.tree,
  })), [projects, normalized, contentMatches]);
  const hasSearchResults = visible.some((project) => project.tree.length > 0);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(undefined);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); window.removeEventListener("keydown", onKey); };
  }, [contextMenu]);

  function showDocMenu(event: React.MouseEvent, doc: DocFile) {
    event.preventDefault();
    const menuWidth = 218;
    const menuHeight = 216;
    setContextMenu({ x: Math.min(event.clientX, window.innerWidth - menuWidth - 8), y: Math.min(event.clientY, window.innerHeight - menuHeight - 8), doc });
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
      {!collapsed && <>
      <label className="search-box">
        <Search size={15} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setQuery(""); event.currentTarget.blur(); } }} placeholder="搜索文档名或正文…" />
        {query ? <button className="search-clear" type="button" onClick={() => setQuery("")} aria-label="清除搜索" title="清除搜索"><X size={14} /></button> : <kbd>⌘K</kbd>}
      </label>
      <div className="sidebar-label"><span>项目</span><span>{projects.length}</span></div>
      <div className="projects-scroll">
        {!normalized && favoriteDocs.length > 0 && <QuickDocs title="收藏" icon={<Star size={13} />} docs={favoriteDocs} activeId={activeId} onOpen={onOpen} onContextMenu={showDocMenu} />}
        {!normalized && recentDocs.length > 0 && <QuickDocs title="最近访问" icon={<Clock3 size={13} />} docs={recentDocs} activeId={activeId} onOpen={onOpen} onContextMenu={showDocMenu} />}
        {normalized && isSearching && <div className="searching-state"><span />正在搜索正文…</div>}
        {normalized && !isSearching && !hasSearchResults && <div className="search-empty">没有找到“{query.trim()}”<span>试试文件名、路径或正文关键词</span></div>}
        {visible.map((project) => <div key={project.id} data-project-id={project.id} className={`project-drag-shell ${draggingId === project.id ? "dragging" : ""} ${dropTarget?.id === project.id ? `drop-${dropTarget.position}` : ""}`}><ProjectTree project={project} activeId={activeId} onOpen={onOpen} onContextMenu={showDocMenu} onRemove={onRemove} onRestore={onRestore} forceOpen={Boolean(normalized)} onDragStart={(event) => { draggingRef.current = project.id; setDraggingId(project.id); event.currentTarget.setPointerCapture(event.pointerId); document.body.classList.add("is-project-dragging"); }} onDragMove={moveProject} onDragEnd={stopProjectDrag} /></div>)}
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
      ].map((item) => <button key={item.action} type="button" role="menuitem" onClick={() => { onDocAction(item.action, contextMenu.doc); setContextMenu(undefined); }}>{item.icon}<span>{item.label}</span></button>)}</div>}
    </aside>
  );
}

function QuickDocs({ title, icon, docs, activeId, onOpen, onContextMenu }: { title: string; icon: React.ReactNode; docs: DocFile[]; activeId?: string; onOpen: (doc: DocFile) => void; onContextMenu: (event: React.MouseEvent, doc: DocFile) => void }) {
  return <section className="quick-section"><div className="quick-title">{icon}{title}</div>{docs.map((doc) => <button key={doc.id} type="button" className={`quick-doc ${doc.id === activeId ? "active" : ""}`} onClick={() => onOpen(doc)} onContextMenu={(event) => onContextMenu(event, doc)} title={doc.path}><FileText size={14} /><span>{doc.name.replace(/\.md$/i, "")}</span></button>)}</section>;
}

function ProjectTree({ project, activeId, onOpen, onContextMenu, onRemove, onRestore, forceOpen, onDragStart, onDragMove, onDragEnd }: { project: DocsProject; activeId?: string; onOpen: (doc: DocFile) => void; onContextMenu: (event: React.MouseEvent, doc: DocFile) => void; onRemove: (projectId: string) => void; onRestore: (projectId: string) => void; forceOpen: boolean; onDragStart: (event: React.PointerEvent<HTMLButtonElement>) => void; onDragMove: (event: React.PointerEvent<HTMLButtonElement>) => void; onDragEnd: (event: React.PointerEvent<HTMLButtonElement>) => void }) {
  const [projectOpen, setProjectOpen] = useState(false);
  const showProject = forceOpen || projectOpen;

  return (
    <section className="project">
      <div className="project-title">
        <button className="collapse-button project-collapse" type="button" aria-expanded={showProject} onClick={() => setProjectOpen((value) => !value)}>
          {showProject ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <span className="project-dot" />
          <strong>{project.name}</strong>
          <span className="file-count">{project.accessStatus === "granted" ? project.files.length : "需授权"}</span>
        </button>
        <button className="project-drag-handle" type="button" onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd} aria-label={`拖动排序 ${project.name}`} title="拖动调整项目顺序"><GripVertical size={14} /></button>
        <button className="remove-button" type="button" onClick={() => onRemove(project.id)} aria-label={`移除 ${project.name}`} title="从列表中移除项目"><Trash2 size={15} /></button>
      </div>
      {showProject && project.accessStatus === "needs-permission" && (
        <div className="permission-card"><KeyRound size={15} /><span>目录访问权限已失效</span><button type="button" onClick={() => onRestore(project.id)}>重新授权</button></div>
      )}
      {showProject && project.accessStatus === "granted" && (project.tree.length ? <Tree nodes={project.tree} activeId={activeId} onOpen={onOpen} onContextMenu={onContextMenu} /> : <p className="empty-tree">没有 Markdown 文档</p>)}
    </section>
  );
}
