/* CalCar: цінність опції для показу, коли каталог Model Intelligence ще
   мовчить.

   Порядок рішення такий:
     1. каталог MI по ЦЬОМУ авто (item.mi.value_tier при confirmed) головний
        і в обидва боки: сказав high_value, значить high_value; сказав, що
        опція звичайна, запасний список її НЕ піднімає;
     2. якщо каталог опцію не покриває, працює цей невеликий детермінований
        список очевидно дорогого обладнання;
     3. інакше опція звичайна.

   Список свідомо вузький і брендонезалежний: сюди входить те, що дорого
   коштує саме як заводська опція і однозначно впізнається за назвою.
   Підігрів сидінь, CarPlay, парктроніки, круїз, безключовий доступ і
   звичайна навігація НЕ дорогі: підсвічувати все підряд означає не
   підсвічувати нічого. Моделеспецифічних правил тут немає.

   Це тимчасова опора, а не заміна MI: щойно каталог покриє опцію, рішення
   переходить до нього. */
(function () {
  /* \w у JS не матчить кирилицю, тому всі "хвости" слів це явні класи літер */
  var L = '[а-яіїєґёa-z]*';
  var rx = function (src) { return new RegExp(src.replace(/~/g, L), 'i'); };
  var CONCEPTS = [
    /* підвіска і шасі */
    { key: 'air_suspension', re: rx('пневмопідвіск~|пневмоподвеск~|пневматичн~\\s+підвіск~|пневматическ~\\s+подвеск~|air\\s*suspension|airmatic|air\\s*matic|luftfederung') },
    { key: 'adaptive_suspension', re: rx('адаптивн~\\s+(?:підвіск~|подвеск~)|магнітн~\\s+підвіск~|магнитн~\\s+подвеск~|adaptive\\s*(?:suspension|damp~)|magnetic\\s*ride|dynamic\\s*drive|electronic\\s*damper') },
    { key: 'rear_axle_steering', re: rx('підрульов~\\s+задн~|подрулива~\\s+задн~|керован~\\s+задн~\\s+(?:вісь|ось)|управляем~\\s+задн~\\s+ось|rear[\\s-]*(?:axle|wheel)\\s*steering|integral\\s*(?:active\\s*)?steer~|4\\s*wheel\\s*steering|\\b4ws\\b') },
    { key: 'ceramic_brakes', re: rx('керамічн~\\s+гальм~|керамическ~\\s+тормоз~|carbon[\\s-]*ceramic|ceramic\\s*brake~') },
    /* огляд і світло */
    { key: 'night_vision', re: rx('нічн~\\s+бачення|ночно~\\s+видени~|night\\s*(?:vision|view)') },
    { key: 'surround_view', re: rx('камер~\\s*(?:кругового|360)|огляд\\s*360|обзор\\s*360|360[\\s°]*(?:камер~|view)|surround\\s*view|bird\'?s?[\\s-]*eye') },
    { key: 'advanced_headlights', re: rx('матричн~\\s+(?:фар~|світл~|свет~)|лазерн~\\s+(?:фар~|світл~|свет~)|matrix\\s*(?:led|light|beam)|laser\\s*(?:light|beam|headl~)|digital\\s*light|multibeam|intellilux') },
    { key: 'head_up_display', re: rx('проєкційн~\\s+дисплей|проекционн~\\s+дисплей|проекц~\\s+(?:на\\s+)?лобов~|head[\\s-]*up\\s*display|\\bhud\\b') },
    /* салон */
    { key: 'massage_seats', re: rx('масаж~\\s+(?:сидін~|сидень|крісел)|массаж~\\s+(?:сиден~|кресел)|massage\\s*seat~') },
    { key: 'ventilated_seats', re: rx('вентил~\\s+(?:сидін~|сидень|крісел)|вентил~\\s+(?:сиден~|кресел)|ventilated\\s*seat~|cooled\\s*seat~') },
    { key: 'executive_rear', re: rx('executive\\s*(?:package|seat~|lounge)|задн~\\s+(?:сидін~|сиден~)\\s+executive|lounge\\s*(?:package|seat~)|rear\\s*seat\\s*entertainment|розважальн~\\s+систем~\\s+ззаду') },
    { key: 'soft_close_doors', re: rx('доводчик~\\s+двер~|доводчик~$|soft[\\s-]*close') },
    /* заводське аудіо преміальних марок */
    { key: 'premium_audio', re: rx('burmester|bowers\\s*(?:&|and)?\\s*wilkins|\\bb\\s*&\\s*w\\b|bang\\s*(?:&|and)?\\s*olufsen|\\bb\\s*&\\s*o\\b|mark\\s*levinson|meridian|\\bnaim\\b|\\brevel\\b|\\blexicon\\b|dynaudio') },
  ];
  /* явно звичайні опції: захист від випадкового збігу */
  var ORDINARY = rx('carplay|android\\s*auto|підігрів|подогрев|heated\\s*seat~|парктронік~|парктроник~|parking\\s*sensor~|круїз|круиз|cruise\\s*control|безключ~|keyless|навігац~|навигац~|navigation|клімат|климат|climate');
  var STRONG = rx('пневмо~|air\\s*suspension|airmatic|масаж~|массаж~|massage|вентил~|ventilat~|cooled|матричн~|лазерн~|matrix|laser|ceramic|керамічн~|керамическ~|night\\s*(?:vision|view)|нічн~\\s+бачення|ночно~\\s+видени~|360|surround|head[\\s-]*up|\\bhud\\b|executive|доводчик~|soft[\\s-]*close|rear[\\s-]*(?:axle|wheel)\\s*steering|підрульов~|подрулива~|burmester|olufsen|levinson|meridian|wilkins');

  function conceptFor(name) {
    var s = String(name == null ? '' : name);
    if (!s.trim()) return null;
    for (var i = 0; i < CONCEPTS.length; i++) {
      if (CONCEPTS[i].re.test(s)) {
        /* назва згадує і дорогу, і звичайну опцію: вирішує дорога, але лише
           коли вона не єдине слово в переліку звичайних */
        if (CONCEPTS[i].key === 'ventilated_seats' && /підігрів|подогрев|heated/i.test(s) && !/вентил|ventilat|cooled/i.test(s)) return null;
        return CONCEPTS[i].key;
      }
    }
    return null;
  }

  /* очевидно дорога опція за назвою, без каталогу і без моделі */
  function genericHighValue(name) {
    var s2 = String(name == null ? '' : name);
    var concept = conceptFor(s2);
    if (!concept) return false;
    /* у назві є і дороге, і звичайне: лишаємо дороге лише за явною ознакою */
    if (ORDINARY.test(s2) && !STRONG.test(s2)) return false;
    return true;
  }

  /* підсумкова цінність пункту комплектації звіту */
  function isHighValue(item) {
    if (!item || typeof item !== 'object') return false;
    var mi = item.mi;
    /* каталог MI по цьому авто головний в обидва боки */
    if (mi && mi.confirmed === true && mi.value_tier) return mi.value_tier === 'high_value';
    if (item.value_tier === 'high_value') return true;
    return genericHighValue(item.name);
  }

  window.CalCarEquipmentValue = { isHighValue: isHighValue, genericHighValue: genericHighValue, conceptFor: conceptFor, CONCEPTS: CONCEPTS };
})();
