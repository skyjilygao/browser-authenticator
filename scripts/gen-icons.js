const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    table[n] = c;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createPNG(size) {
  const w = size, h = size;
  const raw = [];
  for (let y = 0; y < h; y++) {
    raw.push(0);
    for (let x = 0; x < w; x++) {
      const cx = w / 2, cy = h / 2;
      const r = Math.min(w, h) * 0.45;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let R, G, B, A = 255;

      if (dist > r) {
        A = 0; R = G = B = 0;
      } else {
        const t = dist / r;
        const tg = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);

        let insideShield = false;
        const sr = r * 0.6;
        const sTop = cy - r * 0.72;
        let sx = dx, sy = dy + (r * 0.22);
        const sdist = Math.sqrt(sx * sx + sy * sy);
        if (sy < 0) {
          if (Math.abs(sx) < sr * 0.95 && sdist < sr) {
            insideShield = true;
          }
        } else {
          const triangleHalfW = sr * 0.95 - (sy / (r * 0.5)) * sr * 0.4;
          if (Math.abs(sx) < triangleHalfW && sy < r * 0.5) {
            insideShield = true;
          }
        }

        if (insideShield) {
          R = 255; G = 255; B = 255;

          const cx2 = 0, cy2 = -r * 0.05;
          const keySize = r * 0.28;
          const kx = sx - cx2, ky = sy - cy2;
          const kr = Math.sqrt(kx * kx + ky * ky);

          let drawKey = false;
          if (kr < keySize) drawKey = true;
          const stemX1 = cx2 + keySize * 0.8;
          const stemX2 = cx2 + keySize * 2.4;
          const stemY = cy2;
          const stemH = keySize * 0.35;
          if (kx >= stemX1 - keySize * 0.2 && kx <= stemX2 + keySize * 0.2 &&
              ky >= stemY - stemH / 2 && ky <= stemY + stemH / 2) {
            drawKey = true;
          }
          const notchY1 = stemY + stemH / 2;
          const notchY2 = stemY + stemH;
          const notchX = stemX2 - keySize * 0.2;
          if (kx >= notchX && kx <= notchX + keySize * 0.35 &&
              ky >= notchY1 && ky <= notchY2) {
            drawKey = true;
          }
          const notch2X = stemX2 - keySize * 0.7;
          if (kx >= notch2X && kx <= notch2X + keySize * 0.3 &&
              ky >= notchY1 && ky <= notchY2) {
            drawKey = true;
          }

          if (drawKey) {
            const p = dist / r;
            R = Math.floor(102 + (118 - 102) * p);
            G = Math.floor(126 + (75 - 126) * p);
            B = Math.floor(234 + (162 - 234) * p);
          }
        } else {
          const p = t;
          R = Math.floor(102 + (118 - 102) * p);
          G = Math.floor(126 + (75 - 126) * p);
          B = Math.floor(234 + (162 - 234) * p);
        }
      }
      raw.push(R, G, B, A);
    }
  }
  const rawBuf = Buffer.from(raw);
  const deflated = zlib.deflateSync(rawBuf);

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflated),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const sizes = [16, 48, 128];
const outDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
for (const s of sizes) {
  const png = createPNG(s);
  fs.writeFileSync(path.join(outDir, `icon${s}.png`), png);
  console.log(`Generated icon${s}.png (${png.length} bytes)`);
}
console.log('Done.');
