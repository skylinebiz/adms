import fs from "node:fs";
import path from "node:path";

// Read straight from package.json rather than a hardcoded constant, so
// this can never drift from what's actually shipped - bumping the
// version is a one-line package.json edit, not a second place to remember.
// fs.readFileSync (not `import ... from "../package.json"`) because
// package.json sits outside tsconfig's rootDir - a JSON import would
// change where tsc emits it. path.join(__dirname, "..") lands on the repo
// root identically in dev (tsx, __dirname = src/) and in the built image
// (__dirname = dist/, package.json copied alongside per the Dockerfile).
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")) as {
  version: string;
};

export const APP_VERSION = pkg.version;
