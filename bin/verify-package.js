#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}
requireCondition(pkg.name === "@wjbfks/pi-web-space", "Unexpected npm package name.");
requireCondition(pkg.publishConfig?.access === "public", "The package must be public.");
requireCondition(pkg.bin?.pws === "bin/pi-web.js" && pkg.bin?.["pi-web-space"] === "bin/pi-web.js", "Both CLI commands must be registered.");
for (const file of ["LICENSE", "OPEN_SOURCE_NOTICES.md", "public/licenses/NotoSansMono-OFL.txt", ".next/BUILD_ID", ".next/required-server-files.json", ".next/server", ".next/static"]) {
  requireCondition(fs.existsSync(path.join(root, file)), `Missing ${file}. Build in an isolated release checkout before packing.`);
}
const build = JSON.parse(fs.readFileSync(path.join(root, ".next/required-server-files.json"), "utf8"));
requireCondition(build.config?.env?.NEXT_PUBLIC_APP_VERSION === pkg.version, "Build version differs from package version. Rebuild before packing.");
requireCondition(fs.readFileSync(path.join(root, "OPEN_SOURCE_NOTICES.md"), "utf8").includes("Copyright (c) 2026 agegr"), "Upstream copyright notice must be retained.");
console.error(`Release files ready: ${pkg.name}@${pkg.version}`);
