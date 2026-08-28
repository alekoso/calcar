/* CalCar: seed каталогів знань із зовнішніх джерел.
   ЗАПУСКАЄТЬСЯ ЛИШЕ РУКАМИ: node knowledge-seed.js models.json
   (models.json: [{"make":"BMW","model":"5 Series","generation":"G30","years":"2017-2023"}]).
   Цей скрипт НЕ викликається з Check і НЕ запускається автоматично.

   Ланцюжок: пошук по зовнішніх джерелах -> завантаження знайдених сторінок ->
   LLM ВИТЯГУЄ структуровані candidate-факти ЛИШЕ з наданого тексту (не
   відповідає з памʼяті) -> запис у model_option_catalog / model_issue_catalog
   з повним provenance. Факт без source_url НЕ записується ніколи.
   Каталоги заповнює лише цей скрипт: спостереження їх не редагують. */

const ENV_BASE = process.env.SUPABASE_URL;
const ENV_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/* безкоштовний пошук: html.duckduckgo.com, як у auction discovery */
async function searchWeb(query, max = 5) {
  const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
    headers: { 'user-agent': UA },
  });
  const html = await r.text();
  const urls = [];
  for (const m of html.matchAll(/uddg=([^&"]+)/g)) {
    try {
      const u = decodeURIComponent(m[1]);
      if (/^https?:\/\//.test(u) && !/duckduckgo|youtube|facebook/i.test(u) && !urls.includes(u)) urls.push(u);
    } catch (e) { /* битий uddg */ }
    if (urls.length >= max) break;
  }
  return urls;
}

async function fetchPage(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': UA } });
    clearTimeout(t);
    if (!r.ok) return null;
    const html = await r.text();
    /* грубий текст сторінки: без скриптів і тегів, обрізаний */
    return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 18000);
  } catch (e) { return null; }
}

/* LLM-витяг: ЛИШЕ з наданого тексту сторінки, кожен факт з excerpt-підставою */
async function extractFacts(model, pageText, sourceUrl, kind) {
  const schema = kind === 'options'
    ? '{"facts":[{"option_name":"...","category":"comfort|interior|multimedia|assist|exterior|performance|safety|other","availability":"standard|optional","year_from":2017,"year_to":2023,"markets":["EU"],"applies_to":{"engine":null,"trim":null},"visual_markers":["де видно ознаку"],"applicability":"до чого джерело відносить факт","confidence":"high|medium|low","evidence_excerpt":"коротка цитата-підстава з тексту"}]}'
    : '{"facts":[{"issue_key":"SNAKE_CASE_ключ_проблеми","title":"назва","detail":"1-2 речення","applies_to":{"engine":null},"year_from":2017,"year_to":2023,"applicability":"...","confidence":"high|medium|low","evidence_excerpt":"коротка цитата-підстава"}]}';
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + OPENAI_KEY },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
      response_format: { type: 'json_object' },
      max_completion_tokens: 4000,
      messages: [{
        role: 'user',
        content: 'Витягни ' + (kind === 'options' ? 'заводські опції' : 'типові проблеми/болячки')
          + ' для ' + model.make + ' ' + model.model + ' ' + model.generation + ' (' + (model.years || '') + ') СТРОГО з тексту сторінки нижче. '
          + 'ЗАБОРОНЕНО додавати факти з власної памʼяті: лише те, що прямо сказано в тексті, з короткою цитатою-підставою (evidence_excerpt, до 200 символів, НЕ копія сторінки). '
          + 'Нема фактів у тексті: порожній масив. Відповідай ЛИШЕ JSON за схемою: ' + schema
          + '\n\nДЖЕРЕЛО: ' + sourceUrl + '\n\nТЕКСТ СТОРІНКИ:\n' + pageText,
      }],
    }),
  });
  const data = await r.json();
  try {
    return JSON.parse((data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim()).facts || [];
  } catch (e) { return []; }
}

async function api(path, opts) {
  return fetch(ENV_BASE.replace(/\/$/, '') + '/rest/v1/' + path, Object.assign({
    headers: Object.assign({ apikey: ENV_KEY, authorization: 'Bearer ' + ENV_KEY, 'content-type': 'application/json' }, (opts && opts.headers) || {}),
  }, opts));
}

