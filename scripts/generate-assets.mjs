import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

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
  header[9] = 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rows[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 3;
      const target = y * (width * 3 + 1) + 1 + x * 3;
      rows[target] = pixels[source];
      rows[target + 1] = pixels[source + 1];
      rows[target + 2] = pixels[source + 2];
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND")
  ]);
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * Math.min(1, Math.max(0, t)));
}

function blend(pixel, color, alpha) {
  pixel[0] = mix(pixel[0], color[0], alpha);
  pixel[1] = mix(pixel[1], color[1], alpha);
  pixel[2] = mix(pixel[2], color[2], alpha);
}

function edgeAlpha(distance, radius) {
  return Math.min(1, Math.max(0, radius - Math.abs(distance) + 0.5));
}

function triangleContains(px, py, ax, ay, bx, by, cx, cy) {
  const sign = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 3);
  const sea = [15, 79, 95];
  const amber = [255, 182, 72];
  const amberDeep = [255, 143, 47];
  const mint = [216, 244, 238];
  const sand = [255, 248, 234];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 3;
      const t = (x + y) / (size * 2);
      const pixel = [mix(sand[0], mint[0], t), mix(sand[1], mint[1], t), mix(sand[2], mint[2], t)];

      const cx = size * 0.5;
      const cy = size * 0.48;
      const distance = Math.hypot(x - cx, y - cy);
      const outer = size * 0.36;
      const inner = size * 0.23;
      if (distance < outer && distance > inner) {
        blend(pixel, sea, Math.min(1, Math.min(outer - distance, distance - inner) + 0.45));
      }

      const tail = distanceToSegment(x, y, cx + size * 0.15, cy + size * 0.21, cx + size * 0.34, cy + size * 0.38);
      if (tail < size * 0.055) {
        blend(pixel, sea, edgeAlpha(tail, size * 0.055));
      }

      const ax = cx - size * 0.08;
      const ay = cy - size * 0.13;
      const bx = cx - size * 0.08;
      const by = cy + size * 0.13;
      const dx = cx + size * 0.15;
      const dy = cy;
      if (triangleContains(x, y, ax, ay, bx, by, dx, dy)) {
        const local = (x - ax) / (dx - ax);
        blend(pixel, [mix(amber[0], amberDeep[0], local), mix(amber[1], amberDeep[1], local), mix(amber[2], amberDeep[2], local)], 1);
      }

      pixels[idx] = pixel[0];
      pixels[idx + 1] = pixel[1];
      pixels[idx + 2] = pixel[2];
    }
  }

  return png(size, size, pixels);
}

for (const size of [16, 32, 48, 128]) {
  const path = resolve(root, `extension/icons/icon-${size}.png`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, drawIcon(size));
}

mkdirSync(resolve(root, "store-assets"), { recursive: true });
copyFileSync(resolve(root, "extension/icons/icon-128.png"), resolve(root, "store-assets/queup-store-icon-128.png"));
