/* CalCar: межа доказу для тверджень про архівні фото.

   Розрізняємо ДОКАЗ і ПОКАЗ. Якщо архівні кадри були доказом у цьому Check
   (їх передали у Vision, або є канонічний historical_visual з evidence по
   auction_photo_N), речення "на архівних фото видно..." чи "по архівних фото
   не підтверджується..." чесні, навіть коли галерея зараз не показується.

   Якщо фотодоказу НЕ було, будь-яке речення, що спирається на архівні фото як
   на джерело, неправдиве, зокрема заперечне: "на архівних фото не видно",
   "по архівних фото не підтверджується", "по доступних архівних фото
   неможливо". Такі речення прибираються з auction.summary і auction.findings.
   Лишаються речення про ВІДСУТНІСТЬ кадрів ("архівних фото нема", "без
   архівних фото", "фото не надані") і про поточні фото оголошення. Факт ДТП
   з іншого джерела не зникає.

   Регулярний вираз дослівно продубльований у result-check.html для старих
   збережених звітів; checkuxtest.js стереже, щоб копії не розійшлись. */

export const ARCHIVE_PHOTO_REF_RE = /(?:^|[\s,(«"])(?:на|по|за|з|із|из|от|згідно|согласно|on|in|from|per|by)\s+(?:(?:доступн|наявн|имеющ|цих|этих|тих|these|those|the|available)[a-zа-яіїєґё]*\s+)?(?:аукціонн|архівн|аукционн|архивн|історичн|историческ|auction|archive|historical)[a-zа-яіїєґё]*\s+(?:фото|кадр|знімк|снимк|photo|image)[a-zа-яіїєґё]*|(?:аукціонн|архівн|аукционн|архивн|історичн|историческ|auction|archive|historical)[a-zа-яіїєґё]*\s+(?:фото|кадр|знімк|снимк|photo|image)[a-zа-яіїєґё]*[^.!?]{0,24}?\s(?:не\s+|do\s+not\s+|don't\s+|doesn't\s+)?(?:показ|фіксу|фиксиру|зафікс|зафикс|підтверджу|подтвержда|демонстру|свідч|свидетельств|дозволя|позволя|show|confirm|reveal|indicate|allow)/i;

/* речення спирається на архівні фото як на джерело (ствердно чи заперечно) */
export function referencesArchivePhotos(sentence) {
  return ARCHIVE_PHOTO_REF_RE.test(String(sentence || ''));
}

/* були архівні кадри доказом у цьому звіті */
export function hasHistoricalPhotoEvidence({ auctionPhotos, historicalVisual } = {}) {
  if (Array.isArray(auctionPhotos) && auctionPhotos.length) return true;
  const ev = historicalVisual && Array.isArray(historicalVisual.evidence) ? historicalVisual.evidence : [];
  return ev.some(e => e && /auction_photo_\d+/.test(String(e.ref || '')));
}

/* auction без фотодоказу: прибрати кожне речення, що посилається на архівні фото.
   Повертає { auction, removed } і не мутує вхід */
export function stripUnbackedPhotoClaims(auction) {
  if (!auction || typeof auction !== 'object') return { auction, removed: 0 };
  let removed = 0;
  const out = { ...auction };
  if (typeof out.summary === 'string' && out.summary.trim()) {
    const parts = out.summary.match(/[^.!?]+[.!?]*\s*/g) || [out.summary];
    const kept = parts.filter(p => { const bad = referencesArchivePhotos(p); if (bad) removed++; return !bad; });
    const text = kept.join('').trim();
    out.summary = text || null;
  }
  if (Array.isArray(out.findings)) {
    out.findings = out.findings.filter(f => { const bad = f && referencesArchivePhotos(f.text); if (bad) removed++; return !bad; });
  }
  return { auction: out, removed };
}
