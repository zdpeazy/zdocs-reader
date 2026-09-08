import { ArrowLeft, ArrowRight, Bold, Braces, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Code, Columns2, Copy, Eye, FileCode2, Focus, Heading2, ImagePlus, Italic, Link, ListTodo, RotateCcw, Save, Search, Settings2, Star, Table2, X, ZoomIn, ZoomOut } from "lucide-react";
import { forwardRef, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { copyText, getProjectFile, openExternalLink, readNativeAsset, resolveRelativePath, savePastedImage } from "../file-system";
import { parseMarkdown } from "../markdown";
import type { DocFile, DocsProject, ViewMode } from "../types";
import type { EditorCommand, EditorCommandType } from "./MarkdownEditor";

const MarkdownEditor = lazy(() => import("./MarkdownEditor"));

interface ReaderProps {
  doc?: DocFile;
  project?: DocsProject;
  source: string;
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  onSourceChange: (source: string) => void;
  onSave: () => void;
  isDirty: boolean;
  isSaving: boolean;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onOpenDoc: (doc: DocFile) => void;
  theme?: "light" | "dark";
  openDocs: DocFile[];
  onCloseTab: (id: string) => void;
  onCloseTabs: (ids: string[]) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onNavigate: (direction: -1 | 1) => void;
}

export function Reader({ doc, project, source, mode, onModeChange, onSourceChange, onSave, isDirty, isSaving, isFavorite, onToggleFavorite, onOpenDoc, theme = "light", openDocs, onCloseTab, onCloseTabs, canGoBack, canGoForward, onNavigate }: ReaderProps) {
  const rendered = useMemo(() => parseMarkdown(source), [source]);
  const [previewHtml, setPreviewHtml] = useState(rendered.html);
  const [splitRatio, setSplitRatio] = useState(() => Number(localStorage.getItem("zdocs:split-ratio")) || 50);
  const [copied, setCopied] = useState(false);
  const [imageViewer, setImageViewer] = useState<{ src: string; alt: string }>();
  const [imageScale, setImageScale] = useState(1);
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>();
  const imageScaleRef = useRef(1);
  const wheelDeltaRef = useRef(0);
  const wheelFrameRef = useRef<number | undefined>(undefined);
  const panFrameRef = useRef<number | undefined>(undefined);
  const zoomScrollFrameRef = useRef<number | undefined>(undefined);
  const [isImagePanning, setIsImagePanning] = useState(false);
  const imageStageRef = useRef<HTMLDivElement>(null);
  const imagePan = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined);
  const splitDrag = useRef<{ x: number; ratio: number } | undefined>(undefined);
  const gridRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [activeHeading, setActiveHeading] = useState<string>();
  const [reading, setReading] = useState(() => { try { return JSON.parse(localStorage.getItem("zdocs:reading-settings") || "") as { fontSize: number; lineHeight: number; width: number }; } catch { return { fontSize: 15, lineHeight: 1.75, width: 860 }; } });
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [searchTarget, setSearchTarget] = useState<"source" | "preview">("source");
  const [sourceSearchRequest, setSourceSearchRequest] = useState(0);
  const [editorCommand, setEditorCommand] = useState<EditorCommand>();
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string }>();
  const findInputRef = useRef<HTMLInputElement>(null);
  const previewSearch = useMemo(() => buildPreviewSearchHtml(previewHtml, findOpen ? findQuery.trim() : "", findIndex), [previewHtml, findOpen, findQuery, findIndex]);

  useEffect(() => {
    if (!tabMenu) return;
    const close = () => setTabMenu(undefined);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("resize", close); window.removeEventListener("keydown", onKeyDown); };
  }, [tabMenu]);
  useEffect(() => {
    if (!doc || !project) return;
    let cancelled = false;
    const urls: string[] = [];
    const resolveAssets = async () => {
      const parsed = new DOMParser().parseFromString(rendered.html, "text/html");
      await Promise.all(Array.from(parsed.querySelectorAll("img[src]")).map(async (image) => {
        const sourcePath = image.getAttribute("src") ?? "";
        const resolved = resolveRelativePath(doc.path, sourcePath);
        if (!resolved) return;
        try {
          if (project.rootPath) {
            image.setAttribute("src", await readNativeAsset(project, resolved));
          } else if (project.rootHandle) {
            const file = await (await getProjectFile(project.rootHandle, resolved)).getFile();
            const url = URL.createObjectURL(file);
            urls.push(url);
            image.setAttribute("src", url);
          }
        } catch { image.setAttribute("data-missing", "true"); }
      }));
      const diagrams = Array.from(parsed.querySelectorAll("pre code.language-mermaid"));
      if (diagrams.length) {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: theme === "dark" ? "dark" : "default" });
        await Promise.all(diagrams.map(async (code, index) => {
          try {
            const { svg } = await mermaid.render(`zdocs-mermaid-${Date.now()}-${index}`, code.textContent ?? "");
            const container = parsed.createElement("div");
            container.className = "mermaid-diagram";
            container.innerHTML = svg;
            code.parentElement?.replaceWith(container);
          } catch { code.parentElement?.classList.add("mermaid-error"); }
        }));
      }
      if (!cancelled) setPreviewHtml(parsed.body.innerHTML);
    };
    void resolveAssets();
    return () => { cancelled = true; urls.forEach(URL.revokeObjectURL); };
  }, [doc, project, rendered.html, theme]);

  useEffect(() => localStorage.setItem("zdocs:split-ratio", String(splitRatio)), [splitRatio]);
  useEffect(() => { imageScaleRef.current = imageScale; }, [imageScale]);
  useEffect(() => localStorage.setItem("zdocs:reading-settings", JSON.stringify(reading)), [reading]);
  useEffect(() => {
    if (!doc || !previewRef.current) return;
    const pane = previewRef.current;
    const key = `zdocs:scroll:${doc.id}:preview`;
    window.setTimeout(() => { pane.scrollTop = Number(localStorage.getItem(key)) || 0; }, 0);
    const save = () => localStorage.setItem(key, String(pane.scrollTop));
    pane.addEventListener("scroll", save, { passive: true });
    return () => { save(); pane.removeEventListener("scroll", save); };
  }, [doc?.id, mode]);
  useEffect(() => {
    const pane = previewRef.current;
    if (!pane || !rendered.headings.length) return;
    const observer = new IntersectionObserver((entries) => { const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top); if (visible[0]) setActiveHeading(visible[0].target.id); }, { root: pane, rootMargin: "-10% 0px -75%", threshold: 0 });
    rendered.headings.forEach((heading) => { const element = pane.querySelector(`#${CSS.escape(heading.id)}`); if (element) observer.observe(element); });
    return () => observer.disconnect();
  }, [doc?.id, previewHtml, rendered.headings]);
  useEffect(() => {
    if (!imageViewer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setImageViewer(undefined);
      if (event.key === "+" || event.key === "=") setImageScale((scale) => Math.min(5, scale + .25));
      if (event.key === "-") setImageScale((scale) => Math.max(.25, scale - .25));
      if (event.key === "0") setImageScale(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [imageViewer]);
  useEffect(() => {
    const onFind = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      const target = mode === "source" ? "source" : mode === "preview" ? "preview" : searchTarget;
      if (target === "source") { setFindOpen(false); setFindQuery(""); setSourceSearchRequest((request) => request + 1); }
      else { setFindOpen(true); window.setTimeout(() => findInputRef.current?.focus(), 0); }
    };
    window.addEventListener("keydown", onFind, true);
    return () => window.removeEventListener("keydown", onFind, true);
  }, [mode, searchTarget]);
  useEffect(() => {
    previewRef.current?.querySelector("mark.zdocs-find-mark.active")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [previewSearch.html]);
  const movePreviewFind = (direction: number) => {
    if (!previewSearch.count) return;
    setFindIndex(((Math.max(1, findIndex) - 1 + direction + previewSearch.count) % previewSearch.count) + 1);
  };
  const zoomImageAt = (nextScale: number, clientX?: number, clientY?: number) => {
    const stage = imageStageRef.current;
    const previous = imageScaleRef.current;
    const bounded = Math.max(.25, Math.min(5, nextScale));
    const next = bounded < .27 ? .25 : bounded > 4.98 ? 5 : bounded;
    if (!stage || next === previous) return;
    const rect = stage.getBoundingClientRect();
    const widthWasFitted = stage.scrollWidth <= stage.clientWidth + 1;
    const heightWasFitted = stage.scrollHeight <= stage.clientHeight + 1;
    const originX = clientX === undefined ? stage.clientWidth / 2 : clientX - rect.left;
    const originY = clientY === undefined ? stage.clientHeight / 2 : clientY - rect.top;
    const logicalX = (stage.scrollLeft + originX) / previous;
    const logicalY = (stage.scrollTop + originY) / previous;
    imageScaleRef.current = next;
    setImageScale(next);
    if (zoomScrollFrameRef.current) cancelAnimationFrame(zoomScrollFrameRef.current);
    zoomScrollFrameRef.current = requestAnimationFrame(() => {
      zoomScrollFrameRef.current = undefined;
      const widthIsFitted = stage.scrollWidth <= stage.clientWidth + 1;
      const heightIsFitted = stage.scrollHeight <= stage.clientHeight + 1;
      stage.scrollLeft = widthIsFitted ? 0 : widthWasFitted ? (stage.scrollWidth - stage.clientWidth) / 2 : logicalX * next - originX;
      stage.scrollTop = heightIsFitted ? 0 : heightWasFitted ? (stage.scrollHeight - stage.clientHeight) / 2 : logicalY * next - originY;
    });
  };
  if (!doc || !project) return <Welcome />;
  const pathParts = doc.path.split("/");

  return (
    <main className={`reader-shell ${focusMode ? "focus-mode" : ""}`} style={{ "--reading-size": `${reading.fontSize}px`, "--reading-line": reading.lineHeight, "--reading-width": `${reading.width}px` } as React.CSSProperties}>
      <div className="document-tabs">{openDocs.map((tab) => <button key={tab.id} type="button" className={tab.id === doc.id ? "active" : ""} onClick={() => onOpenDoc(tab)} onContextMenu={(event) => { event.preventDefault(); const width = 188; const height = 216; setTabMenu({ id: tab.id, x: Math.min(event.clientX, window.innerWidth - width - 8), y: Math.min(event.clientY, window.innerHeight - height - 8) }); }} title={tab.path}><FileCode2 size={13} /><span>{tab.name.replace(/\.md$/i, "")}</span>{tab.id === doc.id && isDirty && <i /> }<b role="button" aria-label={`关闭 ${tab.name}`} onClick={(event) => { event.stopPropagation(); onCloseTab(tab.id); }}><X size={12} /></b></button>)}</div>
      <header className="topbar">
        <div className="history-actions"><button type="button" disabled={!canGoBack} onClick={() => onNavigate(-1)} title="后退 (⌘[)"><ArrowLeft size={15} /></button><button type="button" disabled={!canGoForward} onClick={() => onNavigate(1)} title="前进 (⌘])"><ArrowRight size={15} /></button></div>
        <div className="breadcrumbs"><span>{project.name}</span><b>/</b>{pathParts.map((part, index) => <span key={`${part}-${index}`} className={index === pathParts.length - 1 ? "current" : ""}>{part}{index < pathParts.length - 1 && <b>/</b>}</span>)}</div>
        <div className="view-switch" role="group" aria-label="阅读模式">
          <ModeButton active={mode === "source"} label="源码" onClick={() => onModeChange("source")} icon={<FileCode2 size={14} />} />
          <ModeButton active={mode === "preview"} label="预览" onClick={() => onModeChange("preview")} icon={<Eye size={14} />} />
          <ModeButton active={mode === "split"} label="分屏" onClick={() => onModeChange("split")} icon={<Columns2 size={14} />} />
        </div>
        <button className={`save-button ${isDirty ? "dirty" : ""}`} type="button" onClick={onSave} disabled={!isDirty || isSaving} title="保存文档 (⌘S)"><Save size={15} />{isSaving ? "保存中" : isDirty ? "保存" : "已保存"}</button>
        <button className={`top-action favorite-button ${isFavorite ? "active" : ""}`} type="button" onClick={onToggleFavorite} title={isFavorite ? "取消收藏" : "收藏文档"}><Star size={16} fill={isFavorite ? "currentColor" : "none"} /></button>
        <button className={`top-action copy-button ${copied ? "copied" : ""}`} type="button" onClick={async () => { await copyText(source); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }} title={copied ? "已复制" : "复制源码"} aria-label={copied ? "源码已复制" : "复制源码"}>{copied ? <Check size={16} /> : <Copy size={16} />}</button>
        <div className="reading-settings-wrap"><button className="top-action" type="button" onClick={() => setSettingsOpen((value) => !value)} title="阅读设置"><Settings2 size={16} /></button>{settingsOpen && <div className="reading-settings"><strong>阅读设置</strong><label><span>正文字号</span><input type="range" min="13" max="21" value={reading.fontSize} onChange={(event) => setReading((value) => ({ ...value, fontSize: Number(event.target.value) }))} /><b>{reading.fontSize}px</b></label><label><span>行高</span><input type="range" min="1.4" max="2.1" step=".05" value={reading.lineHeight} onChange={(event) => setReading((value) => ({ ...value, lineHeight: Number(event.target.value) }))} /><b>{reading.lineHeight.toFixed(2)}</b></label><label><span>内容宽度</span><input type="range" min="620" max="1100" step="20" value={reading.width} onChange={(event) => setReading((value) => ({ ...value, width: Number(event.target.value) }))} /><b>{reading.width}px</b></label><button type="button" onClick={() => setReading({ fontSize: 15, lineHeight: 1.75, width: 860 })}>恢复默认</button></div>}</div>
        <button className={`top-action ${focusMode ? "active" : ""}`} type="button" onClick={() => setFocusMode((value) => !value)} title={focusMode ? "退出专注阅读" : "专注阅读"}><Focus size={16} /></button>
      </header>
      {findOpen && <div className="reader-find"><Search size={14} /><input ref={findInputRef} value={findQuery} onChange={(event) => { setFindQuery(event.target.value); setFindIndex(event.target.value ? 1 : 0); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); movePreviewFind(event.shiftKey ? -1 : 1); } if (event.key === "Escape") { setFindOpen(false); setFindQuery(""); } }} placeholder="在预览中查找…" /><span>{previewSearch.count ? `${Math.max(1, findIndex)} / ${previewSearch.count}` : findQuery ? "无结果" : ""}</span><button type="button" onClick={() => movePreviewFind(-1)} disabled={!previewSearch.count} title="上一个 (Shift+Enter)"><ChevronUp size={15} /></button><button type="button" onClick={() => movePreviewFind(1)} disabled={!previewSearch.count} title="下一个 (Enter)"><ChevronDown size={15} /></button><button type="button" onClick={() => { setFindOpen(false); setFindQuery(""); }} title="关闭"><X size={15} /></button></div>}
      <div ref={gridRef} className={`reader-grid mode-${mode} ${outlineCollapsed ? "outline-collapsed" : ""}`} style={mode === "split" ? { gridTemplateColumns: `minmax(280px, ${splitRatio}fr) 5px minmax(280px, ${100 - splitRatio}fr) ${outlineCollapsed ? 38 : 190}px` } : undefined}>
        {(mode === "source" || mode === "split") && <SourceView key={`source-${doc.id}`} doc={doc} project={project} source={source} onChange={onSourceChange} theme={theme} previewRef={previewRef} searchRequest={sourceSearchRequest} command={editorCommand} onCommand={(type) => setEditorCommand({ id: Date.now(), type })} onActivate={() => setSearchTarget("source")} />}
        {mode === "split" && <div className="split-resizer" role="separator" aria-label="调整编辑与预览宽度" onPointerDown={(event) => { splitDrag.current = { x: event.clientX, ratio: splitRatio }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!splitDrag.current || !gridRef.current) return; const width = gridRef.current.getBoundingClientRect().width - 190; setSplitRatio(Math.max(25, Math.min(75, splitDrag.current.ratio + (event.clientX - splitDrag.current.x) / width * 100))); }} onPointerUp={() => { splitDrag.current = undefined; }} onDoubleClick={() => setSplitRatio(50)} />}
        {(mode === "preview" || mode === "split") && <Preview key={`preview-${doc.id}`} ref={previewRef} html={previewSearch.html} doc={doc} project={project} onOpenDoc={onOpenDoc} onActivate={() => setSearchTarget("preview")} onOpenImage={(src, alt) => { setImageViewer({ src, alt }); imageScaleRef.current = 1; setImageScale(1); setImageSize(undefined); }} />}
        <aside className="outline-panel">
          <button className="outline-title" type="button" onClick={() => setOutlineCollapsed((value) => !value)} title={outlineCollapsed ? "展开本文目录" : "收起本文目录"}>{outlineCollapsed ? <ChevronRight size={14} /> : <>本文目录<ChevronLeft size={14} /></>}</button>
          {!outlineCollapsed && (rendered.headings.length ? rendered.headings.map((heading) => (
            <button key={heading.id} type="button" className={activeHeading === heading.id ? "active" : ""} style={{ paddingLeft: 12 + (heading.level - 1) * 12 }} onClick={() => previewRef.current?.querySelector(`#${CSS.escape(heading.id)}`)?.scrollIntoView({ behavior: "smooth" })}>{heading.text}</button>
          )) : <p>暂无标题</p>)}
        </aside>
      </div>
      <footer className="reader-footer"><span>{doc.path}{isDirty ? " · 未保存" : ""}</span><span>Markdown · UTF-8 · {source.split(/\r?\n/).length} 行</span></footer>
      {tabMenu && (() => {
        const index = openDocs.findIndex((tab) => tab.id === tabMenu.id);
        const menuItems = [
          { label: "关闭标签页", ids: [tabMenu.id], disabled: false },
          { label: "关闭左侧标签页", ids: openDocs.slice(0, index).map((tab) => tab.id), disabled: index <= 0 },
          { label: "关闭右侧标签页", ids: openDocs.slice(index + 1).map((tab) => tab.id), disabled: index < 0 || index >= openDocs.length - 1 },
          { label: "关闭其他标签页", ids: openDocs.filter((tab) => tab.id !== tabMenu.id).map((tab) => tab.id), disabled: openDocs.length <= 1 },
          { label: "关闭全部标签页", ids: openDocs.map((tab) => tab.id), disabled: openDocs.length === 0 },
        ];
        return <div className="tab-context-menu" role="menu" style={{ left: tabMenu.x, top: tabMenu.y }} onPointerDown={(event) => event.stopPropagation()}>{menuItems.map((item, itemIndex) => <button key={item.label} className={itemIndex === 3 ? "separated" : ""} type="button" role="menuitem" disabled={item.disabled} onClick={() => { onCloseTabs(item.ids); setTabMenu(undefined); }}>{item.label}</button>)}</div>;
      })()}
      {imageViewer && <div className="image-viewer" role="dialog" aria-modal="true" aria-label="图片预览" onClick={() => setImageViewer(undefined)}>
        <div className="image-viewer-toolbar" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => zoomImageAt(imageScaleRef.current - .25)} disabled={imageScale <= .25} title="缩小"><ZoomOut size={17} /></button>
          <span>{Math.round(imageScale * 100)}%</span>
          <button type="button" onClick={() => zoomImageAt(imageScaleRef.current + .25)} disabled={imageScale >= 5} title="放大"><ZoomIn size={17} /></button>
          <button type="button" onClick={() => zoomImageAt(1)} title="恢复 100%"><RotateCcw size={16} /></button>
          <i />
          <button type="button" onClick={() => setImageViewer(undefined)} title="关闭 (Esc)"><X size={18} /></button>
        </div>
        <div ref={imageStageRef} className={`image-viewer-stage ${isImagePanning ? "is-panning" : ""}`} onClick={(event) => event.stopPropagation()} onWheel={(event) => { if (!(event.ctrlKey || event.metaKey)) return; event.preventDefault(); wheelDeltaRef.current += event.deltaY; if (wheelFrameRef.current) return; const x = event.clientX; const y = event.clientY; wheelFrameRef.current = requestAnimationFrame(() => { const delta = wheelDeltaRef.current; wheelDeltaRef.current = 0; wheelFrameRef.current = undefined; zoomImageAt(imageScaleRef.current * Math.exp(-delta * .008), x, y); }); }} onPointerDown={(event) => { if (event.button !== 0 || !imageStageRef.current) return; imagePan.current = { x: event.clientX, y: event.clientY, left: imageStageRef.current.scrollLeft, top: imageStageRef.current.scrollTop }; setIsImagePanning(true); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!imagePan.current || !imageStageRef.current) return; const x = event.clientX; const y = event.clientY; if (panFrameRef.current) cancelAnimationFrame(panFrameRef.current); panFrameRef.current = requestAnimationFrame(() => { if (!imagePan.current || !imageStageRef.current) return; imageStageRef.current.scrollLeft = imagePan.current.left - (x - imagePan.current.x); imageStageRef.current.scrollTop = imagePan.current.top - (y - imagePan.current.y); }); }} onPointerUp={(event) => { imagePan.current = undefined; setIsImagePanning(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { imagePan.current = undefined; setIsImagePanning(false); }}>
          <div className="image-viewer-canvas" style={imageSize ? { width: imageSize.width * imageScale, height: imageSize.height * imageScale } : undefined}>
            <img src={imageViewer.src} alt={imageViewer.alt} width={imageSize?.width} height={imageSize?.height} style={{ transform: `scale(${imageScale})` }} onLoad={(event) => { const image = event.currentTarget; setImageSize({ width: image.naturalWidth || image.clientWidth, height: image.naturalHeight || image.clientHeight }); }} draggable={false} />
          </div>
        </div>
        {imageViewer.alt && <div className="image-viewer-caption">{imageViewer.alt}</div>}
      </div>}
    </main>
  );
}

function ModeButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: React.ReactNode; onClick: () => void }) {
  return <button type="button" className={active ? "active" : ""} onClick={onClick}>{icon}{label}</button>;
}

function SourceView({ doc, project, source, onChange, theme, previewRef, searchRequest, command, onCommand, onActivate }: { doc: DocFile; project: DocsProject; source: string; onChange: (source: string) => void; theme: "light" | "dark"; previewRef: React.RefObject<HTMLDivElement | null>; searchRequest: number; command?: EditorCommand; onCommand: (type: EditorCommandType) => void; onActivate: () => void }) {
  const lines = source.split(/\r?\n/).length;
  const scrollKey = `zdocs:scroll:${doc.id}:source`;
  const suggestions = project.files.filter((item) => item.id !== doc.id).map((item) => relativeDocPath(doc.path, item.path));
  const headings = parseMarkdown(source).headings.map((heading) => `#${heading.id}`);
  return <div className="source-pane" onPointerDown={onActivate}><div className="source-pane-header"><span className="source-language"><i />MARKDOWN</span><span className="source-hint">可编辑</span><span className="source-stats">{lines} 行 · UTF-8</span></div><EditorToolbar onCommand={onCommand} /><div className="editor-frame"><Suspense fallback={<div className="editor-loading">正在加载编辑器…</div>}><MarkdownEditor docId={doc.id} value={source} theme={theme} searchRequest={searchRequest} command={command} pathSuggestions={suggestions} headingSuggestions={headings} onPasteImage={(file) => savePastedImage(project, doc, file)} initialScrollRatio={Number(localStorage.getItem(scrollKey)) || 0} onChange={onChange} onScrollRatio={(ratio) => { localStorage.setItem(scrollKey, String(ratio)); if (previewRef.current) previewRef.current.scrollTop = ratio * (previewRef.current.scrollHeight - previewRef.current.clientHeight); }} /></Suspense></div></div>;
}

