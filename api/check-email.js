/* CalCar Check: лист "звіт готовий" за явним opt-in для конкретного Check.
   POST /api/check-email  { token, email?, aid?, lang? }  [Authorization: Bearer <JWT Supabase>]
   -> { ok, masked, sent }

   Лист надсилає СЕРВЕР, а не сторінка: opt-in лежить у рядку check_jobs
   (email_requested_at, email_recipient), тому вкладку можна закрити. Після
   успішного завершення job api/check.js викликає deliverReportEmail(); якщо
   job уже готовий у момент opt-in, лист іде одразу з цього ендпоінта.

   Не більше одного листа на Check: відправник спершу АТОМАРНО захоплює рядок
   (PATCH з умовою email_sent_at is null і вільним email_claimed_at), а запит
   до провайдера несе Idempotency-Key від токена. Повторне завершення,
   повторне опитування, reload чи подвійне натискання другого листа не дають.

   Той, хто увійшов: адреса береться з акаунта (JWT перевіряє Supabase Auth),
   тіло запиту її не задає; звіт сервер сам кладе в reports, лист веде на
   /check/<public_id>. Гість: адреса з тіла запиту, лист веде на наявне
   публічне посилання /check/r/<slug>/<token>. У посиланні немає ні VIN, ні
   email. Адреса це персональні дані: у логи йде лише відбиток токена.

   Провайдер: Resend через HTTP API (RESEND_API_KEY), без npm-залежностей.
   Збій провайдера на сам Check не впливає: звіт уже записаний і доступний. */

export const config = { maxDuration: 30 };

import { randomInt } from 'node:crypto';
import { resolveLocale, errText } from './locale.js';
import { TOKEN_RE, publicReport, sharePath } from './share.js';
import { tokenRef } from './check-job.js';

export const REPORT_EMAIL_FROM = 'CalCar <reports@calcar.io>';
export const SITE_ORIGIN = 'https://calcar.io';
/* opt-in приймається лише для свіжого job: старе публічне посилання не
   може стати способом надіслати лист на довільну адресу */
export const OPT_IN_WINDOW_MS = 30 * 60 * 1000;
/* захоплення, після якого функція померла, не блокує лист назавжди:
   повторна спроба безпечна завдяки Idempotency-Key провайдера */
export const CLAIM_STALE_MS = 2 * 60 * 1000;
const DB_TIMEOUT_MS = 5000;
const SEND_TIMEOUT_MS = 8000;
const SEND_ATTEMPTS = 2;

