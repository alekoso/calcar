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

/* після дати йде реєстраційна дія; перед нею може стояти одне слово-означення:
   "2-ий власник 22.04.15 Вторинна реєстрація тз, придбаного в торговельній
   організації". Номер дає сам підпис "N-ий власник", а не слово дії */
const OWNER_EVENT_RE = /(\d{1,2})\s*-\s*(?:ий|ій|й|ый|ой)\s+(?:власник|владелец)\s+(\d{2})\.(\d{2})\.(\d{2,4})\s+((?:[^\s\d•]+\s+)?(?:Перереєстрац|Реєстрац|Перерегистрац|Регистрац)[^•\n\d]{0,140})/gi;
const REG_ROW_RE = /реєстрац|регистрац|registration|власник|владел|owner/i;
/* перехід авто до іншої людини: саме він нумерує власників */
const OWNERSHIP_ROW_RE = /перереєстрац|перерегистрац|на нового|нового власник|нового владельц|іншого власник|другого владельц|власник|владельц|owner|change of owner/i;
/* реєстраційні дії, які власника НЕ міняють */
const NOT_OWNERSHIP_ROW_RE = /номерн\w{0,3}\s+знак|номерного знак|заміні номер|замене номер|индивидуальн\w{0,3}\s+номер|іменн\w{0,3}\s+номер|plate/i;

/* реєстраційна дія з тексту реєстру у вузьку категорію; що не впізнано: null */
export function classifyOwnerOperation(text) {
  const t = String(text || '').toLowerCase();
  if (/спадщ|наслед|успадк/.test(t)) return 'inheritance';
  if (/ввезен|привезен|з-за кордон|из-за границ|из-за рубеж/.test(t)) return 'import_registration';
  if (/торговельн|торгівельн|торгов\S*\s+организ/.test(t)) return 'trade_purchase';
  if (/первинн|первичн/.test(t)) return 'first_registration';
  if (/куп[iі]вл[iі]|купли-продаж/.test(t)) return 'sale_registration';
  if (/перереєстрац|перерегистрац|на нового власник|на нового владельц/.test(t)) return 'owner_reregistration';
  return null;
}

