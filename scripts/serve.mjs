import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number.parseInt(process.env.PORT || "4173", 10);

const types = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".xml", "application/xml; charset=utf-8"],
  [".ico", "image/x-icon"]
]);

function resolveRequest(url) {
  const parsed = new URL(url, `http://localhost:${port}`);
  const decoded = decodeURIComponent(parsed.pathname);
  let filePath = path.join(root, decoded);

  if (!filePath.startsWith(root)) {
    return null;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (!existsSync(filePath) && !path.extname(filePath)) {
    const htmlPath = `${filePath}.html`;
    if (existsSync(htmlPath)) {
      filePath = htmlPath;
    }
  }

  return filePath;
}

const server = createServer((req, res) => {
  const filePath = resolveRequest(req.url || "/");
  const notFoundPath = path.join(root, "404.html");
  const finalPath = filePath && existsSync(filePath) ? filePath : notFoundPath;

  if (!existsSync(finalPath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const ext = path.extname(finalPath).toLowerCase();
  res.writeHead(finalPath === notFoundPath ? 404 : 200, {
    "content-type": types.get(ext) || "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(finalPath).pipe(res);
});

server.listen(port, () => {
  console.log(`Serving ${root}`);
  console.log(`Local: http://localhost:${port}/`);
});
