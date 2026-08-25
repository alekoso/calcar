/* CalCar Score v2: звірка на реальних звітах.
   Вхід: JSON-вигрузка з reports (масив рядків із полем data або масив самих
   data-обʼєктів). Друкує таблицю: машина / легасі / v2 / стеля / штрафи /
   обмежувачі. Якщо у звіті є score_facts і coverage_inputs, рахує v2 наново
   і позначає розбіжність зі збереженим значенням (перевірка детермінізму).

   Використання: node scorecheck.js reports.json */
const fs = require('fs');
const os = require('os');
const path = require('path');

const file = process.argv[2];
if (!file) { console.log('Використання: node scorecheck.js <reports.json>'); process.exit(1); }

const tmp = path.join(os.tmpdir(), 'calcar_scorecheck.mjs');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, 'api', 'score.js'), 'utf8'));

(async () => {
  const { computeScore } = await import('file://' + tmp);
  let rows;
  try { rows = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.log('Не вдалося прочитати JSON: ' + e.message); process.exit(1); }
  if (!Array.isArray(rows)) rows = [rows];

  const pad = (v, n) => String(v ?? '-').slice(0, n).padEnd(n);
  console.log(pad('Машина', 34), pad('Легасі', 7), pad('v2', 5), pad('Стеля', 6), pad('Штрафи', 22), 'Обмежувачі');
  console.log('-'.repeat(110));

  let mismatches = 0;
  for (const row of rows) {
    const d = row && row.data ? row.data : row;
    if (!d || typeof d !== 'object') continue;
    const title = d.vehicle?.title || row?.title || '(без назви)';
    const legacy = d.verdict?.score ?? '-';
    const bd = d.score_breakdown_v2;
    let v2 = d.score_v2_preview ?? '-';
    let note = '';
    if (bd && Array.isArray(d.score_facts?.findings) && bd.coverage_inputs) {
      /* перерахунок: збережене значення мусить відтворюватись байт у байт */
      const l = console.log; console.log = () => {};
      let re; try { re = computeScore(d.score_facts.findings, bd.coverage_inputs); } finally { console.log = l; }
      if (re && re.final !== bd.final) { note = ' !перерахунок=' + re.final; mismatches++; }
    }
    const pen = bd ? (bd.penalties || []).map(p => p.type.slice(0, 12) + p.amount).join(',') : '-';
    const lim = bd ? (bd.limiting_factors || []).join(',') || 'none' : '-';
    console.log(pad(title, 34), pad(legacy, 7), pad(v2, 5), pad(bd ? bd.coverage_cap : '-', 6), pad(pen || 'нема', 22), lim + note);
  }
  if (mismatches) console.log('\nУВАГА: ' + mismatches + ' звітів не відтворились перерахунком (недетермінізм або стара версія формули)');
  fs.unlinkSync(tmp);
})().catch(e => { console.log('Помилка: ' + (e.stack || e.message)); process.exit(1); });
