/* Іконка застосунку: лаймовий квадрат і дві графітові C. Тест тримає три речі,
   які легко зламати мовчки: однаковий набір посилань на всіх шести сторінках,
   наявність самих файлів і те, що в растрах немає старої чорної іконки з білою
   літерою. Кольори звіряються з дизайн-токенами, а не з очима. */
const fs = require('fs');
const zlib = require('zlib');

const BRAND = [0xB8, 0xF2, 0x3D];   // --brand
const INK = [0x14, 0x16, 0x19];     // --ink
const PAGES = ['import.html', 'check.html', 'result.html', 'result-check.html', 'cabinet.html', 'garage.html'];
const LINKS = [
  ['<link rel="icon" href="/favicon.svg" type="image/svg+xml">', 'SVG-іконка'],
  ['<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">', 'PNG 32'],
  ['<link rel="apple-touch-icon" href="/apple-touch-icon.png">', 'apple-touch-icon']
];

const errs = [];

for (const p of PAGES) {
  const s = fs.readFileSync(p, 'utf8');
  for (const [tag, name] of LINKS) {
    const n = s.split(tag).length - 1;
    if (n !== 1) errs.push(p + ': ' + name + ' зустрічається ' + n + ' разів замість 1');
  }
  /* будь-яке інше посилання на іконку означає другий, неузгоджений набір */
  const all = s.match(/<link rel="(icon|apple-touch-icon|mask-icon|shortcut icon)"[^>]*>/g) || [];
  if (all.length !== 3) errs.push(p + ': ' + all.length + ' посилань на іконки замість 3');
}

const svg = fs.readFileSync('favicon.svg', 'utf8');
if (!svg.includes('#B8F23D')) errs.push('favicon.svg: немає фірмового лайму #B8F23D');
if (!svg.includes('#141619')) errs.push('favicon.svg: немає графіту #141619');
if (/#fff|#ffffff|white/i.test(svg)) errs.push('favicon.svg: у макеті не має бути білого');

/* мінімальний читач PNG: 8 біт, RGBA, без інтерлейсу. Саме такі файли ми і пишемо */
function readPng(path) {
  const buf = fs.readFileSync(path);
  let pos = 8, w = 0, h = 0, idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const tag = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (tag === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error(path + ': очікували 8-бітний RGBA без інтерлейсу');
    } else if (tag === 'IDAT') idat.push(data);
    else if (tag === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0, o = 0; y < h; y++) {
    const f = raw[o++];
    for (let x = 0; x < stride; x++) {
      const cur = raw[o + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = (x >= bpp && y > 0) ? out[(y - 1) * stride + x - bpp] : 0;
      let v;
      if (f === 0) v = cur;
      else if (f === 1) v = cur + a;
      else if (f === 2) v = cur + b;
      else if (f === 3) v = cur + ((a + b) >> 1);
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v = cur + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(path + ': невідомий фільтр рядка ' + f);
      out[y * stride + x] = v & 0xFF;
    }
    o += stride;
  }
  return { w, h, px: out };
}

const RASTERS = [
  ['favicon-32.png', 32, false],
  ['apple-touch-icon.png', 180, true],   // iOS сам скругляє кути, тому квадрат без прозорості
  ['icon-512.png', 512, false]
];

for (const [file, size, opaque] of RASTERS) {
  let img;
  try { img = readPng(file); } catch (e) { errs.push(file + ': ' + e.message); continue; }
  if (img.w !== size || img.h !== size) errs.push(file + ': розмір ' + img.w + 'x' + img.h + ' замість ' + size);
  let brand = 0, ink = 0, white = 0, corner = img.px[3];
  for (let i = 0; i < img.px.length; i += 4) {
    const [r, g, b, a] = [img.px[i], img.px[i + 1], img.px[i + 2], img.px[i + 3]];
    if (a === 0) continue;
    if (r === BRAND[0] && g === BRAND[1] && b === BRAND[2]) brand++;
    else if (r === INK[0] && g === INK[1] && b === INK[2]) ink++;
    if (r > 240 && g > 240 && b > 240) white++;
  }
  if (!brand) errs.push(file + ': немає жодного лаймового пікселя');
  if (!ink) errs.push(file + ': немає жодного графітового пікселя, літери зникли');
  if (white) errs.push(file + ': ' + white + ' майже білих пікселів, це стара іконка');
  if (opaque && corner !== 255) errs.push(file + ': кут прозорий, для apple-touch потрібен суцільний квадрат');
  if (!opaque && corner !== 0) errs.push(file + ': кут непрозорий, скруглення втрачене');
}

if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
console.log('іконка: 6 сторінок з однаковим набором посилань · svg лайм+графіт без білого · 3 растри звірені попіксельно');
console.log('FAVICON TEST PASSED');
