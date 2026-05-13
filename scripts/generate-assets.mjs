import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let checkOnly = false;
let manifestFile = "assets/bitmaps.json";

for (const arg of args) {
  if (arg === "--check") {
    checkOnly = true;
    continue;
  }

  if (arg.startsWith("--manifest=")) {
    manifestFile = arg.slice("--manifest=".length);
    continue;
  }

  throw new Error(`Unknown argument: ${arg}`);
}

function toRepositoryPath(path) {
  const absolutePath = resolve(root, path);
  const relativePath = relative(root, absolutePath);
  if (relativePath === "" || relativePath.startsWith("..") || relativePath.includes(`..${sep}`)) {
    throw new Error(`Path escapes repository root: ${path}`);
  }
  return absolutePath;
}

function displayPath(path) {
  return relative(root, path).split(sep).join("/");
}

function assertPositiveInteger(value, label, output) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer in bitmap entry: ${JSON.stringify(output)}`);
  }
}

function loadManifest(path) {
  const absolutePath = toRepositoryPath(path);
  const manifest = JSON.parse(readFileSync(absolutePath, "utf8"));
  if (!Array.isArray(manifest.outputs)) {
    throw new Error("Bitmap manifest must contain an outputs array.");
  }

  return manifest.outputs.map((output, index) => {
    for (const key of ["source", "width", "height", "path"]) {
      if (output[key] === undefined) {
        throw new Error(`Missing ${key} in bitmap manifest entry ${index + 1}: ${JSON.stringify(output)}`);
      }
    }

    assertPositiveInteger(output.width, "width", output);
    assertPositiveInteger(output.height, "height", output);

    return {
      source: String(output.source),
      sourcePath: toRepositoryPath(String(output.source)),
      width: output.width,
      height: output.height,
      path: String(output.path),
      outputPath: toRepositoryPath(String(output.path)),
      loadSystemFonts: output.loadSystemFonts === true,
      defaultFontFamily: output.defaultFontFamily ? String(output.defaultFontFamily) : undefined,
      fontFiles: Array.isArray(output.fontFiles)
        ? output.fontFiles.map((fontFile) => toRepositoryPath(String(fontFile)))
        : undefined
    };
  });
}

function renderPng(output) {
  const svg = readFileSync(output.sourcePath, "utf8");
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: output.width
    },
    font: {
      defaultFontFamily: output.defaultFontFamily,
      fontFiles: output.fontFiles,
      loadSystemFonts: output.loadSystemFonts
    },
    textRendering: 2,
    logLevel: "off"
  });
  const rendered = resvg.render();

  if (rendered.width !== output.width || rendered.height !== output.height) {
    throw new Error(
      `Rendered ${output.path} at ${rendered.width}x${rendered.height}, expected ${output.width}x${output.height}. ` +
        "Use square SVG sources or matching manifest dimensions."
    );
  }

  return Buffer.from(rendered.asPng());
}

const outputs = loadManifest(manifestFile);
const staleOutputs = [];

for (const output of outputs) {
  const png = renderPng(output);

  if (checkOnly) {
    const existing = existsSync(output.outputPath) ? readFileSync(output.outputPath) : null;
    if (!existing || !existing.equals(png)) {
      staleOutputs.push(displayPath(output.outputPath));
    }
    continue;
  }

  mkdirSync(dirname(output.outputPath), { recursive: true });
  writeFileSync(output.outputPath, png);
  console.log(`Generated ${displayPath(output.outputPath)} from ${output.source} at ${output.width}x${output.height}`);
}

if (checkOnly && staleOutputs.length) {
  console.error("Generated PNG assets are stale:");
  for (const staleOutput of staleOutputs) {
    console.error(`- ${staleOutput}`);
  }
  console.error("Run `npm run assets` and commit the updated PNG files.");
  process.exitCode = 1;
} else if (checkOnly) {
  console.log("All generated PNG assets are current.");
}