function EditorToolbar({ onCommand }: { onCommand: (type: EditorCommandType) => void }) {
  const items: Array<{ type: EditorCommandType; label: string; icon: React.ReactNode }> = [
    { type: "heading", label: "标题", icon: <Heading2 size={14} /> }, { type: "bold", label: "加粗", icon: <Bold size={14} /> }, { type: "italic", label: "斜体", icon: <Italic size={14} /> },
    { type: "link", label: "链接", icon: <Link size={14} /> }, { type: "image", label: "图片", icon: <ImagePlus size={14} /> }, { type: "inline-code", label: "行内代码", icon: <Code size={14} /> },
    { type: "code-block", label: "代码块", icon: <Braces size={14} /> }, { type: "table", label: "表格", icon: <Table2 size={14} /> }, { type: "task", label: "任务列表", icon: <ListTodo size={14} /> },
  ];
  return <div className="editor-toolbar" role="toolbar" aria-label="Markdown 编辑工具">{items.map((item) => <button key={item.type} type="button" onClick={() => onCommand(item.type)} title={item.label} aria-label={item.label}>{item.icon}</button>)}<span>粘贴图片将自动保存到 assets</span></div>;
}

function relativeDocPath(from: string, to: string) {
  const fromParts = from.split("/").slice(0, -1);
  const toParts = to.split("/");
  while (fromParts.length && toParts.length && fromParts[0] === toParts[0]) { fromParts.shift(); toParts.shift(); }
  return `${"../".repeat(fromParts.length)}${toParts.join("/")}`;
}

