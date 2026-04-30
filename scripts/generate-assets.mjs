import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const manifestArg = process.argv.find((arg) => arg.startsWith("--manifest="));
const manifestPath = resolve(root, manifestArg ? manifestArg.slice("--manifest=".length) : "assets/bitmaps.yml");
const SUPER_SAMPLES = 4;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function png(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const rowStride = width * 4 + 1;
  const rows = Buffer.alloc(rowStride * height);
  for (let y = 0; y < height; y += 1) {
    rows[y * rowStride] = 0;
    pixels.copy(rows, y * rowStride + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND")
  ]);
}

function parseYamlValue(value) {
  const trimmed = value.trim();
  const unquoted = trimmed.replace(/^['"]|['"]$/g, "");
  return /^\d+$/.test(unquoted) ? Number(unquoted) : unquoted;
}

function parseManifest(text) {
  const outputs = [];
  let current = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "");
    if (!line.trim() || line.trim().startsWith("#") || line.trim() === "outputs:") {
      continue;
    }

    const itemMatch = line.match(/^\s*-\s+([a-zA-Z0-9_-]+):\s*(.+?)\s*$/);
    if (itemMatch) {
      current = {};
      outputs.push(current);
      current[itemMatch[1]] = parseYamlValue(itemMatch[2]);
      continue;
    }

    const propertyMatch = line.match(/^\s+([a-zA-Z0-9_-]+):\s*(.+?)\s*$/);
    if (propertyMatch && current) {
      current[propertyMatch[1]] = parseYamlValue(propertyMatch[2]);
      continue;
    }

    throw new Error(`Unsupported manifest line: ${rawLine}`);
  }

  for (const output of outputs) {
    for (const key of ["source", "width", "height", "path"]) {
      if (!output[key]) {
        throw new Error(`Missing ${key} in bitmap manifest entry: ${JSON.stringify(output)}`);
      }
    }
  }

  return outputs;
}

function parseAttributes(text) {
  const attrs = {};
  for (const match of text.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function parseNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseColor(value) {
  if (!value || value === "none") {
    return null;
  }

  const hex = value.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    return [
      Number.parseInt(hex[1] + hex[1], 16),
      Number.parseInt(hex[2] + hex[2], 16),
      Number.parseInt(hex[3] + hex[3], 16),
      1
    ];
  }

  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
      1
    ];
  }

  throw new Error(`Unsupported color value: ${value}`);
}

function parseSvg(svg) {
  const viewBoxMatch = svg.match(/viewBox\s*=\s*"([^"]+)"/);
  if (!viewBoxMatch) {
    throw new Error("SVG source must include a viewBox.");
  }

  const viewBox = viewBoxMatch[1].trim().split(/[\s,]+/).map(Number);
  if (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) {
    throw new Error(`Invalid SVG viewBox: ${viewBoxMatch[1]}`);
  }

  const elements = [];
  for (const match of svg.matchAll(/<(rect|circle|line|polygon)\b([^>]*)\/?\s*>/g)) {
    elements.push({ type: match[1], attrs: parseAttributes(match[2]) });
  }

  if (!elements.length) {
    throw new Error("SVG source does not contain supported drawable elements.");
  }

  return {
    viewBox: {
      x: viewBox[0],
      y: viewBox[1],
      width: viewBox[2],
      height: viewBox[3]
    },
    elements
  };
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

function pointInRoundedRect(px, py, attrs) {
  const x = parseNumber(attrs.x);
  const y = parseNumber(attrs.y);
  const width = parseNumber(attrs.width);
  const height = parseNumber(attrs.height);
  const right = x + width;
  const bottom = y + height;

  if (px < x || px > right || py < y || py > bottom) {
    return false;
  }

  const rx = Math.min(parseNumber(attrs.rx, parseNumber(attrs.ry, 0)), width / 2);
  const ry = Math.min(parseNumber(attrs.ry, rx), height / 2);
  if (!rx || !ry) {
    return true;
  }

  const nearestX = Math.max(x + rx, Math.min(px, right - rx));
  const nearestY = Math.max(y + ry, Math.min(py, bottom - ry));
  const normalizedX = (px - nearestX) / rx;
  const normalizedY = (py - nearestY) / ry;
  return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
}

