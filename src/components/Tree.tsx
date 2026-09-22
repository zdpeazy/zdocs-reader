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
  const pointerDrag = useRef<{ pointerId: number; sourcePath: string; name: string; type: "file" | "folder"; x: number; y: number; dragging: boolean } | undefined>(undefined);
  const suppressClick = useRef(false);
  const [draggingPath, setDraggingPath] = useState<string>();
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number; name: string; type: "file" | "folder" }>();

  function clearPointerTarget() {
    document.querySelectorAll(".pointer-drop-active").forEach((element) => element.classList.remove("pointer-drop-active"));
  }

  function isValidTarget(sourcePath: string, sourceType: "file" | "folder", targetFolder: string) {
    if (targetFolder === sourcePath.split("/").slice(0, -1).join("/")) return false;
    if (sourceType === "folder" && (targetFolder === sourcePath || targetFolder.startsWith(`${sourcePath}/`))) return false;
    return true;
  }

  function beginEntryDrag(event: React.PointerEvent<HTMLElement>, sourcePath: string, name: string, type: "file" | "folder") {
    if (event.button !== 0) return;
    pointerDrag.current = { pointerId: event.pointerId, sourcePath, name, type, x: event.clientX, y: event.clientY, dragging: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveEntryDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
    if (!drag.dragging) {
      drag.dragging = true;
      suppressClick.current = true;
      setDraggingPath(drag.sourcePath);
      document.body.classList.add("is-entry-dragging");
    }
    setDragPreview({ x: event.clientX, y: event.clientY, name: drag.name, type: drag.type });
    clearPointerTarget();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(`[data-zdocs-drop-project="${CSS.escape(projectId)}"][data-folder-path]`);
    const targetFolder = target?.dataset.folderPath;
    if (target && targetFolder !== undefined && isValidTarget(drag.sourcePath, drag.type, targetFolder)) target.classList.add("pointer-drop-active");
  }

  function endEntryDrag(event: React.PointerEvent<HTMLElement>) {
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
    if (drag.dragging && targetFolder !== undefined && isValidTarget(drag.sourcePath, drag.type, targetFolder)) onMoveEntry(drag.sourcePath, targetFolder);
    window.setTimeout(() => { suppressClick.current = false; }, 0);
  }

  return <>
    <div className="tree" role={depth === 0 ? "tree" : "group"}>
      {nodes.map((node) =>
        node.type === "folder" ? (
          <FolderItem key={node.path} projectId={projectId} node={node} activeId={activeId} revealDocId={revealDocId} revealRequest={revealRequest} onOpen={onOpen} onContextMenu={onContextMenu} onFolderContextMenu={onFolderContextMenu} onCreateEntry={onCreateEntry} onMoveEntry={onMoveEntry} depth={depth} isDragging={draggingPath === node.path} suppressClick={suppressClick} onPointerDown={(event) => beginEntryDrag(event, node.path, node.name, "folder")} onPointerMove={moveEntryDrag} onPointerEnd={endEntryDrag} />
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
            onPointerDown={(event) => beginEntryDrag(event, node.path, node.name, "file")}
            onPointerMove={moveEntryDrag}
            onPointerUp={endEntryDrag}
            onPointerCancel={endEntryDrag}
          >
            <FileText size={15} />
            <span>{node.name.replace(/\.md$/i, "")}</span>
          </button>
        ),
      )}
    </div>
    {dragPreview && createPortal(<div className="file-drag-preview" style={{ left: dragPreview.x + 14, top: dragPreview.y + 12 }}><span className="file-drag-preview-icon">{dragPreview.type === "folder" ? <Folder size={15} /> : <FileText size={15} />}</span><span>{dragPreview.name.replace(/\.md$/i, "")}</span><small>移动</small></div>, document.body)}
  </>;
}

function FolderItem({ projectId, node, activeId, revealDocId, revealRequest, onOpen, onContextMenu, onFolderContextMenu, onCreateEntry, onMoveEntry, depth, isDragging, suppressClick, onPointerDown, onPointerMove, onPointerEnd }: { projectId: string; node: Extract<TreeNode, { type: "folder" }>; activeId?: string; revealDocId?: string; revealRequest?: number; onOpen: (doc: DocFile) => void; onContextMenu: (event: React.MouseEvent, doc: DocFile) => void; onFolderContextMenu: (event: React.MouseEvent, path: string, name: string) => void; onCreateEntry: (folderPath: string) => void; onMoveEntry: (sourcePath: string, targetFolder: string) => void; depth: number; isDragging: boolean; suppressClick: React.MutableRefObject<boolean>; onPointerDown: (event: React.PointerEvent<HTMLElement>) => void; onPointerMove: (event: React.PointerEvent<HTMLElement>) => void; onPointerEnd: (event: React.PointerEvent<HTMLElement>) => void }) {
  const [open, setOpen] = useState(false);
  const containsReveal = node.children.some(function contains(child): boolean { return child.type === "file" ? child.doc.id === revealDocId : child.children.some(contains); });
  useEffect(() => { if (containsReveal) setOpen(true); }, [containsReveal, revealRequest]);
  return (
    <div>
      <div
        role="treeitem"
        aria-expanded={open}
        className={`tree-row folder-row ${isDragging ? "pointer-dragging" : ""}`}
        data-zdocs-drop-project={projectId}
        data-folder-path={node.path}
        style={{ paddingLeft: 30 + depth * 20 }}
        onContextMenu={(event) => onFolderContextMenu(event, node.path, node.name)}
      >
        <button className="folder-main" type="button" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onClick={(event) => { if (suppressClick.current) { event.preventDefault(); return; } setOpen((value) => !value); }}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{open ? <FolderOpen size={15} /> : <Folder size={15} />}<span>{node.name}</span></button>
        <button className="tree-add" type="button" aria-label={`在 ${node.name} 中新建`} title="新建" onClick={() => onCreateEntry(node.path)}><Plus size={13} /></button>
      </div>
      {open && <Tree projectId={projectId} nodes={node.children} activeId={activeId} revealDocId={revealDocId} revealRequest={revealRequest} onOpen={onOpen} onContextMenu={onContextMenu} onFolderContextMenu={onFolderContextMenu} onCreateEntry={onCreateEntry} onMoveEntry={onMoveEntry} depth={depth + 1} />}
    </div>
  );
}
