import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DocFile, TreeNode } from "../types";

interface TreeProps {
  projectId: string;
  nodes: TreeNode[];
  activeId?: string;
  revealDocId?: string;
  revealRequest?: number;
  onOpen: (doc: DocFile) => void;
  onContextMenu: (event: React.MouseEvent, doc: DocFile) => void;
  onFolderContextMenu: (event: React.MouseEvent, path: string, name: string) => void;
  onCreateEntry: (folderPath: string) => void;
  onMoveEntry: (sourcePath: string, targetFolder: string) => void;
  depth?: number;
}

export function Tree({ projectId, nodes, activeId, revealDocId, revealRequest, onOpen, onContextMenu, onFolderContextMenu, onCreateEntry, onMoveEntry, depth = 0 }: TreeProps) {
  const pointerDrag = useRef<{ pointerId: number; sourcePath: string; name: string; x: number; y: number; dragging: boolean } | undefined>(undefined);
  const suppressClick = useRef(false);
  const [draggingPath, setDraggingPath] = useState<string>();
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number; name: string }>();

  function clearPointerTarget() {
    document.querySelectorAll(".pointer-drop-active").forEach((element) => element.classList.remove("pointer-drop-active"));
  }

  function beginFileDrag(event: React.PointerEvent<HTMLButtonElement>, sourcePath: string, name: string) {
    if (event.button !== 0) return;
    pointerDrag.current = { pointerId: event.pointerId, sourcePath, name, x: event.clientX, y: event.clientY, dragging: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveFileDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
    if (!drag.dragging) {
      drag.dragging = true;
      suppressClick.current = true;
      setDraggingPath(drag.sourcePath);
      document.body.classList.add("is-entry-dragging");
    }
    setDragPreview({ x: event.clientX, y: event.clientY, name: drag.name });
    clearPointerTarget();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(`[data-zdocs-drop-project="${CSS.escape(projectId)}"][data-folder-path]`);
    if (target && target.dataset.folderPath !== drag.sourcePath) target.classList.add("pointer-drop-active");
  }

  function endFileDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const target = drag.dragging ? document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(`[data-zdocs-drop-project="${CSS.escape(projectId)}"][data-folder-path]`) : undefined;
    const targetFolder = target?.dataset.folderPath;
    clearPointerTarget();
    document.body.classList.remove("is-entry-dragging");
    setDraggingPath(undefined);
    setDragPreview(undefined);
    pointerDrag.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.dragging && targetFolder !== undefined && targetFolder !== drag.sourcePath.split("/").slice(0, -1).join("/")) onMoveEntry(drag.sourcePath, targetFolder);
    window.setTimeout(() => { suppressClick.current = false; }, 0);
  }

  return <>
    <div className="tree" role={depth === 0 ? "tree" : "group"}>
      {nodes.map((node) =>
        node.type === "folder" ? (
          <FolderItem key={node.path} projectId={projectId} node={node} activeId={activeId} revealDocId={revealDocId} revealRequest={revealRequest} onOpen={onOpen} onContextMenu={onContextMenu} onFolderContextMenu={onFolderContextMenu} onCreateEntry={onCreateEntry} onMoveEntry={onMoveEntry} depth={depth} />
        ) : (
          <button
            type="button"
            role="treeitem"
            key={node.path}
            data-doc-id={node.doc.id}
            className={`tree-row file-row ${activeId === node.doc.id ? "active" : ""} ${draggingPath === node.path ? "pointer-dragging" : ""}`}
            style={{ paddingLeft: 34 + depth * 20 }}
            onClick={(event) => { if (suppressClick.current) { event.preventDefault(); return; } onOpen(node.doc); }}
            onContextMenu={(event) => onContextMenu(event, node.doc)}
            title={node.path}
            onPointerDown={(event) => beginFileDrag(event, node.path, node.name)}
            onPointerMove={moveFileDrag}
            onPointerUp={endFileDrag}
            onPointerCancel={endFileDrag}
          >
            <FileText size={15} />
            <span>{node.name.replace(/\.md$/i, "")}</span>
          </button>
        ),
      )}
    </div>
    {dragPreview && createPortal(<div className="file-drag-preview" style={{ left: dragPreview.x + 14, top: dragPreview.y + 12 }}><span className="file-drag-preview-icon"><FileText size={15} /></span><span>{dragPreview.name.replace(/\.md$/i, "")}</span><small>移动</small></div>, document.body)}
  </>;
}

function FolderItem({ projectId, node, activeId, revealDocId, revealRequest, onOpen, onContextMenu, onFolderContextMenu, onCreateEntry, onMoveEntry, depth }: { projectId: string; node: Extract<TreeNode, { type: "folder" }>; activeId?: string; revealDocId?: string; revealRequest?: number; onOpen: (doc: DocFile) => void; onContextMenu: (event: React.MouseEvent, doc: DocFile) => void; onFolderContextMenu: (event: React.MouseEvent, path: string, name: string) => void; onCreateEntry: (folderPath: string) => void; onMoveEntry: (sourcePath: string, targetFolder: string) => void; depth: number }) {
  const [open, setOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const containsReveal = node.children.some(function contains(child): boolean { return child.type === "file" ? child.doc.id === revealDocId : child.children.some(contains); });
  useEffect(() => { if (containsReveal) setOpen(true); }, [containsReveal, revealRequest]);
  return (
    <div>
      <div
        role="treeitem"
        aria-expanded={open}
        className={`tree-row folder-row ${dropActive ? "drop-active" : ""}`}
        data-zdocs-drop-project={projectId}
        data-folder-path={node.path}
        style={{ paddingLeft: 30 + depth * 20 }}
        onContextMenu={(event) => onFolderContextMenu(event, node.path, node.name)}
        draggable
        onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-zdocs-path", node.path); event.dataTransfer.setData("application/x-zdocs-entry", JSON.stringify({ projectId, path: node.path, type: "folder" })); }}
        onDragOver={(event) => { const payload = event.dataTransfer.getData("application/x-zdocs-entry"); if (payload) { try { if ((JSON.parse(payload) as { projectId: string }).projectId !== projectId) return; } catch { return; } } event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; setDropActive(true); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false); }}
        onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDropActive(false); const payload = event.dataTransfer.getData("application/x-zdocs-entry"); let source = event.dataTransfer.getData("application/x-zdocs-path"); if (payload) { try { const entry = JSON.parse(payload) as { projectId: string; path: string }; if (entry.projectId !== projectId) return; source = entry.path; } catch { return; } } if (source && source !== node.path) onMoveEntry(source, node.path); }}
      >
        <button className="folder-main" type="button" onClick={() => setOpen((value) => !value)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{open ? <FolderOpen size={15} /> : <Folder size={15} />}<span>{node.name}</span></button>
        <button className="tree-add" type="button" aria-label={`在 ${node.name} 中新建`} title="新建" onClick={() => onCreateEntry(node.path)}><Plus size={13} /></button>
      </div>
      {open && <Tree projectId={projectId} nodes={node.children} activeId={activeId} revealDocId={revealDocId} revealRequest={revealRequest} onOpen={onOpen} onContextMenu={onContextMenu} onFolderContextMenu={onFolderContextMenu} onCreateEntry={onCreateEntry} onMoveEntry={onMoveEntry} depth={depth + 1} />}
    </div>
  );
}
