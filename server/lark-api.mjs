import { spawn } from "node:child_process";

function runLark(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("lark-cli", args, { cwd: process.cwd(), env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      let payload;
      try { payload = JSON.parse(stdout); } catch { payload = undefined; }
      if (code !== 0 || !payload?.ok) {
        reject(new Error(payload?.error?.message || payload?.message || stderr.trim() || "飞书命令执行失败"));
        return;
      }
      resolve(payload);
    });
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
  });
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 15 * 1024 * 1024) throw new Error("请求内容超过 15MB 限制");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function documentData(result) {
  return result?.data?.document ?? {};
}

export async function handleLarkApi(request, response) {
  if (!request.url?.startsWith("/api/lark/")) return false;
  try {
    if (request.method === "GET" && request.url === "/api/lark/status") {
      const status = await runLark(["auth", "status", "--json"]);
      sendJson(response, 200, { ok: true, data: status });
      return true;
    }

    if (request.method === "POST" && request.url === "/api/lark/import") {
      const { url } = await readJson(request);
      if (!url || typeof url !== "string") throw new Error("请输入飞书文档链接或 token");
      const fetched = await runLark(["docs", "+fetch", "--as", "user", "--doc", url, "--doc-format", "markdown", "--detail", "simple"]);
      const document = documentData(fetched);
      sendJson(response, 200, { ok: true, document: { token: document.document_id, revision: document.revision_id, content: document.content ?? "", title: document.title ?? "飞书文档", url } });
      return true;
    }

    if (request.method === "POST" && request.url === "/api/lark/publish") {
      const { title, content, docUrl } = await readJson(request);
      if (typeof content !== "string") throw new Error("Markdown 内容不能为空");
      let document;
      let warnings = [];
      if (docUrl) {
        await runLark(["docs", "+fetch", "--as", "user", "--doc", docUrl, "--doc-format", "markdown", "--detail", "with-ids"]);
        const updated = await runLark(["docs", "+update", "--as", "user", "--doc", docUrl, "--command", "overwrite", "--doc-format", "markdown", "--content", "-"], content);
        warnings = updated?.data?.warnings ?? updated?.warnings ?? [];
        const verified = await runLark(["docs", "+fetch", "--as", "user", "--doc", docUrl, "--doc-format", "markdown", "--detail", "simple"]);
        document = { ...documentData(verified), url: docUrl };
      } else {
        const created = await runLark(["docs", "+create", "--as", "user", "--title", title || "Markdown 文档", "--doc-format", "markdown", "--content", "-"], content);
        warnings = created?.data?.warnings ?? created?.warnings ?? [];
        const createdDocument = documentData(created);
        const target = createdDocument.url || createdDocument.document_id;
        const verified = await runLark(["docs", "+fetch", "--as", "user", "--doc", target, "--doc-format", "markdown", "--detail", "simple"]);
        document = { ...documentData(verified), url: createdDocument.url };
      }
      sendJson(response, 200, { ok: true, document: { token: document.document_id, revision: document.revision_id, url: document.url || docUrl }, warnings });
      return true;
    }

    sendJson(response, 404, { ok: false, error: "接口不存在" });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : "飞书操作失败" });
  }
  return true;
}
