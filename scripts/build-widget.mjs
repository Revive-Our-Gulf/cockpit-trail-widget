import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import CleanCSS from "clean-css";
import { minify as minifyHtml } from "html-minifier-terser";

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "src");
const DIST_DIR = path.join(ROOT, "dist");
const TEMPLATE_CONFIG_PATH = path.join(
  ROOT,
  "cockpit-trail-widget-config-v0.2.1-alpha.json"
);

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

async function bundleJs() {
  const moduleEntry = path.join(SRC_DIR, "main.js");
  const legacyEntry = path.join(SRC_DIR, "widget.js");

  try {
    await fs.access(moduleEntry);
    const result = await build({
      entryPoints: [moduleEntry],
      bundle: true,
      minify: true,
      format: "iife",
      write: false,
      target: ["es2018"],
    });

    return result.outputFiles[0].text;
  } catch {
    return readText(legacyEntry);
  }
}

async function buildSnippets() {
  const htmlSource = await readText(path.join(SRC_DIR, "widget.html"));
  const cssSource = await readText(path.join(SRC_DIR, "widget.css"));
  const jsSource = await bundleJs();

  const html = await minifyHtml(htmlSource, {
    collapseWhitespace: true,
    removeComments: true,
    removeRedundantAttributes: true,
    removeOptionalTags: false,
  });

  const css = new CleanCSS({ level: 2 }).minify(cssSource).styles;

  return {
    html,
    css,
    js: jsSource,
  };
}

async function writeBlueOsConfig(snippets) {
  const templateRaw = await readText(TEMPLATE_CONFIG_PATH);
  const config = JSON.parse(templateRaw);

  config.html = snippets.html;
  config.css = snippets.css;
  config.js = snippets.js;

  const configOutPath = path.join(
    DIST_DIR,
    "cockpit-trail-widget-config.generated.json"
  );
  await fs.writeFile(configOutPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

async function main() {
  await fs.mkdir(DIST_DIR, { recursive: true });
  const snippets = await buildSnippets();

  await fs.writeFile(
    path.join(DIST_DIR, "widget-snippets.json"),
    JSON.stringify(snippets, null, 2) + "\n",
    "utf8"
  );

  await writeBlueOsConfig(snippets);

  console.log("Built BlueOS snippets and generated config in dist/");
}

main().catch((error) => {
  console.error("Build failed:", error);
  process.exit(1);
});