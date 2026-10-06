/* Evidence Coverage v1: облік фотодоказів. «Не показано» лише коли кадрів
   справді нема; кадр, що є в галереї, але не вибраний чи не прочитаний,
   описується чесно. Дублікати покриття не додають, архів не змішується з
   нинішніми кадрами, одометр зберігає кадр і впевненість. */
const fs = require('fs');
const errs = [];
(async () => {
  const EC = await import('./api/evidence-coverage.js');
  const MERGE = await import('./api/canonical-merge.js');
  const CV = await import('./api/current-visual.js');
  const CHK = await import('./api/check.js');

  const urls = n => Array.from({ length: n }, (_, i) => 'https://cdn1.riastatic.com/photosnew/auto/photo/car__' + i + 'hd.webp');
  const zonesWith = (sufficient = [], partial = []) => Object.fromEntries(CV.ZONES.map(z => [z, { visibility: sufficient.includes(z) ? 'sufficient' : partial.includes(z) ? 'partial' : 'not_visible', frames: [], findings: [] }]));
  const cvOf = (frames, zones, dashboard = {}) => ({ status: 'ok', frames: frames.map(gi => ({ gallery_index: gi, photo_identity: 'p' + gi })), dropped: [], zones, dashboard: { visible: false, odometer_reading: null, ...dashboard } });

  /* 1. моторний відсік є в галереї, але селектор упав: not_reviewed, не absent */
  {
    const c = EC.buildEvidenceCoverage({ gallery: { total: 120, photos: urls(120) }, selection: { mode: 'even_fallback', picked: Array.from({ length: 24 }, (_, i) => i * 5) },
      cv: cvOf(Array.from({ length: 24 }, (_, i) => i * 5), zonesWith(['front', 'rear', 'front_seats']), {}), historical: { photos: 0 } });
    if (c.classification !== 'none' || c.areas.engine_bay.status !== 'not_reviewed' || c.areas.underbody.status !== 'not_reviewed') errs.push('без класифікації моторний відсік названо відсутнім: ' + JSON.stringify(c.summary));
    if (!EC.mayClaimNotShown(c, 'engine_bay') === false) errs.push('mayClaimNotShown не відкидає not_reviewed');
    if (c.areas.exterior_body.status !== 'interpreted' || c.areas.interior.status !== 'interpreted') errs.push('розібрані зони не позначені interpreted');
  }
  /* 2. моторний відсік є, класифікований, але у вибірку не потрапив: present_not_selected */
  {
    const types = Array(40).fill('other'); types[0] = 'front'; types[1] = 'rear'; types[30] = 'engine_bay'; types[5] = 'dashboard';
    const picked = [0, 1, 5];
    const c = EC.buildEvidenceCoverage({ gallery: { total: 40, photos: urls(40) }, selection: { mode: 'selector', picked, types_all: types },
      cv: cvOf(picked, zonesWith(['front', 'rear', 'dashboard']), { visible: true }), historical: { photos: 0 } });
    const eb = c.areas.engine_bay;
    if (eb.status !== 'present_not_selected' || eb.present_frames.join() !== '31' || eb.selected_frames.length) errs.push('моторний відсік present_not_selected: ' + JSON.stringify(eb));
    /* 3. багажника нема в галереї і розбір його не побачив: absent */
    if (c.areas.trunk_cargo.status !== 'absent' || !EC.mayClaimNotShown(c, 'trunk_cargo')) errs.push('відсутній багажник не absent: ' + JSON.stringify(c.areas.trunk_cargo));
    /* 4. одометр: кадр панелі дійшов, панель видно, читання нема: selected_unreadable із причиною */
    if (c.areas.odometer.status !== 'selected_unreadable' || c.areas.odometer.reason !== 'no_reading_on_visible_cluster') errs.push('одометр на видимій панелі без читання: ' + JSON.stringify(c.areas.odometer));
    if (c.areas.dashboard_cluster.status !== 'interpreted') errs.push('панель розібрана, але статус не interpreted');
  }
  /* 4б. одометр прочитаний: provenance і впевненість зберігаються; low confidence чи unknown unit це unreadable із читанням */
  {
    const types = Array(10).fill('front'); types[3] = 'dashboard';
    const base = { gallery: { total: 10, photos: urls(10) }, selection: { mode: 'all', picked: [...Array(10).keys()], types_all: types }, historical: { photos: 0 } };
    const ok = EC.buildEvidenceCoverage({ ...base, cv: cvOf([...Array(10).keys()], zonesWith(['dashboard']), { visible: true, odometer_reading: { value: 151975, unit: 'km', confidence: 'high', gallery_index: 3, photo_identity: 'id3' } }) });
    if (ok.areas.odometer.status !== 'interpreted' || ok.areas.odometer.reading.photo !== 4 || ok.areas.odometer.reading.photo_identity !== 'id3' || ok.areas.odometer.reading.confidence !== 'high') errs.push('прочитаний одометр без provenance: ' + JSON.stringify(ok.areas.odometer));
    const weak = EC.buildEvidenceCoverage({ ...base, cv: cvOf([...Array(10).keys()], zonesWith(['dashboard']), { visible: true, odometer_reading: { value: 151975, unit: 'unknown', confidence: 'high', gallery_index: 3 } }) });
    if (weak.areas.odometer.status !== 'selected_unreadable' || weak.areas.odometer.reason !== 'unit_unknown' || weak.areas.odometer.reading.value !== 151975) errs.push('одометр без одиниці має лишатись unreadable з читанням: ' + JSON.stringify(weak.areas.odometer));
    /* одометр є на кадрі, який не вибрали */
    const t2 = Array(40).fill('other'); t2[0] = 'front'; t2[33] = 'dashboard';
    const missed = EC.buildEvidenceCoverage({ gallery: { total: 40, photos: urls(40) }, selection: { mode: 'selector', picked: [0], types_all: t2 }, cv: cvOf([0], zonesWith(['front']), {}), historical: { photos: 0 } });
    if (missed.areas.odometer.status !== 'present_not_selected' || missed.areas.odometer.present_frames.join() !== '34') errs.push('пропущений кадр панелі не present_not_selected: ' + JSON.stringify(missed.areas.odometer));
  }
  /* 5. документ: є кадр, аналізатора нема: present_not_interpreted; нема кадру: absent */
  {
    const types = Array(30).fill('front'); types[7] = 'document';
    const c = EC.buildEvidenceCoverage({ gallery: { total: 30, photos: urls(30) }, selection: { mode: 'selector', picked: [0, 7], types_all: types }, cv: cvOf([0, 7], zonesWith(['front']), {}), historical: { photos: 0 } });
    if (c.areas.document.status !== 'present_not_interpreted' || c.areas.document.present_frames.join() !== '8') errs.push('документ: ' + JSON.stringify(c.areas.document));
    const none = EC.buildEvidenceCoverage({ gallery: { total: 30, photos: urls(30) }, selection: { mode: 'selector', picked: [0], types_all: Array(30).fill('front') }, cv: cvOf([0], zonesWith(['front']), {}), historical: { photos: 0 } });
    if (none.areas.document.status !== 'absent') errs.push('без кадру документа статус не absent');
    if (!CV.SELECTOR_TYPES.includes('document') || !/document/.test(CV.SELECTOR_PROMPT) || !CV.HIGH_DETAIL_TYPES.has('document')) errs.push('селектор не знає типу document');
    const dv = CHK.pickDiverseFrames(['front', 'front', 'document', 'other', 'rear'], 3, 2);
    if (!dv.picked.includes(2)) errs.push('документ не потрапляє у вибірку кадрів');
  }
  /* 6. дублікат чи перевикладений кадр покриття не збільшує */
  {
    const a = 'https://cdn1.riastatic.com/photosnew/auto/photo/car__1hd.webp', b = 'https://cdn2.riastatic.com/photosnew/auto/photo/car__1hd.webp?size=big';
    const types = ['engine_bay', 'engine_bay', 'front'];
    const c = EC.buildEvidenceCoverage({ gallery: { total: 3, photos: [a, b, urls(5)[4]], variants_removed: 2 }, selection: { mode: 'all', picked: [0, 1, 2], types_all: types }, cv: cvOf([0, 1, 2], zonesWith(['front', 'engine_bay']), {}), historical: { photos: 0 } });
    if (c.areas.engine_bay.present_unique !== 1 || c.areas.engine_bay.present_frames.length !== 2 || c.gallery.unique !== 2 || c.gallery.variants_removed !== 2) errs.push('дублікати рахуються як два кадри: ' + JSON.stringify({ eb: c.areas.engine_bay, g: c.gallery }));
  }
  /* 7. архівні кадри аукціону проти нинішніх: окремий корпус */
  {
    const types = Array(10).fill('front');
    const c = EC.buildEvidenceCoverage({ gallery: { total: 10, photos: urls(10) }, selection: { mode: 'all', picked: [...Array(10).keys()], types_all: types }, cv: cvOf([...Array(10).keys()], zonesWith(['front']), {}), historical: { photos: 8, hv_status: 'executed' } });
    if (c.areas.historical.status !== 'interpreted' || c.areas.historical.corpus !== 'auction_archive' || c.areas.historical.present_frames !== 8) errs.push('архів: ' + JSON.stringify(c.areas.historical));
    if (c.areas.exterior_body.present_frames.length !== 10) errs.push('архівні кадри потрапили в нинішнє покриття');
    const noHv = EC.buildEvidenceCoverage({ gallery: { total: 10, photos: urls(10) }, selection: { mode: 'all', picked: [...Array(10).keys()] }, cv: null, historical: { photos: 8, hv_status: 'fallback_main_call' } });
    if (noHv.areas.historical.status !== 'selected_unreadable' || noHv.areas.exterior_body.status !== 'not_reviewed') errs.push('без розбору статуси неправильні: ' + JSON.stringify(noHv.summary));
    if (EC.buildEvidenceCoverage({ gallery: { total: 0, photos: [] }, selection: { mode: 'all', picked: [] }, cv: null, historical: { photos: 0 } }).areas.historical.status !== 'absent') errs.push('без архіву статус не absent');
  }
  /* 8. кадри вибрані, але не доставлені в розбір: selected_unreadable із причиною */
  {
    const types = Array(30).fill('front'); types[9] = 'engine_bay';
    const cv = cvOf([0, 9], zonesWith(['front']), {}); cv.dropped = [9];
    const c = EC.buildEvidenceCoverage({ gallery: { total: 30, photos: urls(30) }, selection: { mode: 'selector', picked: [0, 9], types_all: types }, cv, historical: { photos: 0 } });
    if (c.areas.engine_bay.status !== 'selected_unreadable' || c.areas.engine_bay.reason !== 'frames_not_delivered' || c.vision.dropped.join() !== '10') errs.push('недоставлений кадр: ' + JSON.stringify(c.areas.engine_bay));
  }
  /* 9. текст звіту: «не показано» виправляється лише там, де покриття цього не підтверджує */
  {
    const types = Array(40).fill('other'); types[0] = 'front'; types[30] = 'engine_bay';
    const c = EC.buildEvidenceCoverage({ gallery: { total: 40, photos: urls(40) }, selection: { mode: 'selector', picked: [0], types_all: types }, cv: cvOf([0], zonesWith(['front']), {}), historical: { photos: 0 } });
    const r = MERGE.correctCoverageClaims([
      { status: 'unknown', text: 'Моторный отсек и днище на фото не показаны.' },
      { status: 'unknown', text: 'Багажник на фото не показан.' },
      { status: 'warn', text: 'Царапина на двери.' },
    ], c, 'ru');
    if (r.stats.corrected !== 1 || r.stats.kept_absent !== 1 || !/Моторный отсек: кадры есть в объявлении/.test(r.items[0].text) || r.items[1].text !== 'Багажник на фото не показан.' || r.items[2].text !== 'Царапина на двери.') errs.push('виправлення тверджень: ' + JSON.stringify(r));
    const ua = MERGE.correctCoverageClaims([{ status: 'unknown', text: 'Моторний відсік не показаний.' }], c, 'ua');
    if (!/^Моторний відсік: кадри є в оголошенні/.test(ua.items[0].text)) errs.push('українське формулювання: ' + ua.items[0].text);
    const none = EC.buildEvidenceCoverage({ gallery: { total: 120, photos: urls(120) }, selection: { mode: 'even_fallback', picked: [0] }, cv: cvOf([0], zonesWith(['front']), {}), historical: { photos: 0 } });
    const en = MERGE.correctCoverageClaims([{ status: 'unknown', text: 'The engine bay is not shown in the photos.' }], none, 'en');
    if (!/^Engine bay: not reviewed from the photos/.test(en.items[0].text)) errs.push('англійське формулювання not_reviewed: ' + en.items[0].text);
    if (MERGE.correctCoverageClaims([{ status: 'unknown', text: 'x' }], null, 'ru').stats.checked !== 0) errs.push('без покриття текст чіпається');
  }
  /* 10. з'єднання в Check і Final Conclusion */
  {
    const chk = fs.readFileSync('api/check.js', 'utf8');
    if (!/types_all: types \}/.test(chk)) errs.push('повна класифікація галереї не зберігається');
    if (!/const coverageFor = cvRes => buildEvidenceCoverage\(/.test(chk) || !/cvCoverage = coverageFor\(cvTerminal\)/.test(chk)) errs.push('покриття не рахується по фінальному розбору');
    if (!/decisionEvidenceBlock\(cvFeed\.current_visual, [^)]*, lang, cvCoverage\)/.test(chk)) errs.push('main не отримує облік доказів');
    const iCorr = chk.indexOf('correctCoverageClaims(parsed.photo_findings'), iLoc = chk.indexOf('localizePhotoRefs(parsed');
    if (!(iCorr > 0 && iCorr < iLoc)) errs.push('виправлення тверджень не стоїть до локалізації посилань');
    if (!/evidence_coverage: cvCoverage/.test(chk) || !/coverage_claims: coverageClaims/.test(chk)) errs.push('нема телеметрії покриття');
    for (const need of ['ОБЛІК ДОКАЗІВ (evidence_coverage)', 'дозволена ЛИШЕ для статусу absent', 'формулювання береться зі статусу в evidence_coverage']) if (!chk.includes(need)) errs.push('правила main без: ' + need);
    if (!/\| document \| detail \| other\./.test(chk)) errs.push('production-селектор без типу document');
    const prodPrompt = chk.match(/text: '(Класифікуй кадри оголошення авто за типом[^']*)'/);
    if (!prodPrompt || prodPrompt[1] !== CV.SELECTOR_PROMPT) errs.push('промпт селектора розійшовся з current-visual.js');
    const PRI = chk.slice(chk.indexOf('export function pickDiverseFrames'), chk.indexOf('export function sanitizeBodyWrap'));
    if (!/'engine_bay', 'document', 'front'/.test(PRI)) errs.push('document не в пріоритеті вибірки');
    const fc = fs.readFileSync('api/conclusion.js', 'utf8');
    if (!/zones_not_shown: ec \? arr\(ec\.summary\.absent\)/.test(fc) || !/areas_not_reviewed:/.test(fc) || !/areas_unreadable:/.test(fc)) errs.push('Final Conclusion не розрізняє відсутнє і неперевірене');
    if (!/the only areas you may call "not shown in the photos"/.test(fc)) errs.push('правило FC про «не показано» відсутнє');
    const blk = MERGE.decisionEvidenceBlock({ zones: zonesWith(['front']), equipment_visual: [], modification_candidates: [], coverage: { frames_received: 1, quality_flags: [] }, dashboard: { engine_state: 'unknown', warning_lights: [], readable_messages: [] } }, 1, 'ru',
      EC.buildEvidenceCoverage({ gallery: { total: 40, photos: urls(40) }, selection: { mode: 'even_fallback', picked: [0] }, cv: cvOf([0], zonesWith(['front']), {}), historical: { photos: 0 } }));
    if (!/"evidence_coverage":\{"classification":"none"/.test(blk) || !/"engine_bay":"not_reviewed \(frames_unclassified\)"/.test(blk)) errs.push('блок доказу без обліку покриття: ' + blk.slice(0, 200));
  }

  if (errs.length) { console.log('EVIDENCE COVERAGE TEST FAILED:'); for (const e of errs) console.log('  - ' + e); process.exit(1); }
  console.log('облік фотодоказів: absent лише за повною класифікацією · present_not_selected · selected_unreadable · одометр із provenance · дублікати не рахуються · архів окремо · текст «не показано» виправляється кодом');
  console.log('EVIDENCE COVERAGE TEST PASSED');
})();
