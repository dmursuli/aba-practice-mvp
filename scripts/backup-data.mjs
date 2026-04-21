import { cp, copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const source = join(root, "data", "db.json");
const uploads = join(root, "uploads");
const backupDir = join(root, "backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = join(backupDir, stamp);

await mkdir(backupDir, { recursive: true });
await mkdir(destination, { recursive: true });
await copyFile(source, join(destination, "db.json"));
await cp(uploads, join(destination, "uploads"), { recursive: true, force: true }).catch(() => {});
console.log(`Backup created: ${destination}`);