function pointInPolygon(px, py, attrs) {
  const points = String(attrs.points || "")
    .trim()
    .split(/\s+/)
    .map((point) => point.split(",").map(Number))
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function coverageAtPoint(element, px, py) {
  const attrs = element.attrs;
  const fill = parseColor(attrs.fill);
  const stroke = parseColor(attrs.stroke);
  const strokeWidth = parseNumber(attrs["stroke-width"]);
  let color = null;

  if (element.type === "rect") {
    if (fill && pointInRoundedRect(px, py, attrs)) {
      color = fill;
    }
  }

  if (element.type === "circle") {
    const cx = parseNumber(attrs.cx);
    const cy = parseNumber(attrs.cy);
    const radius = parseNumber(attrs.r);
    const distance = Math.hypot(px - cx, py - cy);
    if (fill && distance <= radius) {
      color = fill;
    }
    if (stroke && strokeWidth && Math.abs(distance - radius) <= strokeWidth / 2) {
      color = stroke;
    }
  }

  if (element.type === "line" && stroke && strokeWidth) {
    const distance = distanceToSegment(
      px,
      py,
      parseNumber(attrs.x1),
      parseNumber(attrs.y1),
      parseNumber(attrs.x2),
      parseNumber(attrs.y2)
    );
    if (distance <= strokeWidth / 2) {
      color = stroke;
    }
  }

  if (element.type === "polygon") {
    if (fill && pointInPolygon(px, py, attrs)) {
      color = fill;
    }
  }

  return color;
}

function blendOver(destination, source) {
  const sourceAlpha = source[3];
  const destAlpha = destination[3];
  const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
  if (outAlpha === 0) {
    return [0, 0, 0, 0];
  }

  return [
    (source[0] * sourceAlpha + destination[0] * destAlpha * (1 - sourceAlpha)) / outAlpha,
    (source[1] * sourceAlpha + destination[1] * destAlpha * (1 - sourceAlpha)) / outAlpha,
    (source[2] * sourceAlpha + destination[2] * destAlpha * (1 - sourceAlpha)) / outAlpha,
    outAlpha
  ];
}

function colorAtPoint(svg, px, py) {
  let color = [0, 0, 0, 0];
  for (const element of svg.elements) {
    const source = coverageAtPoint(element, px, py);
    if (source) {
      color = blendOver(color, source);
    }
  }
  return color;
}

function render(svg, width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  const sampleCount = SUPER_SAMPLES * SUPER_SAMPLES;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let premultipliedRed = 0;
      let premultipliedGreen = 0;
      let premultipliedBlue = 0;
      let alpha = 0;

      for (let sampleY = 0; sampleY < SUPER_SAMPLES; sampleY += 1) {
        for (let sampleX = 0; sampleX < SUPER_SAMPLES; sampleX += 1) {
          const px = svg.viewBox.x + ((x + (sampleX + 0.5) / SUPER_SAMPLES) / width) * svg.viewBox.width;
          const py = svg.viewBox.y + ((y + (sampleY + 0.5) / SUPER_SAMPLES) / height) * svg.viewBox.height;
          const sample = colorAtPoint(svg, px, py);
          premultipliedRed += sample[0] * sample[3];
          premultipliedGreen += sample[1] * sample[3];
          premultipliedBlue += sample[2] * sample[3];
          alpha += sample[3];
        }
      }

      const avgAlpha = alpha / sampleCount;
      const offset = (y * width + x) * 4;
      pixels[offset + 3] = Math.round(avgAlpha * 255);
      if (avgAlpha > 0) {
        pixels[offset] = Math.round(premultipliedRed / sampleCount / avgAlpha);
        pixels[offset + 1] = Math.round(premultipliedGreen / sampleCount / avgAlpha);
        pixels[offset + 2] = Math.round(premultipliedBlue / sampleCount / avgAlpha);
      }
    }
  }

  return png(width, height, pixels);
}

const outputs = parseManifest(readFileSync(manifestPath, "utf8"));
const sourceCache = new Map();
let stale = false;

for (const output of outputs) {
  const sourcePath = resolve(root, output.source);
  if (!sourceCache.has(sourcePath)) {
    sourceCache.set(sourcePath, parseSvg(readFileSync(sourcePath, "utf8")));
  }

  const rendered = render(sourceCache.get(sourcePath), output.width, output.height);
  const targetPath = resolve(root, output.path);

  if (checkOnly) {
    const matches = existsSync(targetPath) && readFileSync(targetPath).equals(rendered);
    if (!matches) {
      stale = true;
      console.error(`Stale generated asset: ${output.path}`);
    }
    continue;
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, rendered);
  console.log(`Generated ${output.path} from ${output.source} at ${output.width}x${output.height}`);
}

if (checkOnly && stale) {
  console.error("Generated bitmap assets are out of date. Run `node scripts/generate-assets.mjs` and commit the results.");
  process.exit(1);
}

if (checkOnly) {
  console.log("Generated bitmap assets are up to date.");
}
