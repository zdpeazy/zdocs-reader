import { CloudDownload, CloudUpload, ExternalLink, LoaderCircle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { checkLarkStatus, importLarkDocument, publishLarkDocument, type LarkBinding } from "../lark";
import type { DocFile, DocsProject } from "../types";

export function LarkDialog({ projects, activeDoc, source, binding, onClose, onImported, onPublished }: { projects: DocsProject[]; activeDoc?: DocFile; source: string; binding?: LarkBinding; onClose: () => void; onImported: (projectId: string, path: string, content: string, binding: LarkBinding) => Promise<void>; onPublished: (binding: LarkBinding) => void }) {
  const [tab, setTab] = useState<"import" | "publish">(activeDoc ? "publish" : "import");
  const [url, setUrl] = useState("");
  const [projectId, setProjectId] = useState(projects.find((project) => project.accessStatus === "granted")?.id ?? "");
  const [path, setPath] = useState("docs/feishu-document.md");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [authError, setAuthError] = useState<string>();
  const availableProjects = useMemo(() => projects.filter((project) => project.accessStatus === "granted"), [projects]);

  useEffect(() => { checkLarkStatus().then(() => setAuthenticated(true)).catch((cause) => { setAuthenticated(false); setAuthError(cause instanceof Error ? cause.message : "飞书账号未连接"); }); }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  async function importDoc() {
    try {
      setBusy(true); setError(undefined);
      const result = await importLarkDocument(url.trim());
      const title = result.document.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
      const safeTitle = title?.replace(/[\\/:*?"<>|]/g, "-");
      const destination = path === "docs/feishu-document.md" && safeTitle ? `docs/${safeTitle}.md` : path;
      await onImported(projectId, destination, result.document.content, { url, token: result.document.token, revision: result.document.revision, syncedAt: new Date().toISOString() });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导入失败"); } finally { setBusy(false); }
  }

  async function publish() {
    if (!activeDoc) return;
    try {
      setBusy(true); setError(undefined);
      const result = await publishLarkDocument(activeDoc.name.replace(/\.md$/i, ""), source, binding?.url);
      onPublished({ url: result.document.url, token: result.document.token, revision: result.document.revision, syncedAt: new Date().toISOString() });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "发布失败"); } finally { setBusy(false); }
  }

  return <div className="dialog-backdrop"><section className="lark-dialog" role="dialog" aria-modal="true" aria-labelledby="lark-title">
    <button className="dialog-close" type="button" onClick={onClose} aria-label="关闭"><X size={17} /></button>
    <div className="lark-heading"><span className="lark-logo">飞</span><div><h2 id="lark-title">飞书文档</h2><p>导入本地，或将当前 Markdown 发布到飞书</p></div></div>
    <div className="lark-tabs"><button type="button" className={tab === "import" ? "active" : ""} onClick={() => setTab("import")}><CloudDownload size={15} />导入文档</button><button type="button" disabled={!activeDoc} className={tab === "publish" ? "active" : ""} onClick={() => setTab("publish")}><CloudUpload size={15} />发布文档</button></div>
    {authenticated === false && <div className="lark-auth-warning"><strong>飞书账号尚未就绪</strong><span>{authError}</span><small>请先在终端运行 <code>lark-cli config init</code>，然后运行 <code>lark-cli auth login</code>。</small></div>}
    {tab === "import" ? <div className="lark-form"><label>飞书文档或 Wiki 链接<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://xxx.feishu.cn/docx/..." autoFocus /></label><label>保存到项目<select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{availableProjects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><label>项目内路径<input value={path} onChange={(event) => setPath(event.target.value)} placeholder="docs/文档名.md" /></label><button className="lark-primary" disabled={busy || !url.trim() || !projectId || authenticated === false} type="button" onClick={importDoc}>{busy ? <LoaderCircle className="spin" size={16} /> : <CloudDownload size={16} />}导入为 Markdown</button></div> : <div className="lark-publish"><div className="publish-file"><span>当前文档</span><strong>{activeDoc?.path}</strong></div>{binding ? <div className="binding-state"><span>已绑定飞书文档</span><a href={binding.url} target="_blank" rel="noreferrer">打开文档 <ExternalLink size={13} /></a><small>上次发布：{new Date(binding.syncedAt).toLocaleString()}</small></div> : <p>首次发布将创建一篇新的飞书文档；后续发布会更新同一篇文档。</p>}<button className="lark-primary" disabled={busy || !activeDoc || authenticated === false} type="button" onClick={publish}>{busy ? <LoaderCircle className="spin" size={16} /> : <CloudUpload size={16} />}{binding ? "更新飞书文档" : "创建飞书文档"}</button></div>}
    {error && <div className="lark-error">{error}</div>}
  </section></div>;
}