/* структуровані події зміни власника з тексту реєстру: [{ ordinal, date: 'YYYY-MM-DD', operation }] */
export function parseOwnerEvents(text) {
  const seen = new Map();
  for (const m of String(text || '').matchAll(OWNER_EVENT_RE)) {
    const ordinal = parseInt(m[1], 10);
    const yy = m[4].length === 2 ? 2000 + parseInt(m[4], 10) : parseInt(m[4], 10);
    const date = yy + '-' + m[3] + '-' + m[2];
    const key = ordinal + '|' + date;
    /* сторінка може дублювати секції: ту саму подію рахуємо один раз */
    if (!seen.has(key)) seen.set(key, { ordinal, date, operation: classifyOwnerOperation(m[5]) });
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
  const taken = new Set();
  let matched = 0;
  for (const ev of events) {
    const month = ev.date.slice(0, 7);
    let hits = rows.map((h, i) => (h && !taken.has(i) && rowMonth(h.date) === month && REG_ROW_RE.test(String(h.event || ''))) ? i : -1).filter(i => i >= 0);
    /* у місяці кілька реєстраційних рядків: беремо саме перехід до іншої
       людини, а заміну номерного знака чи технічну дію пропускаємо */
    if (hits.length > 1) {
      const owners = hits.filter(i => OWNERSHIP_ROW_RE.test(String(rows[i].event || '')) && !NOT_OWNERSHIP_ROW_RE.test(String(rows[i].event || '')));
      if (owners.length === 1) hits = owners;
    }
    if (hits.length !== 1) continue;
    taken.add(hits[0]);
    matched++;
    rows[hits[0]] = { ...rows[hits[0]], owner_ordinal: ev.ordinal, owner_ordinal_source: 'registry' };
  }
  /* показуємо номери ЛИШЕ коли на хронологію лягла вся послідовність.
     Інакше вийшло б "1-й, 3-й, 4-й": другий власник нікуди не подівся,
     просто його події у хронології немає. Краще без бейджів, ніж з дірою */
  if (matched !== events.length) {
    return rows.map(h => {
      if (!h || typeof h !== 'object' || h.owner_ordinal === undefined) return h;
      const { owner_ordinal, owner_ordinal_source, ...rest } = h;
      return rest;
    });
  }
  return rows;
}

/* Текст події пише модель, і буває, що замість дії вона пише лише номер
   власника ("Другий власник."), який і так стоїть у бейджі. Для рядків із
   номером з реєстру такий текст замінюється на дію: конкретну з реєстру,
   коли вона є, інакше перша реєстрація для першого власника і
   перереєстрація на нового власника для наступних. Продаж, спадщину чи
   угоду з дилером без запису в реєстрі не вигадуємо. Не мутує вхід */
const OWNER_OPERATION_TEXT = {
  first_registration: { ua: 'Перша реєстрація автомобіля.', ru: 'Первая регистрация автомобиля.', en: 'First registration of the car.' },
  owner_reregistration: { ua: 'Перереєстрація на нового власника.', ru: 'Перерегистрация на нового владельца.', en: 'Re-registration to a new owner.' },
  sale_registration: { ua: 'Перереєстрація на нового власника за договором купівлі-продажу.', ru: 'Перерегистрация на нового владельца по договору купли-продажи.', en: 'Re-registration to a new owner under a sales contract.' },
  trade_purchase: { ua: 'Реєстрація після купівлі в торговельній організації.', ru: 'Регистрация после покупки в торговой организации.', en: 'Registration after purchase from a trading company.' },
  import_registration: { ua: 'Реєстрація після ввезення з-за кордону.', ru: 'Регистрация после ввоза из-за границы.', en: 'Registration after import from abroad.' },
  inheritance: { ua: 'Реєстрація за правом спадщини.', ru: 'Регистрация по праву наследования.', en: 'Registration by inheritance.' },
};
const ORD_WORD = /(?:\d{1,2}\s*[-‑]?\s*(?:й|ий|ій|ый|ой|я|го|st|nd|rd|th)?|перш\S*|перв\S*|друг\S*|втор\S*|трет\S*|четв\S*|п.?ят\S*|шост\S*|шест\S*|сьом\S*|седьм\S*|восьм\S*|дев.?ят\S*|десят\S*|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)/giu;
const OWNER_WORD = /(?:власник\S*|владел\S*|owner\S*|новий|новый|новая|нова|new|the|an?)(?![\p{L}])/giu;
export function ownerOrdinalOnly(text) {
  const t = String(text || '').toLowerCase().replace(OWNER_WORD, ' ').replace(ORD_WORD, ' ').replace(/[^\p{L}]+/gu, '');
  return t.length < 3;
}
export function describeOwnerEvents(history, facts, lang = 'en') {
  if (!Array.isArray(history)) return history;
  const l = lang === 'ua' || lang === 'ru' ? lang : 'en';
  const events = facts && Array.isArray(facts.owner_events) ? facts.owner_events : [];
  return history.map(h => {
    if (!h || typeof h !== 'object' || h.owner_ordinal_source !== 'registry' || !Number.isInteger(h.owner_ordinal)) return h;
    if (!ownerOrdinalOnly(h.event)) return h;
    const ev = events.find(e => e && e.ordinal === h.owner_ordinal);
    const op = (ev && OWNER_OPERATION_TEXT[ev.operation]) ? ev.operation : (h.owner_ordinal === 1 ? 'first_registration' : 'owner_reregistration');
    return { ...h, event: OWNER_OPERATION_TEXT[op][l], event_source: 'registry_operation' };
  });
}