const Preview = forwardRef<HTMLDivElement, { html: string; doc: DocFile; project: DocsProject; onOpenDoc: (doc: DocFile) => void; onOpenImage: (src: string, alt: string) => void; onActivate: () => void }>(function Preview({ html, doc, project, onOpenDoc, onOpenImage, onActivate }, ref) {
  return <div ref={ref} className="preview-pane" onPointerDown={onActivate}><article className="markdown-body" onClick={(event) => { const element = event.target as Element; if (element instanceof HTMLImageElement && !element.hasAttribute("data-missing")) { event.preventDefault(); onOpenImage(element.src, element.alt); return; } const diagram = element.closest(".mermaid-diagram svg") as SVGSVGElement | null; if (diagram) { event.preventDefault(); const markup = new XMLSerializer().serializeToString(diagram); onOpenImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`, "Mermaid 流程图"); return; } const anchor = element.closest("a"); if (!anchor) return; const href = anchor.getAttribute("href")?.trim() ?? ""; if (!href || href.startsWith("#")) return; event.preventDefault(); const path = resolveRelativePath(doc.path, href); if (path && /\.md$/i.test(path)) { const target = project.files.find((file) => file.path === path); if (target) { onOpenDoc(target); return; } } if (/^(https?:|mailto:)/i.test(href)) void openExternalLink(href); }} dangerouslySetInnerHTML={{ __html: html }} /></div>;
});

function buildPreviewSearchHtml(html: string, query: string, activeIndex: number) {
  if (!query) return { html, count: 0 };
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(parsed.body, NodeFilter.SHOW_TEXT, { acceptNode(node) {
    const parent = node.parentElement;
    if (!node.textContent?.trim() || !parent || parent.closest("script, style, svg")) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  } });
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const needle = query.toLocaleLowerCase();
  let count = 0;
  nodes.forEach((node) => {
    const text = node.textContent ?? "";
    const lower = text.toLocaleLowerCase();
    let cursor = 0;
    let index = lower.indexOf(needle);
    if (index < 0) return;
    const fragment = document.createDocumentFragment();
    while (index >= 0) {
      fragment.append(text.slice(cursor, index));
      const mark = document.createElement("mark");
      count += 1;
      mark.className = `zdocs-find-mark${count === Math.max(1, activeIndex) ? " active" : ""}`;
      mark.textContent = text.slice(index, index + query.length);
      fragment.append(mark);
      cursor = index + query.length;
      index = lower.indexOf(needle, cursor);
    }
    fragment.append(text.slice(cursor));
    node.replaceWith(fragment);
  });
  return { html: parsed.body.innerHTML, count };
}

function Welcome() {
  return (
    <main className="welcome">
      <div className="welcome-art"><span>Z</span><i /><i /><i /></div>
      <p className="eyebrow">YOUR LOCAL KNOWLEDGE, ORGANIZED</p>
      <h1>让散落在项目里的文档<br />重新变得清晰。</h1>
      <p>添加项目目录，即可在一个地方阅读和编辑其中的所有 Markdown。默认看源码，需要时一键切换预览。</p>
      <div className="welcome-features"><span>多项目聚合</span><span>源码优先</span><span>完全本地</span></div>
    </main>
  );
}
