import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { openSearchPanel } from "@codemirror/search";
import { useEffect, useRef } from "react";
import type { EditorView as EditorViewType } from "@codemirror/view";

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

export default function MarkdownEditor({ value, onChange, theme, onScrollRatio, searchRequest = 0 }: { value: string; onChange: (value: string) => void; theme: "light" | "dark"; onScrollRatio: (ratio: number) => void; searchRequest?: number }) {
  const editor = useRef<EditorViewType | null>(null);
  useEffect(() => { if (searchRequest && editor.current) { editor.current.focus(); openSearchPanel(editor.current); } }, [searchRequest]);
  return <CodeMirror value={value} height="100%" extensions={theme === "dark" ? [markdown()] : [markdown(), lightEditorTheme, syntaxHighlighting(markdownHighlight)]} theme={theme === "dark" ? oneDark : undefined} onCreateEditor={(view) => { editor.current = view; }} onChange={onChange} onUpdate={(update) => { const scroller = update.view.scrollDOM; const max = scroller.scrollHeight - scroller.clientHeight; if (max > 0) onScrollRatio(scroller.scrollTop / max); }} basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, bracketMatching: true, closeBrackets: true, autocompletion: true, searchKeymap: true, highlightSelectionMatches: true }} />;
}
