import { Check, ChevronDown, ChevronUp, Columns2, Copy, Eye, FileCode2, RotateCcw, Save, Search, Star, X, ZoomIn, ZoomOut } from "lucide-react";
import { forwardRef, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { copyText, getProjectFile, readNativeAsset, resolveRelativePath } from "../file-system";
import { parseMarkdown } from "../markdown";
import type { DocFile, DocsProject, ViewMode } from "../types";

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
}

export function Reader({ doc, project, source, mode, onModeChange, onSourceChange, onSave, isDirty, isSaving, isFavorite, onToggleFavorite, onOpenDoc, theme = "light" }: ReaderProps) {
  const rendered = useMemo(() => parseMarkdown(source), [source]);
  const [previewHtml, setPreviewHtml] = useState(rendered.html);
  const [splitRatio, setSplitRatio] = useState(() => Number(localStorage.getItem("zdocs:split-ratio")) || 50);
  const [copied, setCopied] = useState(false);
  const [imageViewer, setImageViewer] = useState<{ src: string; alt: string }>();
  const [imageScale, setImageScale] = useState(1);
  const [isImagePanning, setIsImagePanning] = useState(false);
  const imageStageRef = useRef<HTMLDivElement>(null);
  const imagePan = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined);
  const splitDrag = useRef<{ x: number; ratio: number } | undefined>(undefined);
  const gridRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [searchTarget, setSearchTarget] = useState<"source" | "preview">("source");
  const [sourceSearchRequest, setSourceSearchRequest] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  const previewSearch = useMemo(() => buildPreviewSearchHtml(previewHtml, findOpen ? findQuery.trim() : "", findIndex), [previewHtml, findOpen, findQuery, findIndex]);

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
  if (!doc || !project) return <Welcome />;
  const pathParts = doc.path.split("/");

  return (
    <main className="reader-shell">
      <header className="topbar">
        <div className="breadcrumbs"><span>{project.name}</span><b>/</b>{pathParts.map((part, index) => <span key={`${part}-${index}`} className={index === pathParts.length - 1 ? "current" : ""}>{part}{index < pathParts.length - 1 && <b>/</b>}</span>)}</div>
        <div className="view-switch" role="group" aria-label="阅读模式">
          <ModeButton active={mode === "source"} label="源码" onClick={() => onModeChange("source")} icon={<FileCode2 size={14} />} />
          <ModeButton active={mode === "preview"} label="预览" onClick={() => onModeChange("preview")} icon={<Eye size={14} />} />
          <ModeButton active={mode === "split"} label="分屏" onClick={() => onModeChange("split")} icon={<Columns2 size={14} />} />
        </div>
        <button className={`save-button ${isDirty ? "dirty" : ""}`} type="button" onClick={onSave} disabled={!isDirty || isSaving} title="保存文档 (⌘S)"><Save size={15} />{isSaving ? "保存中" : isDirty ? "保存" : "已保存"}</button>
        <button className={`top-action favorite-button ${isFavorite ? "active" : ""}`} type="button" onClick={onToggleFavorite} title={isFavorite ? "取消收藏" : "收藏文档"}><Star size={16} fill={isFavorite ? "currentColor" : "none"} /></button>
        <button className={`top-action copy-button ${copied ? "copied" : ""}`} type="button" onClick={async () => { await copyText(source); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }} title={copied ? "已复制" : "复制源码"} aria-label={copied ? "源码已复制" : "复制源码"}>{copied ? <Check size={16} /> : <Copy size={16} />}</button>
      </header>
      {findOpen && <div className="reader-find"><Search size={14} /><input ref={findInputRef} value={findQuery} onChange={(event) => { setFindQuery(event.target.value); setFindIndex(event.target.value ? 1 : 0); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); movePreviewFind(event.shiftKey ? -1 : 1); } if (event.key === "Escape") { setFindOpen(false); setFindQuery(""); } }} placeholder="在预览中查找…" /><span>{previewSearch.count ? `${Math.max(1, findIndex)} / ${previewSearch.count}` : findQuery ? "无结果" : ""}</span><button type="button" onClick={() => movePreviewFind(-1)} disabled={!previewSearch.count} title="上一个 (Shift+Enter)"><ChevronUp size={15} /></button><button type="button" onClick={() => movePreviewFind(1)} disabled={!previewSearch.count} title="下一个 (Enter)"><ChevronDown size={15} /></button><button type="button" onClick={() => { setFindOpen(false); setFindQuery(""); }} title="关闭"><X size={15} /></button></div>}
      <div ref={gridRef} className={`reader-grid mode-${mode}`} style={mode === "split" ? { gridTemplateColumns: `minmax(280px, ${splitRatio}fr) 5px minmax(280px, ${100 - splitRatio}fr) 190px` } : undefined}>
        {(mode === "source" || mode === "split") && <SourceView source={source} onChange={onSourceChange} theme={theme} previewRef={previewRef} searchRequest={sourceSearchRequest} onActivate={() => setSearchTarget("source")} />}
        {mode === "split" && <div className="split-resizer" role="separator" aria-label="调整编辑与预览宽度" onPointerDown={(event) => { splitDrag.current = { x: event.clientX, ratio: splitRatio }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!splitDrag.current || !gridRef.current) return; const width = gridRef.current.getBoundingClientRect().width - 190; setSplitRatio(Math.max(25, Math.min(75, splitDrag.current.ratio + (event.clientX - splitDrag.current.x) / width * 100))); }} onPointerUp={() => { splitDrag.current = undefined; }} onDoubleClick={() => setSplitRatio(50)} />}
        {(mode === "preview" || mode === "split") && <Preview ref={previewRef} html={previewSearch.html} doc={doc} project={project} onOpenDoc={onOpenDoc} onActivate={() => setSearchTarget("preview")} onOpenImage={(src, alt) => { setImageViewer({ src, alt }); setImageScale(1); }} />}
        <aside className="outline-panel">
          <div className="outline-title">本文目录</div>
          {rendered.headings.length ? rendered.headings.map((heading) => (
            <button key={heading.id} type="button" style={{ paddingLeft: 12 + (heading.level - 1) * 12 }} onClick={() => document.getElementById(heading.id)?.scrollIntoView({ behavior: "smooth" })}>{heading.text}</button>
          )) : <p>暂无标题</p>}
        </aside>
      </div>
      <footer className="reader-footer"><span>{doc.path}{isDirty ? " · 未保存" : ""}</span><span>Markdown · UTF-8 · {source.split(/\r?\n/).length} 行</span></footer>
      {imageViewer && <div className="image-viewer" role="dialog" aria-modal="true" aria-label="图片预览" onClick={() => setImageViewer(undefined)}>
        <div className="image-viewer-toolbar" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => setImageScale((scale) => Math.max(.25, scale - .25))} disabled={imageScale <= .25} title="缩小"><ZoomOut size={17} /></button>
          <span>{Math.round(imageScale * 100)}%</span>
          <button type="button" onClick={() => setImageScale((scale) => Math.min(5, scale + .25))} disabled={imageScale >= 5} title="放大"><ZoomIn size={17} /></button>
          <button type="button" onClick={() => setImageScale(1)} title="恢复 100%"><RotateCcw size={16} /></button>
          <i />
          <button type="button" onClick={() => setImageViewer(undefined)} title="关闭 (Esc)"><X size={18} /></button>
        </div>
        <div ref={imageStageRef} className={`image-viewer-stage ${isImagePanning ? "is-panning" : ""}`} onClick={(event) => event.stopPropagation()} onWheel={(event) => { event.preventDefault(); setImageScale((scale) => Math.max(.25, Math.min(5, scale + (event.deltaY < 0 ? .15 : -.15)))); }} onPointerDown={(event) => { if (event.button !== 0 || !imageStageRef.current) return; imagePan.current = { x: event.clientX, y: event.clientY, left: imageStageRef.current.scrollLeft, top: imageStageRef.current.scrollTop }; setIsImagePanning(true); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!imagePan.current || !imageStageRef.current) return; imageStageRef.current.scrollLeft = imagePan.current.left - (event.clientX - imagePan.current.x); imageStageRef.current.scrollTop = imagePan.current.top - (event.clientY - imagePan.current.y); }} onPointerUp={(event) => { imagePan.current = undefined; setIsImagePanning(false); event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { imagePan.current = undefined; setIsImagePanning(false); }}>
          <img src={imageViewer.src} alt={imageViewer.alt} style={{ width: `${imageScale * 100}%` }} draggable={false} />
        </div>
        {imageViewer.alt && <div className="image-viewer-caption">{imageViewer.alt}</div>}
      </div>}
    </main>
  );
}

function ModeButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: React.ReactNode; onClick: () => void }) {
  return <button type="button" className={active ? "active" : ""} onClick={onClick}>{icon}{label}</button>;
}

function SourceView({ source, onChange, theme, previewRef, searchRequest, onActivate }: { source: string; onChange: (source: string) => void; theme: "light" | "dark"; previewRef: React.RefObject<HTMLDivElement | null>; searchRequest: number; onActivate: () => void }) {
  const lines = source.split(/\r?\n/).length;
  return <div className="source-pane" onPointerDown={onActivate}><div className="source-pane-header"><span className="source-language"><i />MARKDOWN</span><span className="source-hint">可编辑</span><span className="source-stats">{lines} 行 · UTF-8</span></div><div className="editor-frame"><Suspense fallback={<div className="editor-loading">正在加载编辑器…</div>}><MarkdownEditor value={source} theme={theme} searchRequest={searchRequest} onChange={onChange} onScrollRatio={(ratio) => { if (previewRef.current) previewRef.current.scrollTop = ratio * (previewRef.current.scrollHeight - previewRef.current.clientHeight); }} /></Suspense></div></div>;
}

const Preview = forwardRef<HTMLDivElement, { html: string; doc: DocFile; project: DocsProject; onOpenDoc: (doc: DocFile) => void; onOpenImage: (src: string, alt: string) => void; onActivate: () => void }>(function Preview({ html, doc, project, onOpenDoc, onOpenImage, onActivate }, ref) {
  return <div ref={ref} className="preview-pane" onPointerDown={onActivate}><article className="markdown-body" onClick={(event) => { const element = event.target as Element; if (element instanceof HTMLImageElement && !element.hasAttribute("data-missing")) { event.preventDefault(); onOpenImage(element.src, element.alt); return; } const diagram = element.closest(".mermaid-diagram svg") as SVGSVGElement | null; if (diagram) { event.preventDefault(); const markup = new XMLSerializer().serializeToString(diagram); onOpenImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`, "Mermaid 流程图"); return; } const anchor = element.closest("a"); if (!anchor) return; const href = anchor.getAttribute("href") ?? ""; const path = resolveRelativePath(doc.path, href); if (!path || !/\.md$/i.test(path)) return; const target = project.files.find((file) => file.path === path); if (target) { event.preventDefault(); onOpenDoc(target); } }} dangerouslySetInnerHTML={{ __html: html }} /></div>;
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
