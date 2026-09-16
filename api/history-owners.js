/* CalCar: номер власника в історії авто лише зі структурованого джерела.

   Хронологію history пише модель, і номери власників у її тексті ("третій
   власник") не є доказом: модель може пропустити одного власника або
   порахувати події. Номер власника дає лише реєстр AUTO.RIA за офіційними
   відкритими даними, де кожна зміна власника підписана явно:
     "3-ій власник 11.05.23 Перереєстрація на нового власника ..."
   Ці записи детерміновано розбираються у history_facts.owner_events, а
   потім привʼязуються до рядка history того самого місяця.

   Бейдж не ставиться, якщо:
   - реєстр не дає номерів або вони неповні (нема 1..N без пропусків);
   - номери суперечать самі собі (дублікати, не зростають з датою) або
     загальній кількості власників з того ж реєстру;
   - у місяці немає рівно одного реєстраційного рядка history.
   Номер НІКОЛИ не виводиться з кількості подій. */

const OWNER_EVENT_RE = /(\d{1,2})\s*-\s*(?:ий|ій|й|ый|ой)\s+(?:власник|владелец)\s+(\d{2})\.(\d{2})\.(\d{2,4})\s+(?:Перереєстрац|Реєстрац|Перерегистрац|Регистрац)/gi;
const REG_ROW_RE = /реєстрац|регистрац|registration|власник|владел|owner/i;

/* структуровані події зміни власника з тексту реєстру: [{ ordinal, date: 'YYYY-MM-DD' }] */
export function parseOwnerEvents(text) {
  const seen = new Map();
  for (const m of String(text || '').matchAll(OWNER_EVENT_RE)) {
    const ordinal = parseInt(m[1], 10);
    const yy = m[4].length === 2 ? 2000 + parseInt(m[4], 10) : parseInt(m[4], 10);
    const date = yy + '-' + m[3] + '-' + m[2];
    const key = ordinal + '|' + date;
    /* сторінка може дублювати секції: ту саму подію рахуємо один раз */
    if (!seen.has(key)) seen.set(key, { ordinal, date });
  }
  return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date) || a.ordinal - b.ordinal);
}

/* номери узгоджені: 1..N без пропусків і дублікатів, зростають з датою,
   і не суперечать загальній кількості власників */
export function ownerEventsConsistent(events, ownersCount) {
  if (!Array.isArray(events) || !events.length) return false;
  const ords = events.map(e => e.ordinal);
  if (new Set(ords).size !== ords.length) return false;
  for (let i = 0; i < events.length; i++) {
    if (events[i].ordinal !== i + 1) return false;
  }
  if (typeof ownersCount === 'number' && ownersCount > 0 && ownersCount !== events.length) return false;
  return true;
}

function rowMonth(date) {
  const m = /^\s*(?:\d{1,2}\.)?(\d{1,2})\.(\d{4})\s*$/.exec(String(date || ''));
  return m ? m[2] + '-' + String(m[1]).padStart(2, '0') : null;
}

/* history рядки + history_facts -> ті самі рядки, де реєстраційний рядок
   місяця зміни власника отримує owner_ordinal з реєстру. Не мутує вхід */
export function annotateOwnerOrdinals(history, facts) {
  if (!Array.isArray(history)) return history;
  const rows = history.map(h => {
    if (!h || typeof h !== 'object') return h;
    const { owner_ordinal, owner_ordinal_source, ...rest } = h;
    return rest;
  });
  const events = facts && Array.isArray(facts.owner_events) ? facts.owner_events : [];
  if (!ownerEventsConsistent(events, facts && facts.owners_count)) return rows;
  for (const ev of events) {
    const month = ev.date.slice(0, 7);
    const hits = rows.map((h, i) => (h && rowMonth(h.date) === month && REG_ROW_RE.test(String(h.event || ''))) ? i : -1).filter(i => i >= 0);
    if (hits.length !== 1) continue;
    rows[hits[0]] = { ...rows[hits[0]], owner_ordinal: ev.ordinal, owner_ordinal_source: 'registry' };
  }
  return rows;
}
