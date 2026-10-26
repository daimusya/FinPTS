// Готовит рабочую сборку к запуску на этом компьютере (scripts/start-platform.ps1):
// 1. Рабочая сборка (output: "standalone") не копирует сама папки public и .next/static —
//    без них страницы без стилей; копирует их в .next/standalone.
// 2. Переносит сборку в .platform — платформа работает из своей копии, поэтому новая
//    сборка (npm run build) не мешает работающей; копия обновляется при следующем запуске.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath decodes the path (the project folder name is Cyrillic).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");
const platform = path.join(root, ".platform");
if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error("Нет рабочей сборки (.next/standalone/server.js) — выполните npm run build");
  process.exit(1);
}

const buildId = (dir) => {
  try {
    return fs.readFileSync(path.join(dir, ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    return null;
  }
};

if (buildId(platform) !== buildId(standalone) || !fs.existsSync(path.join(platform, "server.js"))) {
  fs.cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
  fs.cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
  fs.rmSync(platform, { recursive: true, force: true });
  fs.cpSync(standalone, platform, { recursive: true });
  console.log(`Установлена новая сборка ${buildId(platform)}`);
}
// The build copies .env next to server.js; refresh it so a changed .env applies without a rebuild.
if (fs.existsSync(path.join(root, ".env"))) fs.copyFileSync(path.join(root, ".env"), path.join(platform, ".env"));
