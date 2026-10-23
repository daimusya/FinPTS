// Рабочая сборка (output: "standalone") не копирует сама папки public и .next/static —
// без них страницы без стилей. Копирует их в .next/standalone после npm run build.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath decodes the path (the project folder name is Cyrillic).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");
if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error("Нет рабочей сборки (.next/standalone/server.js) — выполните npm run build");
  process.exit(1);
}
fs.cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
fs.cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
// The build copies .env next to server.js; refresh it so a changed .env applies without a rebuild.
if (fs.existsSync(path.join(root, ".env"))) fs.copyFileSync(path.join(root, ".env"), path.join(standalone, ".env"));
