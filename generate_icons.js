// Run with: node generate_icons.js
// Generates simple PNG icons using raw PNG binary encoding (no dependencies)

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function createPNG(size, bgColor, textColor, letter) {
  // PNG signature
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);

  function chunk(type, data) {
    const typeBytes = Buffer.from(type, "ascii");
    const crcBuf = Buffer.concat([typeBytes, data]);
    const crc = crc32(crcBuf);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crcOut = Buffer.alloc(4);
    crcOut.writeUInt32BE(crc >>> 0);
    return Buffer.concat([len, typeBytes, data, crcOut]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Build pixel rows: simple colored square with a white "A" letter
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size * 3);
    for (let x = 0; x < size; x++) {
      // Draw a rounded-ish background (solid maroon for ASU)
      row[x*3]   = bgColor[0];
      row[x*3+1] = bgColor[1];
      row[x*3+2] = bgColor[2];
    }
    rows.push(row);
  }

  // Draw a simple dot indicator (white circle) in center-ish area
  const cx = Math.floor(size / 2);
  const cy = Math.floor(size / 2);
  const r  = Math.floor(size * 0.28);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx*dx + dy*dy <= r*r) {
        rows[y][x*3]   = textColor[0];
        rows[y][x*3+1] = textColor[1];
        rows[y][x*3+2] = textColor[2];
      }
    }
  }

  // Prepend filter byte 0 to each row, then compress
  const raw = Buffer.concat(rows.map(r => Buffer.concat([Buffer.from([0]), r])));
  const compressed = zlib.deflateSync(raw);
  const idat = chunk("IDAT", compressed);
  const iend = chunk("IEND", Buffer.alloc(0));

  return Buffer.concat([sig, chunk("IHDR", ihdr), idat, iend]);
}

// Simple CRC32
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const ASU_MAROON = [140, 29, 64];   // #8C1D40
const WHITE      = [255, 255, 255];

const outDir = path.join(__dirname, "icons");
for (const size of [16, 48, 128]) {
  const png = createPNG(size, ASU_MAROON, WHITE);
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png);
  console.log(`Created icon${size}.png`);
}
