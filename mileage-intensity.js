/* CalCar: шкала інтенсивності пробігу для відображення.

   Нової формули пробігу тут НЕМА. Середньорічний пробіг, референс класу
   двигуна і співвідношення рахує вісь Пробіг у api/score-v3.js
   (computeDimensions: annual_mileage_km, reference_km_year, usage_ratio,
   MILEAGE_REF_KM_YEAR за паливом). Цей файл лише описує, як це співвідношення
   малювати на шкалі. Калібрувати шкалу треба тут, без змін UI.

   Межі смуг задані ЧАСТКАМИ референсу класу (usage_ratio), тому шкала сама
   стає ширшою для дизеля і вужчою для бензину:
     - low_max і normal_max збігаються з порогами, якими вісь Пробіг уже
       позначає low_annual_usage і high_annual_usage (тест стереже збіг);
     - high_max і upper_ratio лише презентаційні: де починається червона
       зона і де закінчується шкала. Бал вони не змінюють. */
(function () {
  var SCALE = {
    low_max: 0.6,      /* нижче: спокійна експлуатація */
    normal_max: 1.25,  /* до цього: звичайний діапазон класу */
    high_max: 2.0,     /* до цього: підвищена, далі дуже висока */
    upper_ratio: 3.0,  /* права межа шкали, підпис із "+" */
    upper_round_km: 500
  };

  /* Із збереженої осі Пробіг звіту. Бракує пробігу, віку чи референсу:
     null, і інтерфейс метрику не показує (значення не вигадуємо). */
  function fromDimension(dim) {
    if (!dim || dim.score_available !== true) return null;
    var annual = dim.annual_mileage_km, ref = dim.reference_km_year;
    if (typeof annual !== 'number' || !isFinite(annual) || annual < 0) return null;
    if (typeof ref !== 'number' || !isFinite(ref) || ref <= 0) return null;
    var refMonth = ref / 12;
    var upper = Math.round(refMonth * SCALE.upper_ratio / SCALE.upper_round_km) * SCALE.upper_round_km;
    if (!(upper > 0)) return null;
    var monthly = Math.round(annual / 12 / 50) * 50;
    /* норма класу: той самий референс осі, лише в км/міс і з тим самим
       округленням до 50, що й значення зверху */
    var norm = Math.round(refMonth / 50) * 50;
    /* шкала ЛІНІЙНА в км/міс від 0 до правої межі: позиція = значення / межа.
       Значення понад межу притискається до правого краю, число зверху лишається справжнім */
    var pct = function (km) { return Math.max(0, Math.min(100, km / upper * 100)); };
    return {
      /* те саме округлення до 50, що вже було в картці */
      monthly_km: monthly,
      odometer_km: typeof dim.current_odometer_km === 'number' ? dim.current_odometer_km : null,
      upper_km: upper,
      norm_km: norm,
      norm_pct: pct(norm),
      marker_pct: pct(monthly),
      bands: {
        low_end_pct: pct(refMonth * SCALE.low_max),
        normal_end_pct: pct(refMonth * SCALE.normal_max),
        high_end_pct: pct(refMonth * SCALE.high_max)
      },
      powertrain_class: dim.powertrain_class || 'unknown'
    };
  }

  window.CalCarMileageIntensity = { SCALE: SCALE, fromDimension: fromDimension };
})();
