import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const PORT = Number.parseInt(process.env.PORT || "5173", 10);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function resolvePath(urlPath) {
  const cleaned = urlPath === "/" ? "/local/index.html" : urlPath;
  const normalized = path.normalize(cleaned).replace(/^\.+/, "");
  return path.join(ROOT, normalized);
}

const server = http.createServer(async (req, res) => {
  try {
    const filePath = resolvePath(req.url || "/");
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": mime });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Local widget preview: http://localhost:${PORT}`);
});