/* Правило продукту: довге тире (U+2014) заборонене будь-де у коді і текстах.
   Тест тримає це правило, бо словники і промпти легко ламаються вручну.
   Символ навмисно записаний escape-послідовністю: інакше тест ловив би сам себе. */
const fs = require('fs');
const { execSync } = require('child_process');
const DASH = '\u2014';
const TEXT = /\.(html|js|sql|json|md|css|svg)$/i;

const files = execSync('git ls-files').toString().split('\n').filter(f => f && TEXT.test(f));
if (!files.length) { console.log('FAILED: не знайдено жодного текстового файла'); process.exit(1); }

const errs = [];
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((s, i) => { if (s.includes(DASH)) errs.push(f + ':' + (i + 1) + ' ' + s.trim().slice(0, 80)); });
}

/* ключі словників це точні українські рядки зі сторінок: розходження = мовчазна
   втрата перекладу, саме тому правка тире у сторінці мусить іти разом зі словником */
const pageKeys = ['Кабінет · CalCar', 'Без паролів. Один прорахунок безкоштовно.'];
for (const d of ['i18n/ru.js', 'i18n/en.js']) {
  const s = fs.readFileSync(d, 'utf8');
  pageKeys.forEach(k => { if (!s.includes("'" + k + "'")) errs.push('нема ключа "' + k + '" у ' + d); });
}
const cab = fs.readFileSync('cabinet.html', 'utf8');
pageKeys.forEach(k => { if (!cab.includes(k)) errs.push('рядок "' + k + '" зник із cabinet.html, словники тепер мимо'); });

if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
console.log('довге тире відсутнє у ' + files.length + ' файлах · ключі словників збігаються зі сторінкою');
console.log('DASH TEST PASSED');
