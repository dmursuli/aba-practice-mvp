import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const mutationQueues = new Map();

function enqueue(filePath, operation) {
  const previous = mutationQueues.get(filePath) || Promise.resolve();
  const run = previous.then(operation, operation);
  const queued = run.catch(() => {});
  mutationQueues.set(filePath, queued);
  return run.finally(() => {
    if (mutationQueues.get(filePath) === queued) mutationQueues.delete(filePath);
  });
}

async function replaceJsonFile(filePath, state) {
  const directory = dirname(filePath);
  const temporaryPath = join(directory, `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export function writeJsonStateAtomically(filePath, state) {
  return enqueue(filePath, () => replaceJsonFile(filePath, state));
}

export function mutateJsonStateAtomically(filePath, mutator) {
  if (typeof mutator !== "function") throw new TypeError("mutator must be a function");
  return enqueue(filePath, async () => {
    const current = JSON.parse(await readFile(filePath, "utf8"));
    const result = await mutator(current);
    const next = result === undefined ? current : result;
    await replaceJsonFile(filePath, next);
    return next;
  });
}
