/* CalCar: премиум-опції в картці "Комплектація".

   Премиум тут означає високий клас обладнання, яке помітно вирізняє
   машину (Burmester, камери 360, масаж і вентиляція сидінь, пневмопідвіска,
   автоматичне паркування...), а НЕ "платна заводська опція": на
   Maybach частина цього стандартна, але лишається премиум-обладнанням.

   Рішення детерміноване і залежить ЛИШЕ від назви обладнання:
     назва -> поняття таксономії нижче -> премиум так чи ні.
   Одна й та сама річ класифікується однаково на будь-якій машині; марка
   авто нічого не вирішує. value_tier від моделі і позначка каталогу MI
   лишаються в даних звіту як метадані, але підсвітку не визначають.

   Що саме ВСТАНОВЛЕНО на авто, вирішує не цей файл, а правила доказів
   звіту (VIN, фото, дані оголошення, продавець): доступне на моделі
   встановленим не стає.

   Звичайне обладнання (памʼять сидінь і дзеркал, підігрів, CarPlay,
   парктроніки, звичайний круїз, безключовий доступ, навігація,
   клімат, камера заднього виду, панорамний дах, контурне підсвічування)
   премиумом не вважається: підсвічувати все підряд означає не підсвічувати
   нічого. Ліміту кількості немає: скільки премиум-обладнання підтверджено,
   стільки і підсвічується. */
