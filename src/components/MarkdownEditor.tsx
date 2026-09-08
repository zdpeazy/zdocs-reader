import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { openSearchPanel } from "@codemirror/search";
import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { useEffect, useMemo, useRef } from "react";
import type { EditorView as EditorViewType } from "@codemirror/view";

export type EditorCommandType = "heading" | "bold" | "italic" | "link" | "image" | "inline-code" | "code-block" | "table" | "task";
export type EditorCommand = { id: number; type: EditorCommandType };

const lightEditorTheme = EditorView.theme({
  "&": { color: "#343630" },
  ".cm-content": { caretColor: "#d9613c" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#d9613c", borderLeftWidth: "2px" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "#d9613c25 !important" },
});

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, color: "#a9492d", fontWeight: "700" },
  { tag: [tags.link, tags.url], color: "#39719d", textDecoration: "underline" },
  { tag: tags.emphasis, color: "#69549a", fontStyle: "italic" },
  { tag: tags.strong, color: "#87541f", fontWeight: "700" },
  { tag: [tags.monospace, tags.string], color: "#39734c" },
  { tag: tags.quote, color: "#72766e", fontStyle: "italic" },
  { tag: [tags.meta, tags.processingInstruction], color: "#a1a39b" },
]);

export default function MarkdownEditor({ docId, value, onChange, theme, onScrollRatio, initialScrollRatio = 0, searchRequest = 0, command, pathSuggestions = [], headingSuggestions = [], onPasteImage }: { docId: string; value: string; onChange: (value: string) => void; theme: "light" | "dark"; onScrollRatio: (ratio: number) => void; initialScrollRatio?: number; searchRequest?: number; command?: EditorCommand; pathSuggestions?: string[]; headingSuggestions?: string[]; onPasteImage?: (file: File) => Promise<string> }) {
  const editor = useRef<EditorViewType | null>(null);
  useEffect(() => { if (searchRequest && editor.current) { editor.current.focus(); openSearchPanel(editor.current); } }, [searchRequest]);
  useEffect(() => {
    const view = editor.current;
    if (!view || !command) return;
    const selection = view.state.selection.main;
    const selected = view.state.sliceDoc(selection.from, selection.to);
    const replacements: Record<EditorCommandType, { text: string; offset?: number }> = {
      heading: { text: `## ${selected || "二级标题"}`, offset: selected ? undefined : 3 },
      bold: { text: `**${selected || "粗体文字"}**`, offset: selected ? undefined : 2 },
      italic: { text: `*${selected || "斜体文字"}*`, offset: selected ? undefined : 1 },
      link: { text: `[${selected || "链接文字"}](url)`, offset: selected ? selected.length + 3 : 1 },
      image: { text: `![${selected || "图片说明"}](assets/image.png)`, offset: selected ? undefined : 2 },
      "inline-code": { text: `\`${selected || "code"}\``, offset: selected ? undefined : 1 },
      "code-block": { text: `\n\`\`\`\n${selected || "代码"}\n\`\`\`\n`, offset: selected ? undefined : 5 },
      table: { text: `\n| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n` },
      task: { text: `- [ ] ${selected || "待办事项"}`, offset: selected ? undefined : 6 },
    };
    const replacement = replacements[command.type];
    view.dispatch({ changes: { from: selection.from, to: selection.to, insert: replacement.text }, selection: { anchor: selection.from + (replacement.offset ?? replacement.text.length) } });
    view.focus();
  }, [command]);
  const smartExtensions = useMemo(() => {
    const complete = (context: CompletionContext) => {
      const before = context.state.sliceDoc(Math.max(0, context.pos - 160), context.pos);
      const word = context.matchBefore(/[\w./#-]*/);
      if (!word) return null;
      if (/\]\([^)]*$/.test(before)) return { from: word.from, options: pathSuggestions.map((label) => ({ label, type: "file" })) };
      if (/(?:^|\s)#[\w\u4e00-\u9fff-]*$/.test(before)) return { from: word.from, options: headingSuggestions.map((label) => ({ label, type: "text", apply: label })) };
      return null;
    };
    const paste = EditorView.domEventHandlers({ paste(event, view) {
      const image = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith("image/"));
      if (!image || !onPasteImage) return false;
      event.preventDefault();
      const position = view.state.selection.main.from;
      void onPasteImage(image).then((path) => view.dispatch({ changes: { from: position, insert: `![${image.name || "粘贴图片"}](${path})` } }));
      return true;
    } });
    const horizontalTrackpad = EditorView.domEventHandlers({ wheel(event, view) {
      if (Math.abs(event.deltaX) < 1 || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return false;
      const scroller = view.scrollDOM;
      const before = scroller.scrollLeft;
      scroller.scrollLeft += event.deltaX;
      if (scroller.scrollLeft === before) return false;
      event.preventDefault();
      return true;
    } });
    return [autocompletion({ override: [complete] }), paste, horizontalTrackpad];
  }, [pathSuggestions, headingSuggestions, onPasteImage]);
  const extensions = theme === "dark" ? [markdown(), ...smartExtensions] : [markdown(), lightEditorTheme, syntaxHighlighting(markdownHighlight), ...smartExtensions];
  return <CodeMirror value={value} height="100%" extensions={extensions} theme={theme === "dark" ? oneDark : undefined} onCreateEditor={(view) => { editor.current = view; requestAnimationFrame(() => { const max = view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight; view.scrollDOM.scrollTop = max * initialScrollRatio; const cursor = Math.min(Number(localStorage.getItem(`zdocs:cursor:${docId}`)) || 0, view.state.doc.length); view.dispatch({ selection: { anchor: cursor }, scrollIntoView: initialScrollRatio === 0 }); }); }} onChange={onChange} onUpdate={(update) => { localStorage.setItem(`zdocs:cursor:${docId}`, String(update.state.selection.main.head)); const scroller = update.view.scrollDOM; const max = scroller.scrollHeight - scroller.clientHeight; if (max > 0) onScrollRatio(scroller.scrollTop / max); }} basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, bracketMatching: true, closeBrackets: true, autocompletion: false, searchKeymap: true, highlightSelectionMatches: true }} />;
}
