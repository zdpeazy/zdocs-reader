import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Plus } from "lucide-react";
import { useState } from "react";
import type { DocFile, TreeNode } from "../types";

interface TreeProps {
  nodes: TreeNode[];
  activeId?: string;
  onOpen: (doc: DocFile) => void;
  onContextMenu: (event: React.MouseEvent, doc: DocFile) => void;
  onFolderContextMenu: (event: React.MouseEvent, path: string, name: string) => void;
  onCreateEntry: (folderPath: string) => void;
  onMoveEntry: (sourcePath: string, targetFolder: string) => void;
  depth?: number;
}

export function Tree({ nodes, activeId, onOpen, onContextMenu, onFolderContextMenu, onCreateEntry, onMoveEntry, depth = 0 }: TreeProps) {
  return (
    <div className="tree" role={depth === 0 ? "tree" : "group"}>
      {nodes.map((node) =>
        node.type === "folder" ? (
          <FolderItem key={node.path} node={node} activeId={activeId} onOpen={onOpen} onContextMenu={onContextMenu} onFolderContextMenu={onFolderContextMenu} onCreateEntry={onCreateEntry} onMoveEntry={onMoveEntry} depth={depth} />
        ) : (
          <button
            type="button"
            role="treeitem"
            key={node.path}
            className={`tree-row file-row ${activeId === node.doc.id ? "active" : ""}`}
            style={{ paddingLeft: 34 + depth * 20 }}
            onClick={() => onOpen(node.doc)}
            onContextMenu={(event) => onContextMenu(event, node.doc)}
            title={node.path}
            draggable
            onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-zdocs-path", node.path); }}
          >
            <FileText size={15} />
            <span>{node.name.replace(/\.md$/i, "")}</span>
          </button>
        ),
      )}
    </div>
  );
}

function FolderItem({ node, activeId, onOpen, onContextMenu, onFolderContextMenu, onCreateEntry, onMoveEntry, depth }: { node: Extract<TreeNode, { type: "folder" }>; activeId?: string; onOpen: (doc: DocFile) => void; onContextMenu: (event: React.MouseEvent, doc: DocFile) => void; onFolderContextMenu: (event: React.MouseEvent, path: string, name: string) => void; onCreateEntry: (folderPath: string) => void; onMoveEntry: (sourcePath: string, targetFolder: string) => void; depth: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div
        role="treeitem"
        aria-expanded={open}
        className="tree-row folder-row"
        style={{ paddingLeft: 30 + depth * 20 }}
        onContextMenu={(event) => onFolderContextMenu(event, node.path, node.name)}
        draggable
        onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-zdocs-path", node.path); }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
        onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const source = event.dataTransfer.getData("application/x-zdocs-path"); if (source && source !== node.path) onMoveEntry(source, node.path); }}
      >
        <button className="folder-main" type="button" onClick={() => setOpen((value) => !value)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{open ? <FolderOpen size={15} /> : <Folder size={15} />}<span>{node.name}</span></button>
        <button className="tree-add" type="button" aria-label={`在 ${node.name} 中新建`} title="新建" onClick={() => onCreateEntry(node.path)}><Plus size={13} /></button>
      </div>
      {open && <Tree nodes={node.children} activeId={activeId} onOpen={onOpen} onContextMenu={onContextMenu} onFolderContextMenu={onFolderContextMenu} onCreateEntry={onCreateEntry} onMoveEntry={onMoveEntry} depth={depth + 1} />}
    </div>
  );
}
