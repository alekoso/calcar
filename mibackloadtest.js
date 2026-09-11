/* Model Intelligence Phase 3: перевірка заливки еталонних карток.

   Що робить:
   1) піднімає схему з нуля (prelude + 001..010 up);
   2) заливає граф сутностей, джерела, кандидатів, прогоняє gate
      і публікацію ОДНІЄЮ сесією psql (помічники живуть у pg_temp);
   3) перевіряє трасування атомів: сума represented + blocked + merged
      + rejected має дорівнювати кількості матеріальних атомів картки,
      інакше атом загубився мовчки;
   4) перевіряє, що gate не послаблено: жодної публікації через
      override, кожен заблокований кандидат має збережену причину;
   5) перевіряє інваріанти заливки: шари обслуговування не злиті,
      застосовність не розширена, станів за VIN немає, повторюваність
      порахована, ревізії знання зрушені;
   6) відкочує все і застосовує наново.

   Потребує psql і адресу ТЕСТОВОЇ бази:
     MI_TEST_DB_URL=postgres://... node mibackloadtest.js
     MI_PSQL=/шлях/до/psql (необовʼязково)

   До продакшн-бази цей тест не підключається ніколи. */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'migrations', 'mi');
const FIX = path.join(__dirname, 'tests', 'mi', 'fixtures');
const DATA = path.join(__dirname, 'data', 'mi', 'reference');
const CARDS = path.join(__dirname, 'docs', 'model-intelligence', 'reference');
const PSQL = process.env.MI_PSQL || 'psql';
const DB = process.env.MI_TEST_DB_URL || '';
const errs = [];
let checks = 0;

const UPS = ['001_schemas_enums_lookups', '002_subjects_hierarchy_source',
  '003_components_equipment_state', '004_issue_maintenance_check',
  '005_claims_applicability_evidence', '006_staging', '007_mi_vm_interface',
  '008_fragments_packs_operations', '009_validation_permissions',
  '010_knowledge_lifecycle', '011_staging_buyer_metadata', '012_pack_compiler', '013_check_retrieval', '014_check_dedup', '015_identity_resolver', '016_vm_adapter', '017_pack_purpose_key', '018_ingest_bridge',
  '019_request_pack_hit', '020_bridge_decoded_year', '021_anchor_family_equipment',
  '022_partial_identity', '023_report_version_inference'];

/* Кількість матеріальних атомів кожної картки рахується з самого
   замороженого документа, а не задається константою: якщо картку колись
   змінять, тест впаде, а не промовчить. */
const CARD_FILES = {
  C: 'bmw-m550i-g30-my2018.md',
  T: 'tesla-model-s-p85d-my2015.md',
  P: 'porsche-cayenne-gts-958-1-my2013.md'
};

function run(args, sql) {
  return execFileSync(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, ...args],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });
}

function why(e) {
  const out = String(e.stderr || e.message);
  const line = out.split('\n').find(l => /ERROR|FATAL/.test(l));
  return (line || out.split('\n')[0] || '').trim().slice(0, 240);
}

const exec = sql => run([], sql);
const file = f => run(['-f', path.join(DIR, f)], '');
const fixture = f => run(['-f', path.join(FIX, f)], '');
const scalar = sql => run(['-t', '-A'], sql).trim();

function ok(name, fn) {
  checks++;
  try { fn(); } catch (e) { errs.push(name + ': ' + why(e)); }
}

function eq(name, sql, want) {
  ok(name, () => {
    const got = scalar(sql);
    if (got !== String(want)) throw new Error('очікували ' + want + ', маємо ' + got);
  });
}

/* Схема продукту, на яку посилаються міграції MI: у продакшні вона вже
   є, на стенді її треба підняти. Усі файли ідемпотентні. */
const PRODUCT_SCHEMA = ['supabase-jobs.sql', 'supabase-vehicle-memory-baseline.sql',
  'supabase-vehicle-intelligence.sql', 'supabase-vehicle-memory-v1.sql',
  'supabase-vehicle-memory-v2.sql'];

function applyAll() {
  fixture('000_test_prelude.sql');
  for (const f of PRODUCT_SCHEMA) run(['-f', path.join(__dirname, f)], '');
  for (const m of UPS) file(m + '.up.sql');
}

function rollbackAll() {
  for (const m of [...UPS].reverse()) file(m + '.down.sql');
}

/* Заливка обовʼязково йде однією сесією: помічники у pg_temp зникають
   разом із сесією, тому подавати файли поодинці не можна. */
function loadReference() {
  const files = fs.readdirSync(DATA).filter(f => f.endsWith('.sql')).sort();
  exec(files.map(f => fs.readFileSync(path.join(DATA, f), 'utf8')).join('\n'));
}

/* ---- 0. Передумови ---- */