const EMAIL_RE = /^[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[^\s@<>(),;:"'.]{2,}$/;
export function normalizeEmail(raw) {
  const s = String(raw == null ? '' : raw).trim();
  return s.length <= 254 && EMAIL_RE.test(s) ? s : null;
}
/* a***@gmail.com: для підтвердження на сторінці, повна адреса назад не йде */
export function maskEmail(email) {
  const s = String(email || '');
  const at = s.lastIndexOf('@');
  return at < 1 ? '' : s[0] + '***' + s.slice(at);
}

const TEXT = {
  en: {
    subject: title => 'CalCar: the ' + title + ' analysis is ready',
    subjectPlain: 'CalCar: your car analysis is ready',
    lead: 'The car analysis is complete.',
    line: 'CalCar has put together the history, condition, risks, market value and a final conclusion.',
    cta: 'Open report',
    foot: 'You received this email because you asked CalCar to send you this report. No other emails will follow.',
  },
  ua: {
    subject: title => 'CalCar: аналіз ' + title + ' готовий',
    subjectPlain: 'CalCar: аналіз авто готовий',
    lead: 'Аналіз автомобіля завершено.',
    line: 'CalCar зібрав історію, стан, ризики, ринкову вартість і підсумковий висновок.',
    cta: 'Відкрити звіт',
    foot: 'Цей лист прийшов на твій запит надіслати готовий звіт CalCar. Інших листів не буде.',
  },
  ru: {
    subject: title => 'CalCar: анализ ' + title + ' готов',
    subjectPlain: 'CalCar: анализ авто готов',
    lead: 'Анализ автомобиля завершён.',
    line: 'CalCar собрал историю, состояние, риски, рыночную стоимость и итоговый вывод.',
    cta: 'Открыть отчёт',
    foot: 'Это письмо пришло по вашему запросу прислать готовый отчёт CalCar. Других писем не будет.',
  },
};
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* короткий лист: назва авто в темі, один рядок і кнопка; звіт у лист не копіюється */
export function buildReportEmail({ lang, title, link }) {
  const l = resolveLocale(lang);
  const T = TEXT[l] || TEXT.en;
  const name = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const subject = name ? T.subject(name) : T.subjectPlain;
  const text = [T.lead, T.line, '', T.cta + ': ' + link, '', T.foot].join('\n');
  const html = '<!doctype html><html lang="' + (l === 'ua' ? 'uk' : l) + '"><body style="margin:0;padding:0;background:#F7F8F6">'
    + '<div style="max-width:480px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#141619">'
    + '<div style="font-size:18px;font-weight:800;margin-bottom:24px">CalCar</div>'
    + (name ? '<div style="font-size:20px;font-weight:700;line-height:1.3;margin-bottom:12px">' + escHtml(name) + '</div>' : '')
    + '<p style="font-size:15px;line-height:1.5;margin:0 0 6px">' + escHtml(T.lead) + '</p>'
    + '<p style="font-size:15px;line-height:1.5;margin:0 0 24px;color:#697079">' + escHtml(T.line) + '</p>'
    + '<a href="' + escHtml(link) + '" style="display:inline-block;background:#B8F23D;color:#141619;font-size:15px;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:12px">' + escHtml(T.cta) + '</a>'
    + '<p style="font-size:12px;line-height:1.5;margin:32px 0 0;color:#697079">' + escHtml(T.foot) + '</p>'
    + '</div></body></html>';
  return { subject, text, html };
}

function sbCfg() {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return null;
  return { root: base.replace(/\/$/, ''), key, hdr: { apikey: key, authorization: 'Bearer ' + key } };
}
async function timedFetch(url, init, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(timer); }
}
/* PostgREST зі службовою роллю; тіло JSON або null */
async function rest(cfg, path, init = {}) {
  const r = await timedFetch(cfg.root + '/rest/v1/' + path, {
    ...init,
    headers: { ...cfg.hdr, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) },
  }, DB_TIMEOUT_MS);
  let body = null;
  try { body = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, body };
}
const logErr = o => console.error(JSON.stringify(o));
const errType = e => (e && e.name === 'AbortError' ? 'timeout' : 'network');

/* коротка адреса кабінету: той самий алфавіт і довжина, що на сторінці */
function makePid() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += A[randomInt(A.length)];
  return out;
}

/* Звіт того, хто увійшов, у його кабінеті: сторінка могла бути закрита,
   тож зберігає сервер. Ідемпотентно за _meta.share_token: наявний рядок
   (у тому числі збережений сторінкою) не дублюється.
   -> { id, public_id } | null */
export async function ensureSavedReport(cfg, userId, token, report) {
  const find = 'reports?user_id=eq.' + encodeURIComponent(userId) + '&kind=eq.check&data->_meta->>share_token=eq.'
    + encodeURIComponent(token) + '&select=id,public_id&order=created_at.asc&limit=1';
  const have = await rest(cfg, find);
  if (!have.ok) throw Object.assign(new Error('reports read'), { http_status: have.status });
  if (Array.isArray(have.body) && have.body[0]) return have.body[0];
  const data = publicReport(report);
  if (!data || !data.vehicle) return null;
  data._meta = { ...(data._meta || {}), share_token: token };
  const title = String((data.vehicle && data.vehicle.title) || 'Check').slice(0, 200);
  let last = null;
  /* друга спроба лише на випадок збігу короткої адреси */
  for (let attempt = 0; attempt < 2; attempt++) {
    const ins = await rest(cfg, 'reports?select=id,public_id', {
      method: 'POST', headers: { prefer: 'return=representation' },
      body: JSON.stringify({ user_id: userId, kind: 'check', public_id: makePid(), title, data }),
    });
    if (ins.ok && Array.isArray(ins.body) && ins.body[0]) return ins.body[0];
    last = ins.status;
    if (ins.status !== 409) break;
  }
  throw Object.assign(new Error('reports insert'), { http_status: last });
}