async function resolveOption(name, category) {
  const norm = String(name || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!norm) return null;
  const got = await api('option_alias?alias_norm=eq.' + encodeURIComponent(norm) + '&select=option_id');
  const found = await got.json().catch(() => []);
  if (found.length) return found[0].option_id;
  await api('option_dict?on_conflict=canonical_name', {
    method: 'POST', headers: { prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify([{ canonical_name: name.slice(0, 80), category: category || 'other' }]),
  });
  const re = await api('option_dict?canonical_name=eq.' + encodeURIComponent(name.slice(0, 80)) + '&select=option_id');
  const rows = await re.json().catch(() => []);
  if (!rows.length) return null;
  await api('option_alias?on_conflict=alias_norm', {
    method: 'POST', headers: { prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify([{ alias_norm: norm, alias: name.slice(0, 80), lang: null, option_id: rows[0].option_id }]),
  });
  return rows[0].option_id;
}

async function seedModel(model) {
  const queries = {
    options: [
      model.make + ' ' + model.model + ' ' + model.generation + ' standard optional equipment list',
      model.make + ' ' + model.model + ' ' + model.generation + ' options packages brochure',
    ],
    issues: [
      model.make + ' ' + model.model + ' ' + model.generation + ' common problems reliability',
      model.make + ' ' + model.model + ' ' + model.generation + ' типичные проблемы болячки',
    ],
  };
  for (const kind of ['options', 'issues']) {
    for (const q of queries[kind]) {
      const urls = await searchWeb(q, 3);
      for (const url of urls) {
        const text = await fetchPage(url);
        if (!text || text.length < 800) continue;
        const facts = await extractFacts(model, text, url, kind);
        for (const fct of facts) {
          /* факт без source_url не записується: url тут завжди є за
             побудовою, excerpt обовʼязковий як підстава */
          if (!url || !fct || !fct.evidence_excerpt) continue;
          if (kind === 'options') {
            if (!fct.option_name) continue;
            const optionId = await resolveOption(fct.option_name, fct.category);
            if (!optionId) continue;
            await api('model_option_catalog?on_conflict=make,model,generation,option_id,source_url', {
              method: 'POST', headers: { prefer: 'resolution=ignore-duplicates' },
              body: JSON.stringify([{
                make: model.make, model: model.model, generation: model.generation,
                option_id: optionId,
                availability: fct.availability === 'standard' ? 'standard' : 'optional',
                year_from: fct.year_from || null, year_to: fct.year_to || null,
                markets: Array.isArray(fct.markets) ? fct.markets : [],
                applies_to: fct.applies_to || {},
                visual_markers: Array.isArray(fct.visual_markers) ? fct.visual_markers : [],
                source_url: url, source_title: null,
                source_type: /press/i.test(url) ? 'press_release' : /forum/i.test(url) ? 'forum' : 'other',
                retrieved_at: new Date().toISOString(),
                applicability: fct.applicability || null,
                confidence: ['high', 'medium', 'low'].includes(fct.confidence) ? fct.confidence : 'low',
                evidence_excerpt: String(fct.evidence_excerpt).slice(0, 300),
              }]),
            });
          } else {
            /* канонічний issue_key обовʼязковий: без нього запис каталогу
               не створюється (NOT NULL у схемі) */
            if (!fct.title || !fct.issue_key) continue;
            await api('model_issue_catalog?on_conflict=make,model,generation,title,source_url', {
              method: 'POST', headers: { prefer: 'resolution=ignore-duplicates' },
              body: JSON.stringify([{
                make: model.make, model: model.model, generation: model.generation,
                issue_key: String(fct.issue_key).slice(0, 60),
                title: String(fct.title).slice(0, 160),
                detail: fct.detail ? String(fct.detail).slice(0, 500) : null,
                applies_to: fct.applies_to || {},
                year_from: fct.year_from || null, year_to: fct.year_to || null,
                source_url: url, source_title: null,
                source_type: /forum/i.test(url) ? 'forum' : /recall/i.test(url) ? 'recall' : 'other',
                retrieved_at: new Date().toISOString(),
                applicability: fct.applicability || null,
                confidence: ['high', 'medium', 'low'].includes(fct.confidence) ? fct.confidence : 'low',
                evidence_excerpt: String(fct.evidence_excerpt).slice(0, 300),
              }]),
            });
          }
        }
        console.log('[seed]', model.make, model.model, kind, url.slice(0, 70));
      }
    }
  }
}

async function main() {
  if (!ENV_BASE || !ENV_KEY || !OPENAI_KEY) {
    console.error('Потрібні env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY');
    process.exit(1);
  }
  const file = process.argv[2];
  if (!file) { console.error('Використання: node knowledge-seed.js models.json'); process.exit(1); }
  const models = JSON.parse(require('fs').readFileSync(file, 'utf8'));
  for (const m of models) await seedModel(m);
  console.log('seed завершено:', models.length, 'моделей');
}

module.exports = { searchWeb, extractFacts };
if (require.main === module) main().catch(e => { console.error('seed впав:', e.message); process.exit(1); });