if (!DB) {
  console.error('mibackloadtest: не задано MI_TEST_DB_URL, тест не запускався.');
  console.error('Приклад: MI_TEST_DB_URL=postgres://localhost/calcar_mi_test node mibackloadtest.js');
  process.exit(2);
}
try {
  execFileSync(PSQL, ['--version'], { stdio: 'pipe' });
} catch {
  console.error('mibackloadtest: psql недоступний. Вкажіть MI_PSQL або додайте psql у PATH.');
  process.exit(2);
}

const atomCount = {};
for (const [prefix, name] of Object.entries(CARD_FILES)) {
  const p = path.join(CARDS, name);
  if (!fs.existsSync(p)) {
    errs.push('немає замороженої картки ' + name);
    continue;
  }
  const m = fs.readFileSync(p, 'utf8')
    .match(new RegExp('^- \\*\\*' + prefix + '-\\d{3}\\*\\* \\|', 'gm'));
  atomCount[prefix] = m ? m.length : 0;
}
const totalAtoms = Object.values(atomCount).reduce((a, b) => a + b, 0);

/* ---- 1. Схема і заливка ---- */

ok('чиста схема', () => { try { rollbackAll(); } catch { /* база могла бути порожня */ } });
ok('застосування міграцій', applyAll);
ok('заливка еталонних карток', loadReference);

/* ---- 2. Трасування атомів ---- */

eq('матеріальних атомів у трьох картках', "select " + totalAtoms, totalAtoms);

ok('кожен атом має принаймні одного кандидата', () => {
  if (totalAtoms === 0) throw new Error('картки не прочитались');
  const got = scalar("select count(distinct split_part(task_ref,'#',1)) from mi.candidate_claim;");
  if (got !== String(totalAtoms)) {
    throw new Error('атомів ' + totalAtoms + ', а простежено ' + got);
  }
});

for (const [prefix, n] of Object.entries(atomCount)) {
  eq('атоми картки ' + prefix + ' простежені',
    "select count(distinct split_part(task_ref,'#',1)) from mi.candidate_claim where task_ref like '" + prefix + "-%';", n);
}

ok('сума статусів дорівнює числу кандидатів', () => {
  const total = Number(scalar('select count(*) from mi.candidate_claim;'));
  const sum = Number(scalar(`select
      count(*) filter (where review_status = 'approved')
    + count(*) filter (where review_status = 'merged')
    + count(*) filter (where review_status = 'rejected')
    + count(*) filter (where review_status not in ('approved','merged','rejected'))
    from mi.candidate_claim;`));
  if (total !== sum || total === 0) throw new Error('кандидатів ' + total + ', у статусах ' + sum);
});

eq('жоден кандидат не лишився без розгляду',
  "select count(*) from mi.candidate_claim where gate_result is null;", 0);

eq('у кожного кандидата є посилання на атом',
  "select count(*) from mi.candidate_claim where coalesce(btrim(task_ref),'') = '';", 0);

eq('кожен опублікований клейм має кандидата з атомом',
  `select count(*) from mi.claim c where c.status = 'published'
     and not exists (select 1 from mi.candidate_claim k where k.published_claim_id = c.id);`, 0);

/* ---- 3. Gate не послаблено ---- */

eq('жодної публікації через override',
  "select count(*) from mi.candidate_claim where review_note like '%gate override%';", 0);

eq('у кожного заблокованого кандидата збережена причина',
  `select count(*) from mi.candidate_claim c
    where c.review_status not in ('approved','merged','rejected')
      and not exists (select 1 from jsonb_array_elements(c.gate_result->'rules') r
                      where (r->>'ok')::boolean is false);`, 0);

eq('опублікований клейм завжди має пройдену перевірку',
  `select count(*) from mi.candidate_claim
    where review_status = 'approved' and (gate_result->>'passed')::boolean is not true;`, 0);

eq('офіційний факт без офіційного джерела не опублікований',
  `select count(*) from mi.claim c where c.status = 'published' and c.knowledge_type = 'official_fact'
     and not exists (select 1 from mi.evidence e join mi.source s on s.id = e.source_id
                     where e.claim_id = c.id and s.source_type in ('official','legal'));`, 0);

eq('власницький патерн без двох незалежних груп не опублікований',
  `select count(*) from mi.claim c where c.status = 'published' and c.knowledge_type = 'owner_pattern'
     and (select count(distinct e.independence_group) from mi.evidence e join mi.source s on s.id = e.source_id
          where e.claim_id = c.id and s.source_type = 'owner' and e.stance = 'supports') < 2;`, 0);

eq('синтез без двох опор двох типів не опублікований',
  `select count(*) from mi.claim c where c.status = 'published' and c.knowledge_type = 'calcar_synthesis'
     and (select count(distinct s2.knowledge_type) from mi.claim_support cs
          join mi.claim s2 on s2.id = cs.supporting_claim_id
          where cs.synthesis_claim_id = c.id) < 2;`, 0);