/* Перед записом status=done: якщо для job уже є opt-in від того, хто увійшов,
   звіт потрапляє в кабінет раніше, ніж сторінка побачить готовий job, і
   сторінка знаходить готовий рядок замість створення дубля. Помилка тут
   Check не ламає: deliverReportEmail спробує зберегти ще раз. */
export async function presaveOptedInReport(token, report) {
  const cfg = sbCfg();
  if (!cfg || !TOKEN_RE.test(String(token || ''))) return false;
  try {
    const jr = await rest(cfg, 'check_jobs?token=eq.' + encodeURIComponent(token) + '&select=user_id,email_requested_at&limit=1');
    const row = jr.ok && Array.isArray(jr.body) ? jr.body[0] : null;
    if (!row || !row.user_id || !row.email_requested_at) return false;
    return !!(await ensureSavedReport(cfg, row.user_id, token, report));
  } catch (e) {
    logErr({ op: 'report_email_presave', error_type: e.http_status ? 'http' : errType(e), http_status: e.http_status || null, token_ref: tokenRef(token) });
    return false;
  }
}

/* публічний ключ PostHog живе лише в calcar-public.js; сервер бере його
   з опублікованого файла сайту, а не тримає другу копію. Читання файла з
   диска тут свідомо немає: Vercel збирає api/ у CommonJS, і import-мета модуля
   ламає завантаження модуля (а з ним і api/check.js). Не вдалося: подія
   не йде, лист від цього не залежить */
let phCache = null;
async function posthogCfg() {
  if (phCache) return phCache;
  try {
    const r = await timedFetch(SITE_ORIGIN + '/calcar-public.js', {}, 3000);
    if (!r.ok) return null;
    const src = await r.text();
    const key = (src.match(/posthog_key:\s*'([^']+)'/) || [])[1];
    const host = (src.match(/posthog_host:\s*'(https:\/\/[^']+)'/) || [])[1];
    if (key && host) phCache = { key, host: host.replace(/\/$/, '') };
  } catch (e) {}
  return phCache;
}
/* report_email_sent: єдина подія, яку бачить лише сервер (вкладка могла
   бути закрита). Властивості безпечні: без адреси, VIN і токена */
async function captureEmailSent({ distinctId, authenticated, locale, ref }) {
  const ph = await posthogCfg();
  if (!ph) { logErr({ op: 'report_email_event', error_type: 'no_public_key', token_ref: ref }); return false; }
  try {
    const r = await timedFetch(ph.host + '/i/v0/e/', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: ph.key, event: 'report_email_sent', distinct_id: distinctId,
        properties: { product: 'check', authenticated: !!authenticated, locale, $process_person_profile: false },
      }),
    }, 3000);
    if (!r.ok) logErr({ op: 'report_email_event', error_type: 'http', http_status: r.status, token_ref: ref });
    return r.ok;
  } catch (e) {
    logErr({ op: 'report_email_event', error_type: errType(e), token_ref: ref });
    return false;
  }
}

async function sendViaResend({ to, subject, html, text, idemKey }) {
  let last = { ok: false, status: null, error_type: 'network' };
  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
    try {
      const r = await timedFetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'content-type': 'application/json', 'idempotency-key': idemKey },
        body: JSON.stringify({ from: process.env.REPORT_EMAIL_FROM || REPORT_EMAIL_FROM, to: [to], subject, html, text }),
      }, SEND_TIMEOUT_MS);
      if (r.ok) return { ok: true, status: r.status };
      last = { ok: false, status: r.status, error_type: 'http' };
      /* 4xx (крім 429) повтором не лікується */
      if (r.status < 500 && r.status !== 429) break;
    } catch (e) {
      last = { ok: false, status: null, error_type: errType(e) };
    }
  }
  return last;
}

