import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { copyFileSync, existsSync } from "fs";
import { resolve } from "path";

const banner = `/*
PENNY - Prose Engine for Narrative, Notes, and Yarns
AI co-authoring plugin for Obsidian
https://github.com/KofTwentyTwo/obsidian-penny
*/`;

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  await context.rebuild();

  // Auto-deploy to the Obsidian vault's plugin folder if it exists
  const vaultPluginDir = resolve("..", "Books", ".obsidian", "plugins", "penny");
  if (existsSync(vaultPluginDir)) {
    copyFileSync("main.js", resolve(vaultPluginDir, "main.js"));
    copyFileSync("styles.css", resolve(vaultPluginDir, "styles.css"));
    copyFileSync("manifest.json", resolve(vaultPluginDir, "manifest.json"));
    console.log(`Deployed to ${vaultPluginDir}`);
  }

  process.exit(0);
} else {
  await context.watch();
}
