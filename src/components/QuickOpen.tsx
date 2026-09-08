import { FileText, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DocFile, DocsProject } from "../types";

export function QuickOpen({ projects, onOpen, onClose }: { projects: DocsProject[]; onOpen: (doc: DocFile) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return projects.flatMap((project) => project.files).filter((doc) => !needle || `${projectNames.get(doc.projectId)} ${doc.path}`.toLocaleLowerCase().includes(needle)).slice(0, 80);
  }, [projects, projectNames, query]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => setSelected(0), [query]);
  const choose = (doc?: DocFile) => { if (doc) onOpen(doc); onClose(); };

  return <div className="quick-open-backdrop" role="presentation" onPointerDown={onClose}>
    <section className="quick-open" role="dialog" aria-modal="true" aria-label="快速打开文档" onPointerDown={(event) => event.stopPropagation()}>
      <div className="quick-open-search"><Search size={18} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onClose(); if (event.key === "ArrowDown") { event.preventDefault(); setSelected((value) => Math.min(results.length - 1, value + 1)); } if (event.key === "ArrowUp") { event.preventDefault(); setSelected((value) => Math.max(0, value - 1)); } if (event.key === "Enter") { event.preventDefault(); choose(results[selected]); } }} placeholder="输入项目名、文件名或路径…" /><kbd>⌘P</kbd><button type="button" onClick={onClose} aria-label="关闭"><X size={16} /></button></div>
      <div className="quick-open-results">{results.map((doc, index) => <button key={doc.id} type="button" className={index === selected ? "active" : ""} onMouseEnter={() => setSelected(index)} onClick={() => choose(doc)}><FileText size={15} /><span><strong>{doc.name.replace(/\.md$/i, "")}</strong><small>{projectNames.get(doc.projectId)} / {doc.path}</small></span></button>)}{!results.length && <p>没有找到匹配的 Markdown 文档</p>}</div>
      <footer><span><kbd>↑↓</kbd> 选择</span><span><kbd>↵</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></footer>
    </section>
  </div>;
}
