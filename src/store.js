import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class RunStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.runs = new Map();
    this.ready = this.load();
  }

  async load() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      for (const run of parsed.runs || []) this.runs.set(run.id, run);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  async list() {
    await this.ready;
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id) {
    await this.ready;
    return this.runs.get(id) || null;
  }

  async put(run) {
    await this.ready;
    this.runs.set(run.id, run);
    await this.persist();
    return run;
  }

  async persist() {
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify({ runs: [...this.runs.values()] }, null, 2));
    await rename(tempPath, this.filePath);
  }
}

