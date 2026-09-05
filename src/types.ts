export type ViewMode = "source" | "preview" | "split";

export interface DocFile {
  id: string;
  name: string;
  path: string;
  projectId: string;
  handle?: FileSystemFileHandle;
  nativePath?: string;
}

export interface FolderNode {
  type: "folder";
  name: string;
  path: string;
  children: TreeNode[];
}

export interface FileNode {
  type: "file";
  name: string;
  path: string;
  doc: DocFile;
}

export type TreeNode = FolderNode | FileNode;

export interface DocsProject {
  id: string;
  name: string;
  rootHandle?: FileSystemDirectoryHandle;
  rootPath?: string;
  accessStatus: "granted" | "needs-permission";
  tree: TreeNode[];
  files: DocFile[];
}

export interface Heading {
  id: string;
  text: string;
  level: number;
}
