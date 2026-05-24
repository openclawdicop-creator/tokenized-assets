import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(new URL("../index.html", import.meta.url)));
const jupiterApiKey = process.env.JUPITER_API_KEY || "";
const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"]
]);

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function normalizeJupiterEndpoint(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function resolveJupiterQuoteUrl(urlValue) {
  if (!urlValue) return null;
  const parsed = new URL(urlValue);
  if (!parsed.pathname.endsWith("/quote")) {
    parsed.pathname = "/swap/v1/quote";
  }
  return parsed;
}

async function fetchJupiterQuote(urlValue) {
  const url = resolveJupiterQuoteUrl(urlValue);
  if (!url) {
    throw new Error("Endpoint Jupiter invalido.");
  }

  const headers = {};
  if (jupiterApiKey) {
    headers["x-api-key"] = jupiterApiKey;
  }

  const response = await fetch(url, { method: "GET", headers });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text ? { raw: text } : null;
  }

  if (!response.ok) {
    const message = payload?.error || payload?.message || payload?.detail || `Jupiter retornou erro ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload ?? {};
}

async function fetchJupiterToken(query) {
  const url = new URL("https://lite-api.jup.ag/tokens/v2/search");
  url.searchParams.set("query", query);
  const headers = {};
  if (jupiterApiKey) {
    headers["x-api-key"] = jupiterApiKey;
  }

  const response = await fetch(url, { method: "GET", headers });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text ? { raw: text } : null;
  }

  if (!response.ok) {
    const message = payload?.error || payload?.message || payload?.detail || `Jupiter retornou erro ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload ?? [];
}

async function proxyJupiterQuote(req, res) {
  const reqUrl = new URL(req.url || "/", "http://127.0.0.1");
  const endpoint = normalizeJupiterEndpoint(reqUrl.searchParams.get("url") || "https://lite-api.jup.ag/swap/v1/quote");
  try {
    const payload = await fetchJupiterQuote(endpoint);
    json(res, 200, {
      ...payload,
      _source: endpoint
    });
  } catch (error) {
    json(res, error.status || 502, {
      error: error.message || "Falha ao consultar Jupiter.",
      details: error.payload || null
    });
  }
}

async function proxyJupiterToken(req, res) {
  const reqUrl = new URL(req.url || "/", "http://127.0.0.1");
  const query = String(reqUrl.searchParams.get("query") || "").trim();
  if (!query) {
    json(res, 400, { error: "Informe o contrato do token." });
    return;
  }

  try {
    json(res, 200, await fetchJupiterToken(query));
  } catch (error) {
    json(res, error.status || 502, {
      error: error.message || "Falha ao consultar token na Jupiter.",
      details: error.payload || null
    });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      res.end();
      return;
    }

    const reqPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (req.method === "GET" && reqPath === "/api/jupiter/quote") {
      await proxyJupiterQuote(req, res);
      return;
    }
    if (req.method === "GET" && reqPath === "/api/jupiter/token") {
      await proxyJupiterToken(req, res);
      return;
    }
    const rel = reqPath === "/" ? "/index.html" : reqPath;
    const filePath = path.resolve(root, `.${rel}`);
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mime.get(path.extname(filePath)) || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(8000, "127.0.0.1", () => {
  console.log("Serving http://127.0.0.1:8000");
});