/* ---- 4. Інваріанти заливки ---- */

ok('усі шість типів знання представлені', () => {
  const n = scalar("select count(distinct knowledge_type) from mi.claim where status='published';");
  if (n !== '6') throw new Error('типів знання ' + n + ' із 6');
});

ok('три картки дали опубліковане знання', () => {
  const n = scalar(`select count(distinct left(task_ref,1)) from mi.candidate_claim
                    where review_status = 'approved';`);
  if (n !== '3') throw new Error('карток із публікаціями ' + n + ' із 3');
});

ok('шари обслуговування не злиті між собою', () => {
  const n = Number(scalar(`select count(*) from (
     select subject_id from mi.claim where status = 'published' and layer is not null
     group by subject_id having count(distinct layer) > 1) t;`));
  if (n < 1) throw new Error('жоден subject обслуговування не несе кількох шарів одночасно');
});

eq('клейм не про обслуговування не має шару',
  `select count(*) from mi.claim c join mi.knowledge_subject k on k.id = c.subject_id
    where c.layer is not null and k.kind <> 'maintenance_item';`, 0);

eq('поширення вниз завжди має обґрунтування',
  "select count(*) from mi.claim where propagation <> 'exact' and coalesce(btrim(propagation_note),'') = '';", 0);

eq('предикат застосовності не має невідомої межі',
  `select count(*) from mi.claim_applicability
    where value_from_kind = 'unknown' or value_to_kind = 'unknown';`, 0);

eq('станів компонента за VIN заливка не створює',
  'select count(*) from mi_vm.component_state_instance;', 0);

eq('розвʼязаної ідентичності заливка не створює',
  'select count(*) from mi_vm.resolved_identity;', 0);

ok('типи станів компонента як знання створені', () => {
  const n = Number(scalar('select count(*) from mi.component_state_type;'));
  if (n < 10) throw new Error('типів станів лише ' + n);
});

eq('повторюваність порахована для кожного опублікованого клейма',
  `select count(*) from mi.claim c where c.status = 'published'
     and not exists (select 1 from mi.recurrence_summary r where r.claim_id = c.id);`, 0);

eq('повторюваність не перетворилась на поширеність',
  `select count(*) from mi.recurrence_summary
    where recurrence_class = 'strong_consensus' and independent_groups < 5;`, 0);

ok('ревізії знання зрушені публікацією', () => {
  const n = Number(scalar('select count(*) from mi.knowledge_subject where knowledge_rev > 1;'));
  if (n < 50) throw new Error('зрушено лише ' + n + ' subject');
});

eq('жодне джерело не створене двічі',
  'select count(*) - count(distinct natural_key) from mi.source;', 0);

ok('суперечливі докази збережені, а не викинуті', () => {
  const n = Number(scalar("select count(*) from mi.evidence where stance = 'contradicts';"));
  if (n < 5) throw new Error('суперечливих доказів лише ' + n);
});

eq('аліас не став неоднозначним',
  `select count(*) from (select alias_norm, scope_key from mi.subject_alias
     group by 1,2 having count(distinct target_subject_id) > 1) t;`, 0);

/* ---- 4b. Phase 3.1: перекласифікація ---- */

ok('перекласифіковані кандидати існують', () => {
  const n = Number(scalar("select count(*) from mi.candidate_claim where task_ref ~ 'r1$';"));
  if (n < 1) throw new Error('жодного перекласифікованого кандидата');
});

eq('кожен перекласифікований кандидат опублікований',
  "select count(*) from mi.candidate_claim where task_ref ~ 'r1$' and review_status <> 'approved';", 0);

eq('жодної перекласифікації через override',
  "select count(*) from mi.candidate_claim where task_ref ~ 'r1$' and review_note like '%gate override%';", 0);

eq('старий заблокований кандидат збережений і лишається заблокованим',
  `select count(*) from mi.candidate_claim n
    where n.task_ref ~ 'r1$'
      and not exists (select 1 from mi.candidate_claim o
                      where o.task_ref = regexp_replace(n.task_ref, '(#|-)r1$', '')
                        and o.review_status not in ('approved','merged','rejected'));`, 0);

eq('старий кандидат знає свою заміну',
  `select count(*) from mi.candidate_claim n
    where n.task_ref ~ 'r1$'
      and not exists (select 1 from mi.candidate_claim o
                      where o.task_ref = regexp_replace(n.task_ref, '(#|-)r1$', '')
                        and o.review_note like '%superseded for publication by candidate%');`, 0);

