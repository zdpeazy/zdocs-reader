export interface LarkBinding {
  url: string;
  token?: string;
  revision?: number;
  syncedAt: string;
}

async function callLark<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/lark/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "飞书操作失败");
  return result;
}

export function checkLarkStatus() {
  if (isDesktop()) return invoke<unknown>("lark_status").then((data) => ({ ok: true as const, data }));
  return callLark<{ ok: true; data: unknown }>("status");
}

export function importLarkDocument(url: string) {
  if (isDesktop()) return invoke<{ ok: true; document: { token: string; revision: number; content: string; title: string; url: string } }>("lark_import", { url });
  return callLark<{ ok: true; document: { token: string; revision: number; content: string; title: string; url: string } }>("import", { url });
}

export function publishLarkDocument(title: string, content: string, docUrl?: string) {
  if (isDesktop()) return invoke<{ ok: true; document: { token: string; revision: number; url: string }; warnings: string[] }>("lark_publish", { input: { title, content, docUrl } });
  return callLark<{ ok: true; document: { token: string; revision: number; url: string }; warnings: string[] }>("publish", { title, content, docUrl });
}

export function loadLarkBindings(): Record<string, LarkBinding> {
  try { return JSON.parse(localStorage.getItem("zdocs:lark-bindings") ?? "{}"); } catch { return {}; }
}

export function saveLarkBindings(bindings: Record<string, LarkBinding>) {
  localStorage.setItem("zdocs:lark-bindings", JSON.stringify(bindings));
}
import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "./file-system";
