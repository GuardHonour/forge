/* _s3d_pixdiff.cjs — compare two PNGs byte-for-byte, and if they differ, by pixels.
   node _s3d_pixdiff.cjs <a.png> <b.png> [x0 y0 x1 y1]
   No dependencies: PNGs are decoded here (zlib inflate + the five scanline filters),
   because "they look the same" is not a measurement. The optional rectangle restricts the
   comparison to one region, so "is the 3D canvas identical" can be asked separately from
   "is the whole page identical" — the two answers differ for a page with text on it. */
const fs = require('fs');
const zlib = require('zlib');

function decodePNG(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(file + ': not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, color = 0, interlace = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; color = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (interlace) throw new Error(file + ': interlaced PNG not supported');
  if (depth !== 8) throw new Error(file + ': bit depth ' + depth + ' not supported');
  const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (!CH) throw new Error(file + ': colour type ' + color + ' not supported');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * CH, out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= CH ? cur[x - CH] : 0;
      const b = prev ? prev[x] : 0;
      const c = (prev && x >= CH) ? prev[x - CH] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
  }
  return { w, h, ch: CH, px: out };
}

const A = decodePNG(process.argv[2]), B = decodePNG(process.argv[3]);
const rawA = fs.readFileSync(process.argv[2]), rawB = fs.readFileSync(process.argv[3]);
console.log('A ' + process.argv[2] + '  ' + A.w + 'x' + A.h + ' colorType/ch=' + A.ch + '  ' + rawA.length + ' bytes');
console.log('B ' + process.argv[3] + '  ' + B.w + 'x' + B.h + ' colorType/ch=' + B.ch + '  ' + rawB.length + ' bytes');
console.log('byte-identical: ' + (rawA.equals(rawB) ? 'YES' : 'NO'));

if (A.w !== B.w || A.h !== B.h || A.ch !== B.ch) {
  console.log('RESULT: dimension or channel mismatch — cannot pixel-compare');
  process.exit(2);
}
/* optional region */
const rect = process.argv.length >= 7
  ? { x0: +process.argv[4], y0: +process.argv[5], x1: +process.argv[6], y1: +process.argv[7] }
  : { x0: 0, y0: 0, x1: A.w, y1: A.h };
console.log('region compared: x ' + rect.x0 + '..' + rect.x1 + ', y ' + rect.y0 + '..' + rect.y1);

let diffPx = 0, maxD = 0, sum = 0, worst = null;
const coords = [];
for (let y = rect.y0; y < rect.y1; y++) {
  for (let x = rect.x0; x < rect.x1; x++) {
    const i = (y * A.w + x) * A.ch;
    let d = 0;
    for (let k = 0; k < A.ch; k++) d = Math.max(d, Math.abs(A.px[i + k] - B.px[i + k]));
    if (d > 0) {
      diffPx++; sum += d;
      if (d > maxD) { maxD = d; worst = [A.px[i], A.px[i + 1], A.px[i + 2], B.px[i], B.px[i + 1], B.px[i + 2]]; }
      if (coords.length < 64) coords.push('(' + x + ',' + y + ') A=' + A.px[i] + ',' + A.px[i + 1] + ',' + A.px[i + 2] +
        ' B=' + B.px[i] + ',' + B.px[i + 1] + ',' + B.px[i + 2] + ' d=' + d);
    }
  }
}
const total = (rect.x1 - rect.x0) * (rect.y1 - rect.y0);
console.log('pixels: ' + total + '   differing: ' + diffPx + ' (' + (100 * diffPx / total).toFixed(4) + '%)');
console.log('max channel delta: ' + maxD + '   mean delta over differing pixels: ' + (diffPx ? (sum / diffPx).toFixed(2) : '0'));
if (worst) console.log('worst pixel: A=rgb(' + worst.slice(0, 3) + ') B=rgb(' + worst.slice(3) + ')');
coords.forEach(s => console.log('  ' + s));
if (diffPx > 64) console.log('  ... ' + (diffPx - 64) + ' more differing pixels not listed');
console.log('RESULT: ' + (diffPx === 0 ? 'PIXEL-IDENTICAL' : 'DIFFERENT'));
process.exit(diffPx === 0 ? 0 : 1);