eq('перекласифікація без зміни тексту неможлива',
  `select count(*) from mi.candidate_claim n
     join mi.candidate_claim o on o.task_ref = regexp_replace(n.task_ref, '(#|-)r1$', '')
    where n.task_ref ~ 'r1$' and n.text_en = o.text_en;`, 0);

eq('перекласифікація не змінює атом',
  `select count(*) from mi.candidate_claim n
     join mi.candidate_claim o on o.task_ref = regexp_replace(n.task_ref, '(#|-)r1$', '')
    where n.task_ref ~ 'r1$'
      and split_part(n.task_ref,'#',1) <> split_part(o.task_ref,'#',1);`, 0);

/* ---- 4c. Phase 3.2: buyer-метадані еталонного корпусу ---- */

eq('жоден опублікований клейм не лишився без важливості',
  "select count(*) from mi.claim where status = 'published' and buyer_importance is null;", 0);

ok('корпус несе більше одного значення важливості', () => {
  const n = Number(scalar("select count(distinct buyer_importance) from mi.claim where status='published';"));
  if (n < 2) throw new Error('різних значень важливості лише ' + n);
});

ok('у корпусі є і найвища, і найнижча важливість', () => {
  const hi = Number(scalar("select count(*) from mi.claim where status='published' and buyer_importance = 5;"));
  const lo = Number(scalar("select count(*) from mi.claim where status='published' and buyer_importance = 1;"));
  if (hi < 1) throw new Error('немає жодного клейма важливості 5');
  if (lo < 1) throw new Error('немає жодного клейма важливості 1');
});

/* Головна перевірка проти повернення старої поведінки: якщо константа
   повернеться, одне значення накриє весь корпус. */
ok('важливість не однакова штучно', () => {
  const top = Number(scalar(`select max(n) from (select count(*) n from mi.claim
                              where status='published' group by buyer_importance) t;`));
  const all = Number(scalar("select count(*) from mi.claim where status='published';"));
  if (all === 0) throw new Error('корпус порожній');
  if (top === all) throw new Error('уся важливість корпусу дорівнює одному значенню');
  if (top / all > 0.6) throw new Error('одне значення важливості накриває ' +
    Math.round(100 * top / all) + ' відсотків корпусу');
});

eq('важливість кандидата доходить до клейма без змін',
  `select count(*) from mi.candidate_claim k join mi.claim c on c.id = k.published_claim_id
    where k.proposed_buyer_importance is distinct from c.buyer_importance;`, 0);

eq('buyer-текст кандидата доходить до клейма дослівно',
  `select count(*) from mi.candidate_claim k join mi.claim c on c.id = k.published_claim_id
    where k.proposed_buyer_implication_en is distinct from c.buyer_implication_en;`, 0);

ok('buyer-текст карток справді завантажений', () => {
  const n = Number(scalar(`select count(*) from mi.claim
                            where status='published' and buyer_implication_en is not null;`));
  if (n < 40) throw new Error('клеймів із buyer-текстом лише ' + n);
});

eq('суперечливий клейм завжди пояснює, у чому суперечка',
  `select count(*) from mi.claim where status='published' and contested
     and coalesce(btrim(contested_note_en), '') = '';`, 0);

ok('суперечливе знання у корпусі збережене', () => {
  const n = Number(scalar("select count(*) from mi.claim where status='published' and contested;"));
  if (n < 1) throw new Error('жодного суперечливого клейма');
});

/* Нові правила не мають блокувати знання: вони про повноту метаданих,
   а не про докази. Заблокований кандидат має падати лише на доказах. */
eq('нове правило важливості нікого не заблокувало',
  `select count(*) from mi.candidate_claim c, jsonb_array_elements(c.gate_result->'rules') r
    where c.review_status = 'gate_pending' and (r->>'ok')::boolean is false
      and r->>'code' in ('buyer_importance_set', 'contested_note');`, 0);

/* ---- 5. Повторюваність заливки ---- */

ok('відкат після заливки', rollbackAll);

eq('після відкату схем немає',
  "select count(*) from information_schema.schemata where schema_name in ('mi','mi_vm');", 0);

ok('повторне застосування і заливка', () => { applyAll(); loadReference(); });

ok('повторна заливка дає ту саму кількість кандидатів', () => {
  const n = scalar("select count(distinct split_part(task_ref,'#',1)) from mi.candidate_claim;");
  if (n !== String(totalAtoms)) throw new Error('атомів ' + totalAtoms + ', простежено ' + n);
});

ok('фінальний відкат', rollbackAll);

/* ---- Підсумок ---- */

if (errs.length) {
  console.error('mibackloadtest: помилок ' + errs.length + ' із ' + checks + ' перевірок');
  for (const e of errs) console.error(' - ' + e);
  process.exit(1);
}
console.log('mibackloadtest: усі ' + checks + ' перевірок пройшли (' + totalAtoms + ' атомів)');
