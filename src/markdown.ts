import { marked } from "marked";
import DOMPurify from "dompurify";
import markedKatex from "marked-katex-extension";
import type { Heading } from "./types";

marked.setOptions({ gfm: true, breaks: false });
marked.use(markedKatex({ throwOnError: false, nonStandard: true }));

function slugify(text: string, used: Map<string, number>) {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-") || "section";
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count ? `${base}-${count}` : base;
}

export function parseMarkdown(source: string) {
  const headings: Heading[] = [];
  const used = new Map<string, number>();
  const renderer = new marked.Renderer();
  renderer.heading = ({ tokens, depth }) => {
    const text = marked.Parser.parseInline(tokens);
    const plainText = text.replace(/<[^>]*>/g, "");
    const id = slugify(plainText, used);
    headings.push({ id, text: plainText, level: depth });
    return `<h${depth} id="${id}">${text}</h${depth}>`;
  };

  return {
    html: DOMPurify.sanitize(marked.parse(source, { renderer }) as string),
    headings,
  };
}
