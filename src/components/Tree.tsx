import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import { useState } from "react";
import type { DocFile, TreeNode } from "../types";

interface TreeProps {
  nodes: TreeNode[];
  activeId?: string;
  onOpen: (doc: DocFile) => void;
  onContextMenu: (event: React.MouseEvent, doc: DocFile) => void;
  depth?: number;
}

export function Tree({ nodes, activeId, onOpen, onContextMenu, depth = 0 }: TreeProps) {
  return (
    <div className="tree" role={depth === 0 ? "tree" : "group"}>
      {nodes.map((node) =>
        node.type === "folder" ? (
          <FolderItem key={node.path} node={node} activeId={activeId} onOpen={onOpen} onContextMenu={onContextMenu} depth={depth} />
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
          >
            <FileText size={15} />
            <span>{node.name.replace(/\.md$/i, "")}</span>
          </button>
        ),
      )}
    </div>
  );
}

function FolderItem({ node, activeId, onOpen, onContextMenu, depth }: { node: Extract<TreeNode, { type: "folder" }>; activeId?: string; onOpen: (doc: DocFile) => void; onContextMenu: (event: React.MouseEvent, doc: DocFile) => void; depth: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        role="treeitem"
        aria-expanded={open}
        className="tree-row folder-row"
        style={{ paddingLeft: 30 + depth * 20 }}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {open ? <FolderOpen size={15} /> : <Folder size={15} />}
        <span>{node.name}</span>
      </button>
      {open && <Tree nodes={node.children} activeId={activeId} onOpen={onOpen} onContextMenu={onContextMenu} depth={depth + 1} />}
    </div>
  );
}