(function () {
  /* \w у JS не матчить кирилицю, тому всі "хвости" слів це явні класи літер */
  var L = '[а-яіїєґёa-z]*';
  var rx = function (src) { return new RegExp(src.replace(/~/g, L), 'i'); };
  var CONCEPTS = [
    /* паркування і огляд */
    { key: 'automatic_parking', re: rx('автоматичн~\\s+(?:паркув~|паркован~|парковк~)|автоматическ~\\s+(?:парковк~|паркован~)|автопарков~|асистент~\\s+(?:автоматичн~\\s+)?паркув~|ассистент~\\s+(?:автоматическ~\\s+)?(?:парковк~|паркован~)|парковочн~\\s+(?:ассистент~|пилот~)|паркувальн~\\s+(?:асистент~|пілот~)|parking\\s*assist~|park\\s*assist~|park\\s*pilot|remote\\s*(?:smart\\s*)?park~|self[\\s-]*park~|active\\s*park~|intelligent\\s*park~'),
      not: /датчик|sensor|парктрон/i, unless: /автомат|automatic|remote|дистанц|self|pilot|пілот|пилот|plus|assistant|асистент|ассистент/i },
    { key: 'surround_view', re: rx('камер~\\s*(?:кругового|360)|кругов~\\s+(?:огляд~|обзор~)|огляд\\s*360|обзор\\s*360|360[\\s°]*(?:камер~|view|огляд~|обзор~)|3d[\\s-]*(?:view|камер~|огляд~|обзор~)|surround\\s*view|bird\'?s?[\\s-]*eye|around\\s*view') },
    /* адаптивний круїз із радарним контролем дистанції; звичайний круїз ні */
    { key: 'adaptive_cruise', re: rx('адаптивн~\\s+(?:круїз~|круиз~)|(?:круїз~|круиз~)[\\s-]*(?:контрол~\\s+)?(?:з\\s+|с\\s+)?(?:адаптивн~|активн~|радар~|stop\\s*(?:&|and|-|\\s)\\s*go)|(?:радарн~|активн~|інтелектуальн~|интеллектуальн~)\\s+(?:круїз~|круиз~)|дистронік~|дистроник~|distronic|adaptive\\s*cruise|\\bacc\\b|(?:active|dynamic\\s*radar|radar|intelligent|smart|adaptive)\\s*cruise|cruise[\\s-]*control\\s+(?:with\\s+)?stop\\s*(?:&|and|-)\\s*go') },
    { key: 'night_vision', re: rx('нічн~\\s+бачення|ночно~\\s+видени~|night\\s*(?:vision|view)') },
    /* дисплеї */
    { key: 'head_up_display', re: rx('проєкційн~\\s+дисплей|проекційн~\\s+дисплей|проекционн~\\s+дисплей|проекц~\\s+(?:на\\s+)?лобов~|head[\\s-]*up|\\bhud\\b') },
    { key: 'rear_entertainment', re: rx('(?:екран~|экран~|дисплей~|монітор~|монитор~)[^,;]{0,20}(?:задн~\\s+пас+аж~|для\\s+пас+аж~|задн~\\s+ряд~)|задн~\\s+(?:екран~|экран~|дисплей~|монітор~|монитор~)|розважальн~|развлекательн~|rear[\\s-]*seat\\s*(?:entertainment|screen~|display~)|rear\\s*(?:entertainment|screen~|display~)') },
    /* акустика преміальних марок: бренд обовʼязковий */
    { key: 'premium_audio', re: rx('harman|kardon|\\bbose\\b|\\bjbl\\b|burmester|bowers\\s*(?:&|and)?\\s*wilkins|\\bb\\s*&\\s*w\\b|bang\\s*(?:&|and)?\\s*olufsen|\\bb\\s*&\\s*o\\b|mark\\s*levinson|meridian|\\bnaim\\b|\\brevel\\b|\\blexicon\\b|dynaudio|\\bfocal\\b|sonus\\s*faber|\\bkrell\\b') },
    /* сидіння і салон */
    { key: 'massage_seats', re: rx('масаж~|массаж~|massage') },
    { key: 'ventilated_seats', re: rx('вентил~\\s+(?:сидін~|сидень|сидіння|крісел|передн~|задн~)|вентил~\\s+(?:сиден~|кресел|передн~|задн~)|вентиляц~\\s+(?:сидін~|сиден~|крісел|кресел)|ventilated\\s*seat~|cooled\\s*seat~|seat\\s*ventilation') },
    { key: 'multicontour_seats', re: rx('мультиконтур~|multi[\\s-]*contour') },
    { key: 'neck_heating', re: rx('air\\s*scarf|airscarf|(?:обігрів~|підігрів~)\\s+(?:ділянк~\\s+)?ши[її]|(?:обогрев~|подогрев~)\\s+(?:област~\\s+)?шеи|neck\\s*(?:level\\s*)?heat~') },
    { key: 'executive_rear', re: rx('executive|chauffeur|шофер~|бізнес[\\s-]*клас~|бизнес[\\s-]*класс~|first[\\s-]*class|lounge\\s*(?:package|seat~)|reclin~|реклайнер~|окрем~\\s+задн~\\s+(?:крісл~|сидін~)|раздельн~\\s+задн~\\s+(?:кресл~|сиден~)|індивідуальн~\\s+задн~\\s+(?:крісл~|сидін~)|индивидуальн~\\s+задн~\\s+(?:кресл~|сиден~)|individual\\s*rear\\s*seat~|задн~\\s+(?:крісл~|кресл~)\\s+(?:з|с)\\s+(?:центральн~\\s+)?консол~|(?:підставк~|подставк~)\\s+для\\s+(?:ніг|ног)|calf\\s*rest') },
    { key: 'refrigerator', re: rx('холодильник~|fridge|refrigerat~|охолоджуван~\\s+(?:бокс~|відсік~|підлокітник~)|охлаждаем~\\s+(?:бокс~|отсек~|подлокотник~)|cool(?:ing)?\\s*box') },
    { key: 'comfort_doors', re: rx('доводчик~|soft[\\s-]*close|електропривод~\\s+(?:задн~\\s+)?двер~|электропривод~\\s+(?:задн~\\s+)?двер~|power(?:ed)?\\s*(?:rear\\s*)?doors|electric(?:ally\\s*operated)?\\s*(?:rear\\s*)?doors|комфортн~\\s+(?:задн~\\s+)?двер~'),
      not: /багажник|tailgate|liftgate|trunk|кришк|крышк|ляд/i },
    /* підвіска і шасі */
    { key: 'air_suspension', re: rx('пневмопідвіск~|пневмоподвеск~|пневматичн~\\s+підвіск~|пневматическ~\\s+подвеск~|air\\s*suspension|airmatic|air\\s*matic|air\\s*body\\s*control|luftfederung') },
    { key: 'active_suspension', re: rx('активн~\\s+(?:підвіск~|подвеск~|стабілізатор~|стабилизатор~)|active\\s*body\\s*control|e-?active|magic\\s*body\\s*control|active\\s*suspension|active\\s*(?:anti[\\s-]*)?roll|anti[\\s-]*roll\\s*(?:control|system)|dynamic\\s*drive|executive\\s*drive|predictive\\s*(?:active\\s*)?suspension') },
    { key: 'adaptive_suspension', re: rx('адаптивн~\\s+(?:підвіск~|подвеск~)|магнітн~\\s+підвіск~|магнитн~\\s+подвеск~|adaptive\\s*(?:suspension|damp~)|magnetic\\s*ride|electronic\\s*damper') },
    { key: 'rear_axle_steering', re: rx('підрульов~\\s+задн~|подрулива~\\s+задн~|керован~\\s+задн~\\s+(?:вісь|ось|колес~)|управляем~\\s+задн~\\s+(?:ось|колес~)|повноповорот~|полноуправляем~|rear[\\s-]*(?:axle|wheel)\\s*steer~|integral\\s*(?:active\\s*)?steer~|4\\s*wheel\\s*steering|\\b4ws\\b') },
    { key: 'ceramic_brakes', re: rx('керамічн~\\s+гальм~|керамическ~\\s+тормоз~|carbon[\\s-]*ceramic|ceramic\\s*brake~') },
    /* світло вище звичайних фар */
    { key: 'advanced_headlights', re: rx('матричн~\\s+(?:фар~|світл~|свет~|оптик~)|лазерн~\\s+(?:фар~|світл~|свет~|оптик~)|піксел~|пиксел~|цифров~\\s+(?:фар~|світл~|свет~)|matrix\\s*(?:led|light|beam)|hd\\s*matrix|laser\\s*(?:light|beam|headl~)|digital\\s*light|pixel|multibeam|intellilux') },
  ];

  /* поняття таксономії за назвою; null, коли це звичайне обладнання */
  function conceptFor(name) {
    var s = String(name == null ? '' : name);
    if (!s.trim()) return null;
    for (var i = 0; i < CONCEPTS.length; i++) {
      var c = CONCEPTS[i];
      if (!c.re.test(s)) continue;
      if (c.not && c.not.test(s) && !(c.unless && c.unless.test(s))) continue;
      return c.key;
    }
    return null;
  }

  function genericHighValue(name) { return conceptFor(name) !== null; }

  /* підсумок для пункту комплектації звіту: лише назва вирішує */
  function premiumConcept(item) {
    if (!item || typeof item !== 'object') return null;
    return conceptFor(item.name);
  }
  function isHighValue(item) { return premiumConcept(item) !== null; }

  window.CalCarEquipmentValue = { isHighValue: isHighValue, premiumConcept: premiumConcept, genericHighValue: genericHighValue, conceptFor: conceptFor, CONCEPTS: CONCEPTS };
})();