/* Надіслати лист для готового job з opt-in. Викликається після завершення
   Check і з ендпоінта opt-in; скільки б разів не викликали, лист один.
   Ніколи не кидає: -> { sent, reason? } */
export async function deliverReportEmail(token) {
  const ref = tokenRef(token);
  try {
    const cfg = sbCfg();
    if (!cfg || !TOKEN_RE.test(String(token || ''))) return { sent: false, reason: 'not_configured' };
    const jobQ = 'check_jobs?token=eq.' + encodeURIComponent(token);
    const nowIso = new Date().toISOString();
    const staleIso = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
    /* атомарне захоплення: рядок бере лише один виклик */
    const claim = await rest(cfg, jobQ + '&status=eq.done&email_requested_at=not.is.null&email_sent_at=is.null'
      + '&or=' + encodeURIComponent('(email_claimed_at.is.null,email_claimed_at.lt."' + staleIso + '")')
      + '&select=token,email_recipient,email_aid,lang,user_id,report', {
      method: 'PATCH', headers: { prefer: 'return=representation' },
      body: JSON.stringify({ email_claimed_at: nowIso }),
    });
    if (!claim.ok) {
      logErr({ op: 'report_email_claim', error_type: 'http', http_status: claim.status, token_ref: ref });
      return { sent: false, reason: 'claim_failed' };
    }
    const row = Array.isArray(claim.body) ? claim.body[0] : null;
    if (!row) return { sent: false, reason: 'nothing_to_send' };
    /* невдача: захоплення знімається, наступний opt-in може спробувати ще раз */
    const release = async reason => {
      await rest(cfg, jobQ + '&email_sent_at=is.null', {
        method: 'PATCH', headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ email_claimed_at: null, email_error: reason }),
      }).catch(() => {});
      return { sent: false, reason };
    };
    const to = normalizeEmail(row.email_recipient);
    const report = row.report;
    if (!to || !report || !report.vehicle) {
      logErr({ op: 'report_email_send', error_type: 'bad_row', token_ref: ref });
      return release('bad_row');
    }
    if (!process.env.RESEND_API_KEY) {
      logErr({ op: 'report_email_send', error_type: 'provider_not_configured', token_ref: ref });
      return release('provider_not_configured');
    }
    /* посилання: кабінет для того, хто увійшов; публічний токен для гостя
       і як запасний шлях, якщо зберегти в кабінет не вдалося */
    let path = sharePath(report, token);
    if (row.user_id) {
      try {
        const saved = await ensureSavedReport(cfg, row.user_id, token, report);
        if (saved && saved.public_id) path = '/check/' + saved.public_id;
        else if (saved && saved.id) path = '/result-check.html?id=' + saved.id;
      } catch (e) {
        logErr({ op: 'report_email_save_report', error_type: e.http_status ? 'http' : errType(e), http_status: e.http_status || null, token_ref: ref });
      }
    }
    const link = SITE_ORIGIN + path + (path.includes('?') ? '&' : '?') + 'src=email';
    const lang = resolveLocale(row.lang);
    const mail = buildReportEmail({ lang, title: report.vehicle.title, link });
    const sent = await sendViaResend({ to, ...mail, idemKey: 'calcar-check-email/' + ref });
    if (!sent.ok) {
      logErr({ op: 'report_email_send', error_type: sent.error_type, http_status: sent.status, token_ref: ref });
      return release('provider_' + (sent.status || sent.error_type));
    }
    const mark = await rest(cfg, jobQ, {
      method: 'PATCH', headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ email_sent_at: new Date().toISOString(), email_error: null }),
    }).catch(() => ({ ok: false, status: null }));
    /* лист уже пішов; без позначки повтор зупинить Idempotency-Key */
    if (!mark.ok) logErr({ op: 'report_email_mark_sent', error_type: 'http', http_status: mark.status, token_ref: ref });
    console.log(JSON.stringify({ op: 'report_email_send', ok: true, authenticated: !!row.user_id, locale: lang, token_ref: ref }));
    await captureEmailSent({ distinctId: row.user_id || row.email_aid || 'email-' + ref, authenticated: !!row.user_id, locale: lang, ref });
    return { sent: true };
  } catch (e) {
    logErr({ op: 'report_email_send', error_type: errType(e), token_ref: ref });
    return { sent: false, reason: 'exception' };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body || {};
  const lang = resolveLocale(body.lang);
  res.setHeader('cache-control', 'no-store');
  const cfg = sbCfg();
  if (!cfg) return res.status(500).json({ error: errText(lang, 'internal') });
  const token = String(body.token || '').trim();
  if (!TOKEN_RE.test(token)) return res.status(404).json({ error: 'not found' });
  const ref = tokenRef(token);
  try {
    /* хто увійшов: адреса з акаунта, тіло запиту її не задає */
    const jwt = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    let userId = null, recipient = null;
    if (jwt) {
      const ur = await timedFetch(cfg.root + '/auth/v1/user', { headers: { apikey: cfg.key, authorization: 'Bearer ' + jwt } }, DB_TIMEOUT_MS);
      const user = ur.ok ? await ur.json().catch(() => null) : null;
      if (!user || !user.id) return res.status(401).json({ error: 'unauthorized' });
      userId = user.id;
      recipient = normalizeEmail(user.email);
    } else {
      recipient = normalizeEmail(body.email);
    }
    if (!recipient) return res.status(400).json({ error: errText(lang, 'bad_email') });
    const aid = /^[0-9a-f-]{36}$/.test(String(body.aid || '')) ? String(body.aid) : null;

    const jobQ = 'check_jobs?token=eq.' + encodeURIComponent(token);
    const jr = await rest(cfg, jobQ + '&select=status,created_at,email_sent_at&limit=1');
    if (!jr.ok) {
      logErr({ op: 'report_email_optin', error_type: 'http', http_status: jr.status, token_ref: ref });
      return res.status(503).json({ error: errText(lang, 'email_unavailable') });
    }
    const job = Array.isArray(jr.body) ? jr.body[0] : null;
    if (!job) return res.status(404).json({ error: 'not found' });
    const masked = maskEmail(recipient);
    if (job.email_sent_at) return res.status(200).json({ ok: true, masked, sent: true });
    const age = Date.now() - Date.parse(job.created_at || '');
    if (job.status === 'error' || !(age < OPT_IN_WINDOW_MS)) return res.status(409).json({ error: errText(lang, 'email_unavailable') });

    /* opt-in у рядку job; поки лист не надісланий і не в роботі, адресу
       можна виправити повторним запитом */
    const up = await rest(cfg, jobQ + '&email_sent_at=is.null&email_claimed_at=is.null&select=status', {
      method: 'PATCH', headers: { prefer: 'return=representation' },
      body: JSON.stringify({ email_requested_at: new Date().toISOString(), email_recipient: recipient, email_aid: aid, user_id: userId }),
    });
    if (!up.ok) {
      logErr({ op: 'report_email_optin', error_type: 'http', http_status: up.status, token_ref: ref });
      return res.status(503).json({ error: errText(lang, 'email_unavailable') });
    }
    const saved = Array.isArray(up.body) ? up.body[0] : null;
    /* job уже готовий (натискання майже одночасно із завершенням): лист одразу */
    let sent = false;
    if (saved && saved.status === 'done') sent = (await deliverReportEmail(token)).sent;
    return res.status(200).json({ ok: true, masked, sent });
  } catch (e) {
    logErr({ op: 'report_email_optin', error_type: errType(e), token_ref: ref });
    return res.status(500).json({ error: errText(lang, 'internal') });
  }
}
