// Каталог магазина PongHub: бренды-отсылки, предметы, цены, варианты (цвет / форма ручки).
// Цены дублируются в базе (shop_items) — менять в обоих местах (supabase/migration-015-shop.sql).
// ───────────── Бренды-отсылки ─────────────
const BRANDS = {
  Butterfly: { name: 'Flutterby', color: '#d62839', mark: 'wings' },
  Donic: { name: 'Tonic', color: '#1f5fc4', mark: 'swoosh' },
  Stiga: { name: 'Stryga', color: '#0e3b8c', mark: 'chevron' },
  Tibhar: { name: 'Tigbar', color: '#e8590c', mark: 'stripes' },
  Andro: { name: 'Androme', color: '#2b2f36', mark: 'ring' },
  Yasaka: { name: 'Yamasaka', color: '#c1121f', mark: 'sun' },
  Nittaku: { name: 'Nittoku', color: '#0b7a47', mark: 'stars' },
  Victas: { name: 'Viktus', color: '#6a1b9a', mark: 'chevron' },
  DHS: { name: 'HDS', color: '#d62839', mark: 'box' },
  Yinhe: { name: 'Yinhai', color: '#1f5fc4', mark: 'stars' },
  Sanwei: { name: 'Sanwu', color: '#e8590c', mark: 'tri' },
  '729': { name: '792', color: '#16181d', mark: 'box' },
  'Li-Ning': { name: 'Li-Ming', color: '#d62839', mark: 'swoosh' },
  Mizuno: { name: 'Mizumo', color: '#1f5fc4', mark: 'wave' },
};
const brandName = bk => BRANDS[bk]?.name || bk;

// ───────────── Каталог ─────────────
const RG = { cn: 'Китай', eu: 'Европа', jp: 'Япония', acc: 'Аксессуары', wear: 'Форма', rw: 'Награды' };
const RGSUB = { cn: 'Липкие накладки и мощный накат', eu: 'Германия и Швеция: тензоры и контроль', jp: 'Легенды японских мастеров', acc: 'Обмотки, лента, мячи, чехлы', wear: 'Футболки, шорты, кроссовки', rw: 'Бесплатно за достижения' };
const C = (key, name, hex, extra = 0) => ({ key, name, hex, extra });
const RUBBER_COLORS = [C('red', 'красная', '#d62839'), C('black', 'чёрная', '#18191d'), C('blue', 'синяя', '#1f5fc4', 60)];
// s: скорость, w: вращение, c: контроль (из 10)
const B = (id, region, bk, name, orig, price, real, style, s, w, c, layers, material, desc, look) => ({ id, region, type: 'blade', bk, name, orig, price, real, style, s, w, c, layers, material, desc, look });
const R = (id, region, bk, name, orig, price, real, style, s, w, c, rubber, sponge, sp, desc) => ({ id, region, type: 'rubber', bk, name, orig, price, real, style, s, w, c, rubber, sponge, sp, desc, colors: RUBBER_COLORS });
const ITEMS = [
  B('cn-b1', 'cn', 'Sanwei', 'Flextra 7', 'Sanwei Fextra 7', 1200, '≈ 2 000 ₽', 'uni', 6, 7, 9, '7 слоёв', 'дерево', 'Надёжная первая ракетка: прощает ошибки и учит чувствовать мяч.', { face: '#e6bd84', cheek: '#d9b07a', ply: ['#e6bd84', '#c48d4c', '#f1d3a1'] }),
  B('cn-b2', 'cn', 'Yinhe', 'T-12+', 'Yinhe T-11+', 1550, '≈ 2 800 ₽', 'uni', 6.5, 7.5, 9, '5 слоёв', 'лимба', 'Мягкий удар, отличный контроль для подрезки и первого наката.', { face: '#ecc58c', cheek: '#7a4b2a', ply: ['#ecc58c', '#d9a865', '#f6dcae'] }),
  B('cn-b3', 'cn', 'DHS', 'Force G7', 'DHS Power G7', 1950, '≈ 4 000 ₽', 'atk', 7.5, 8, 8, '7 слоёв', 'дерево', 'Жёстче и быстрее — для уверенного наката с обеих сторон.', { face: '#dcab6e', cheek: '#2a2420', ply: ['#dcab6e', '#b8803f', '#ecc890'] }),
  B('cn-b4', 'cn', 'Yinhe', 'Y-31', 'Yinhe Y-13', 2750, '≈ 5 500 ₽', 'atk', 8.5, 8, 7, '5+2 карбон', 'карбон', 'Два слоя карбона добавляют скорость, но требуют техники.', { face: '#d6a468', cheek: '#1d1d1f', ply: ['#d6a468', '#1a1a1a', '#ecc890'] }),
  B('cn-b5', 'cn', 'DHS', 'Typhoon Long 5', 'DHS Hurricane Long 5', 3950, '≈ 14 000 ₽', 'top', 9, 9, 7.5, '5+2 арилат-карбон', 'карбон', 'Основание чемпионов сборной Китая: мощь и вращение.', { face: '#cf9c5f', cheek: '#d6ad78', ply: ['#cf9c5f', '#2a2a2a', '#e8c088'] }),
  R('cn-r1', 'cn', '729', 'Focal III', '729 Focus III', 600, '≈ 1 300 ₽', 'uni', 6, 8, 8, 'липкая', '2.0 мм', '#f2c14e', 'Классическая липкая накладка: вращение и контроль за небольшие деньги.'),
  R('cn-r2', 'cn', 'Yinhe', 'Mercurio II', 'Yinhe Mercury II', 650, '≈ 1 500 ₽', 'atk', 7, 8.5, 7.5, 'липкая', '2.1 мм', '#f0a64a', 'Чуть быстрее и мягче — удобна для наката с отскока.'),
  R('cn-r3', 'cn', 'Yinhe', '959 · длинные шипы', 'Yinhe 955', 750, '≈ 1 400 ₽', 'def', 3, 6, 8.5, 'длинные шипы', '0.5 мм', '#f2c14e', 'Путает соперника: возвращает его же вращение. Для защиты.'),
  R('cn-r4', 'cn', 'Sanwei', 'Target Nation', 'Sanwei Target National', 950, '≈ 3 000 ₽', 'atk', 8, 8.5, 7.5, 'полулипкая', '2.15 мм', '#ef8a3c', 'Губка для атаки с хорошим «зацепом» мяча.'),
  R('cn-r5', 'cn', 'DHS', 'Typhoon 3 Neo', 'DHS Hurricane 3 Neo', 1300, '≈ 4 500 ₽', 'top', 8.5, 10, 7.5, 'липкая «нео»', '2.15 мм', '#e9772f', 'Легенда Китая: максимальное вращение и тяжёлый накат.'),

  B('eu-b1', 'eu', 'Stiga', 'Allround Klassik', 'Stiga Allround Classic', 1650, '≈ 4 000 ₽', 'uni', 6, 7, 9.5, '5 слоёв', 'дерево', 'Шведская классика с 1960-х: чувство мяча и контроль.', { face: '#e8c088', cheek: '#dcb27c', ply: ['#e8c088', '#d4a062', '#f3d8a8'] }),
  B('eu-b2', 'eu', 'Donic', 'Waldorf Sense V1', 'Donic Waldner Senso V1', 2200, '≈ 6 000 ₽', 'uni', 6.5, 7.5, 9, '5 слоёв + Sense', 'дерево', 'Вставки в ручке гасят вибрацию — удобный универсал.', { face: '#dfb47c', cheek: '#1b1d22', ply: ['#dfb47c', '#c99858', '#efd09c'] }),
  B('eu-b3', 'eu', 'Tibhar', 'Stratos Power Wood', 'Tibhar Stratus Power Wood', 3000, '≈ 8 500 ₽', 'atk', 8, 8, 8, '7 слоёв', 'дерево', 'Мощное основание без карбона — для любителей дерева.', { face: '#d6a468', cheek: '#232325', ply: ['#d6a468', '#b9813f', '#e9c48d'] }),
  B('eu-b4', 'eu', 'Andro', 'Treiber KO', 'Andro Treiber CO', 4150, '≈ 11 000 ₽', 'atk', 8.5, 8, 7.5, '5+2 карбон', 'карбон', 'Carbon Offensive: быстрое, но послушное основание.', { face: '#d19f62', cheek: '#1c2230', ply: ['#d19f62', '#1f1f1f', '#e6c088'] }),
  B('eu-b5', 'eu', 'Stiga', 'Hexashape Carbon', 'Stiga Cybershape Carbon', 6000, '≈ 25 000 ₽', 'top', 9.5, 9, 7.5, '5+2 карбон', 'карбон', 'Шестиугольная голова: больше «сладкая точка». Самое необычное основание.', { face: '#cb985c', cheek: '#151517', ply: ['#cb985c', '#1d1d1d', '#e2bb82'], hex: true }),
  R('eu-r1', 'eu', 'Donic', 'Coppo X1 Gold', 'Donic Coppa X1 Gold', 750, '≈ 3 000 ₽', 'uni', 7, 7.5, 8.5, 'классическая', '2.0 мм', '#f4d35e', 'Мягкая и предсказуемая — для стабильной игры.'),
  R('eu-r2', 'eu', 'Tibhar', 'Grazz D.Tex · шипы', 'Tibhar Grass D.TecS', 850, '≈ 3 800 ₽', 'def', 3, 6, 8.5, 'длинные шипы', 'OX', null, 'Самые «злые» шипы Европы: мяч летит непредсказуемо.'),
  R('eu-r3', 'eu', 'Donic', 'Bluflame M1', 'Donic Bluefire M1', 1050, '≈ 5 000 ₽', 'atk', 9, 9, 7, 'тензор', '2.0 мм', '#4da3ff', 'Жёсткий тензор: сильный удар и вращение.'),
  R('eu-r4', 'eu', 'Andro', 'Rasant R47', 'Andro Rasanter R47', 1200, '≈ 5 500 ₽', 'atk', 8.5, 9, 8, 'тензор', '2.1 мм', '#ffd23f', 'Баланс атаки и контроля — одна из самых популярных.'),
  R('eu-r5', 'eu', 'Tibhar', 'Evolver MX-P', 'Tibhar Evolution MX-P', 1450, '≈ 6 000 ₽', 'top', 9.5, 9.5, 7, 'тензор', 'max', '#ffb627', 'Топ Европы для атакующих: скорость и «выстрел».'),

  B('jp-b1', 'jp', 'Yasaka', 'Sweden Xtra', 'Yasaka Sweden Extra', 1900, '≈ 4 500 ₽', 'uni', 6, 7, 9.5, '5 слоёв', 'дерево', 'Мягкое и лёгкое: идеально для контроля и подрезки.', { face: '#efcb95', cheek: '#e2bd88', ply: ['#efcb95', '#ddb175', '#f7e0b6'] }),
  B('jp-b2', 'jp', 'Yasaka', 'Dragon Extra Offensive', 'Yasaka Ma Lin Extra Offensive', 2450, '≈ 5 500 ₽', 'atk', 7.5, 8, 8.5, '5 слоёв', 'дерево', 'Основание для нападения у стола, любимое у азиатских атакующих.', { face: '#e4b67c', cheek: '#b8824e', ply: ['#e4b67c', '#cf9c5c', '#f1d3a1'] }),
  B('jp-b3', 'jp', 'Butterfly', 'Korbell', 'Butterfly Korbel', 3300, '≈ 9 000 ₽', 'atk', 8, 8.5, 8.5, '5 слоёв', 'дерево', 'Легенда: «как продолжение руки».', { face: '#ddb077', cheek: '#dcb684', ply: ['#ddb077', '#c79656', '#eccb95'] }),
  B('jp-b4', 'jp', 'Butterfly', 'Innerpower Layer ALC', 'Butterfly Innerforce Layer ALC', 6200, '≈ 20 000 ₽', 'atk', 8.5, 9, 8.5, '5+2 ALC внутри', 'ALC', 'Карбон спрятан ближе к центру: мощь с ощущением дерева.', { face: '#d9ab70', cheek: '#d9b27e', ply: ['#d9ab70', '#c9b27a', '#eac792'] }),
  B('jp-b5', 'jp', 'Butterfly', 'Titan ZLC', 'Butterfly Timo Boll ZLC', 9200, '≈ 32 000 ₽', 'top', 9.5, 9.5, 8, '5+2 ZL-карбон', 'ZLC', 'Вершина каталога: основание чемпионов.', { face: '#d4a468', cheek: '#3a2a1e', ply: ['#d4a468', '#8a8f99', '#e7c38c'] }),
  R('jp-r1', 'jp', 'Yasaka', 'Marc V', 'Yasaka Mark V', 900, '≈ 3 000 ₽', 'uni', 7, 7.5, 9, 'классическая', '2.0 мм', '#f6e27a', 'Самая продаваемая накладка в истории — стабильность.'),
  R('jp-r2', 'jp', 'Butterfly', 'Shriver', 'Butterfly Sriver', 1000, '≈ 3 500 ₽', 'uni', 7, 7.5, 9.5, 'классическая', '1.9 мм', '#f8d77a', 'Эталон контроля, на ней учились поколения игроков.'),
  R('jp-r3', 'jp', 'Victas', 'Kurl P1V · шипы', 'Victas Curl P1V', 950, '≈ 3 200 ₽', 'def', 3, 6.5, 9, 'длинные шипы', 'OX', null, 'Мягкие шипы для защитников у стола.'),
  R('jp-r4', 'jp', 'Butterfly', 'Rosetta', 'Butterfly Rozena', 1450, '≈ 5 500 ₽', 'atk', 8.5, 8.5, 8.5, 'тензор', '2.1 мм', '#ffc94d', 'Быстрая, но послушная — шаг к профессиональным накладкам.'),
  R('jp-r5', 'jp', 'Butterfly', 'Dignix 09C', 'Butterfly Dignics 09C', 2000, '≈ 9 000 ₽', 'top', 9.5, 10, 8.5, 'полулипкий тензор', '2.1 мм', '#ffb000', 'Накладка чемпионов: липкость Китая и скорость Японии.'),

  // аксессуары — у каждого свои цвета
  { id: 'acc-g1', region: 'acc', type: 'grip', bk: 'Yinhe', name: 'Махровая обмотка', orig: 'Yinhe Towel Grip', price: 180, real: '≈ 300 ₽', style: 'uni', desc: 'Мягкая махровая обмотка: рука не скользит даже в жару.', colors: [C('blue', 'синяя', '#2563b8'), C('white', 'белая', '#f2f4f8'), C('red', 'красная', '#d62839')] },
  { id: 'acc-g2', region: 'acc', type: 'grip', bk: 'Butterfly', name: 'Grip Tape', orig: 'Butterfly Grip Tape', price: 250, real: '≈ 600 ₽', style: 'uni', desc: 'Тонкая липкая лента на ручку.', colors: [C('black', 'чёрная', '#1b1c20'), C('red', 'красная', '#d62839'), C('mint', 'мятная', '#3ccfa8'), C('pink', 'розовая', '#ff6fa7')] },
  { id: 'acc-g3', region: 'acc', type: 'grip', bk: 'Stiga', name: 'Кожаная обмотка', orig: 'Stiga Leather Grip', price: 400, real: '≈ 900 ₽', style: 'top', desc: 'Премиальная кожа с прострочкой.', colors: [C('brown', 'коричневая', '#6b4226'), C('black', 'чёрная', '#222'), C('gold', 'золотая', '#c9a227', 150)] },
  { id: 'acc-t1', region: 'acc', type: 'tape', bk: 'Donic', name: 'Торцевая лента', orig: 'Donic Edge Tape', price: 150, real: '≈ 400 ₽', style: 'uni', desc: 'Защищает край основания от ударов о стол.', colors: [C('black', 'чёрная', '#1b1c20'), C('blue', 'синяя', '#1f5fc4'), C('red', 'красная', '#d62839'), C('silver', 'серебряная', '#c3c8d0', 50)] },
  { id: 'acc-b1', region: 'acc', type: 'ball', bk: 'Donic', name: 'Мячи Training ×6', orig: 'Donic Training', price: 180, real: '≈ 350 ₽', style: 'uni', desc: 'Тренировочные мячи — для отработки ударов.', stars: 1, colors: [C('white', 'белые', '#f5f5f5'), C('orange', 'оранжевые', '#ff8a1f')] },
  { id: 'acc-b2', region: 'acc', type: 'ball', bk: 'DHS', name: 'Мячи D40+ ★★★ ×3', orig: 'DHS D40+ 3 Star', price: 250, real: '≈ 450 ₽', style: 'uni', desc: 'Официальные мячи турниров в Китае.', stars: 3, colors: [C('white', 'белые', '#f5f5f5')] },
  { id: 'acc-b3', region: 'acc', type: 'ball', bk: 'Nittaku', name: 'Мячи Premium 40+ ×3', orig: 'Nittaku Premium 40+', price: 400, real: '≈ 900 ₽', style: 'top', desc: 'Японские мячи высшего класса, лучший отскок.', stars: 3, colors: [C('white', 'белые', '#f5f5f5')] },
  { id: 'acc-c1', region: 'acc', type: 'case', bk: 'Stiga', name: 'Чехол для ракетки', orig: 'Stiga Cover', price: 450, real: '≈ 1 000 ₽', style: 'uni', desc: 'Мягкий чехол с отделением для мячей.', colors: [C('navy', 'синий', '#14306b'), C('black', 'чёрный', '#1b1c20'), C('red', 'красный', '#b8212f')] },
  { id: 'acc-c2', region: 'acc', type: 'case', bk: 'Butterfly', name: 'Жёсткий кейс', orig: 'Butterfly Hard Case', price: 1050, real: '≈ 3 000 ₽', style: 'top', desc: 'Кейс, который защитит ракетку в дороге.', colors: [C('black', 'чёрный', '#1b1c20'), C('white', 'белый', '#eef1f6'), C('carbon', 'карбон', '#33363d', 200)] },

  // форма: чем круче бренд — тем дороже; лимитированные цвета — дороже
  { id: 'wr-t1', region: 'wear', type: 'shirt', bk: 'Sanwei', name: 'Футболка Basic', orig: 'Sanwei', price: 900, real: '≈ 1 800 ₽', style: 'uni', desc: 'Простая и удобная, для каждой игры.', colors: [C('white', 'белая', '#f4f6fa'), C('black', 'чёрная', '#1b1c20'), C('red', 'красная', '#d62839')] },
  { id: 'wr-t2', region: 'wear', type: 'shirt', bk: 'Yinhe', name: 'Футболка Pro', orig: 'Yinhe', price: 1100, real: '≈ 2 500 ₽', style: 'uni', desc: 'Лёгкая сетка на спине — не жарко.', colors: [C('blue', 'синяя', '#1f5fc4'), C('red', 'красная', '#d62839'), C('black', 'чёрная', '#1b1c20')] },
  { id: 'wr-t3', region: 'wear', type: 'shirt', bk: 'Donic', name: 'Футболка Team', orig: 'Donic', price: 1350, real: '≈ 3 500 ₽', style: 'atk', desc: 'Командная футболка с яркими вставками.', colors: [C('blue', 'синяя', '#1f5fc4'), C('white', 'белая', '#f4f6fa'), C('yellow', 'жёлтая', '#ffd23f')] },
  { id: 'wr-t4', region: 'wear', type: 'shirt', bk: 'Stiga', name: 'Футболка Vasa', orig: 'Stiga', price: 1500, real: '≈ 4 000 ₽', style: 'atk', desc: 'В цветах шведской сборной.', colors: [C('blue', 'синяя', '#0e3b8c'), C('yellow', 'жёлтая', '#ffcc00'), C('black', 'чёрная', '#1b1c20')] },
  { id: 'wr-t5', region: 'wear', type: 'shirt', bk: 'Tibhar', name: 'Футболка Tiger', orig: 'Tibhar', price: 1650, real: '≈ 4 200 ₽', style: 'atk', desc: 'Тигровый принт для смелых.', colors: [C('orange', 'оранжевая', '#ff6b1a'), C('black', 'чёрная', '#1b1c20')] },
  { id: 'wr-t6', region: 'wear', type: 'shirt', bk: 'Butterfly', name: 'Футболка Tour', orig: 'Butterfly', price: 1900, real: '≈ 5 000 ₽', style: 'top', desc: 'В такой выходят на мировые турниры.', colors: [C('white', 'белая', '#f4f6fa'), C('navy', 'тёмно-синяя', '#14306b'), C('red', 'красная', '#d62839'), C('gold', 'золотая · лимит', '#d4af37', 400)] },
  { id: 'wr-t7', region: 'wear', type: 'shirt', bk: 'Li-Ning', name: 'Футболка «Красный дракон»', orig: 'Li-Ning, сборная Китая', price: 2300, real: '≈ 6 000 ₽', style: 'top', desc: 'Форма чемпионов. Самая желанная.', colors: [C('red', 'красная', '#c8102e'), C('yellow', 'жёлтая', '#ffcc00')] },
  { id: 'wr-s1', region: 'wear', type: 'shorts', bk: 'Sanwei', name: 'Шорты Basic', orig: 'Sanwei', price: 700, real: '≈ 1 500 ₽', style: 'uni', desc: 'Лёгкие игровые шорты.', colors: [C('black', 'чёрные', '#1b1c20'), C('navy', 'тёмно-синие', '#14306b')] },
  { id: 'wr-s2', region: 'wear', type: 'shorts', bk: 'Donic', name: 'Шорты Team', orig: 'Donic', price: 950, real: '≈ 2 500 ₽', style: 'uni', desc: 'Карман для мяча, эластичный пояс.', colors: [C('black', 'чёрные', '#1b1c20'), C('blue', 'синие', '#1f5fc4')] },
  { id: 'wr-s3', region: 'wear', type: 'shorts', bk: 'Stiga', name: 'Шорты Vasa', orig: 'Stiga', price: 1050, real: '≈ 2 800 ₽', style: 'atk', desc: 'В пару к футболке Vasa.', colors: [C('blue', 'синие', '#0e3b8c'), C('black', 'чёрные', '#1b1c20')] },
  { id: 'wr-s4', region: 'wear', type: 'shorts', bk: 'Butterfly', name: 'Шорты Pro', orig: 'Butterfly', price: 1300, real: '≈ 3 500 ₽', style: 'top', desc: 'Профессиональный крой.', colors: [C('black', 'чёрные', '#1b1c20'), C('navy', 'тёмно-синие', '#14306b'), C('white', 'белые', '#f4f6fa')] },
  { id: 'wr-s5', region: 'wear', type: 'shorts', bk: 'Li-Ning', name: 'Шорты «Красный дракон»', orig: 'Li-Ning', price: 1550, real: '≈ 4 000 ₽', style: 'top', desc: 'Комплект к футболке сборной.', colors: [C('red', 'красные', '#c8102e')] },
  { id: 'wr-f1', region: 'wear', type: 'shoes', bk: 'Stiga', name: 'Кроссовки Liner', orig: 'Stiga Liner', price: 2900, real: '≈ 7 000 ₽', style: 'uni', desc: 'Цепкая подошва для быстрых шагов.', colors: [C('wb', 'бело-синие', '#f4f6fa'), C('black', 'чёрные', '#1b1c20')], accent: ['#1f5fc4', '#ffcc00'] },
  { id: 'wr-f2', region: 'wear', type: 'shoes', bk: 'Donic', name: 'Кроссовки Ultra', orig: 'Donic Ultra Power', price: 3300, real: '≈ 8 000 ₽', style: 'uni', desc: 'Лёгкие и устойчивые.', colors: [C('wb', 'бело-голубые', '#f4f6fa'), C('navy', 'тёмно-синие', '#14306b')], accent: ['#4da3ff', '#ffffff'] },
  { id: 'wr-f3', region: 'wear', type: 'shoes', bk: 'Victas', name: 'Кроссовки V-610', orig: 'Victas V-610', price: 3800, real: '≈ 9 500 ₽', style: 'atk', desc: 'Японский дизайн, низкий профиль.', colors: [C('white', 'белые', '#f4f6fa'), C('purple', 'фиолетовые', '#6a1b9a')], accent: ['#6a1b9a', '#ffd23f'] },
  { id: 'wr-f4', region: 'wear', type: 'shoes', bk: 'Mizuno', name: 'Кроссовки Wave Metal', orig: 'Mizuno Wave Medal', price: 5200, real: '≈ 12 000 ₽', style: 'top', desc: 'Любимые у профессионалов.', colors: [C('wb', 'бело-синие', '#f4f6fa'), C('bg', 'чёрно-золотые', '#1b1c20', 500)], accent: ['#1f5fc4', '#d4af37'] },
  { id: 'wr-f5', region: 'wear', type: 'shoes', bk: 'Butterfly', name: 'Кроссовки Lazoline', orig: 'Butterfly Lezoline', price: 6300, real: '≈ 14 000 ₽', style: 'top', desc: 'Топовая модель — мечта каждого игрока.', colors: [C('wr', 'бело-красные', '#f4f6fa'), C('neon', 'чёрные неон', '#1b1c20', 500)], accent: ['#d62839', '#c6ff1a'] },
];
// внутренние характеристики: основания — вес, толщина, класс; накладки — жёсткость, дуга, липкость, вес
const BX = { 'cn-b1': [85, 6.0, 'ALL'], 'cn-b2': [80, 5.6, 'ALL+'], 'cn-b3': [88, 6.2, 'OFF−'], 'cn-b4': [86, 5.8, 'OFF'], 'cn-b5': [90, 5.9, 'OFF+'],
  'eu-b1': [82, 5.7, 'ALL'], 'eu-b2': [84, 5.9, 'ALL+'], 'eu-b3': [89, 6.3, 'OFF−'], 'eu-b4': [85, 5.9, 'OFF'], 'eu-b5': [87, 5.8, 'OFF+'],
  'jp-b1': [78, 5.5, 'ALL'], 'jp-b2': [83, 6.0, 'OFF−'], 'jp-b3': [86, 6.1, 'OFF'], 'jp-b4': [86, 5.9, 'OFF'], 'jp-b5': [85, 5.7, 'OFF+'] };
const RX = { 'cn-r1': ['39°', 'средняя', 'высокая', 46], 'cn-r2': ['40°', 'средняя', 'высокая', 47], 'cn-r3': ['—', 'низкая', 'нет', 30], 'cn-r4': ['41°', 'выше средней', 'средняя', 49], 'cn-r5': ['40°', 'низкая', 'очень высокая', 50],
  'eu-r1': ['40°', 'средняя', 'нет', 44], 'eu-r2': ['—', 'низкая', 'нет', 28], 'eu-r3': ['47,5°', 'высокая', 'нет', 50], 'eu-r4': ['47,5°', 'высокая', 'нет', 48], 'eu-r5': ['47,5°', 'выше средней', 'нет', 50],
  'jp-r1': ['40°', 'средняя', 'нет', 44], 'jp-r2': ['35°', 'средняя', 'нет', 42], 'jp-r3': ['—', 'низкая', 'нет', 27], 'jp-r4': ['35°', 'высокая', 'нет', 46], 'jp-r5': ['40°', 'выше средней', 'средняя', 50] };
// форма ручки — выбирается при покупке основания; FL — базовая цена, остальные дороже
const HANDLES = [C('FL', 'FL — расширяется книзу, самая популярная', '#c98a4b'), C('ST', 'ST — прямая, удобно перехватывать', '#c98a4b', 60), C('AN', 'AN — анатомическая, утолщение под ладонь', '#c98a4b', 100), C('CS', 'CS — короткая китайская для хвата «пером»', '#c98a4b', 150)];
for (const it of ITEMS) {
  it.brand = brandName(it.bk);
  if (it.type === 'blade') { [it.wt, it.th, it.cls] = BX[it.id]; it.colors = HANDLES; it.handles = true; }
  if (it.type === 'rubber') [it.hard, it.arc, it.tack, it.wt] = RX[it.id];
}
const byId = id => ITEMS.find(x => x.id === id);
const colorOf = (it, key) => it.colors?.find(c => c.key === key) || it.colors?.[0] || null;
const priceOf = (it, key) => it.price + (colorOf(it, key)?.extra || 0);
const keyOf = (it, color) => it.colors ? `${it.id}:${colorOf(it, color).key}` : it.id;
const parseKey = k => { const [id, color] = (k || '').split(':'); return { it: byId(id), color }; };
const STYLE = { atk: ['Атака', 'atk'], def: ['Защита', 'def'], uni: ['Универсал', 'uni'], top: ['Топ', 'top'] };
const EQUIP = { blade: 'blade', rubber: 'side', grip: 'grip', tape: 'tape' };


// эксклюзив за лигу «Золото» — не продаётся
ITEMS.push({ id: 'rw-tape-gold', region: 'rw', type: 'tape', bk: 'Donic', brand: 'Tonic', name: 'Золотая торцевая лента', orig: 'награда за лигу «Золото»', price: 0, real: '—', style: 'top', desc: 'Только для тех, кто дошёл до Золота.', colors: [C('gold', 'золотая', '#d4af37')], reward: true });
// награды за лиги: что можно выбрать бесплатно
export const LEAGUE_REWARDS = [
  { league: 'silver', name: 'Серебро', text: 'Аксессуар на выбор (до 250 PC)', types: ['grip', 'tape', 'ball'], cap: 250 },
  { league: 'gold', name: 'Золото', text: 'Накладка на выбор (до 1 000 PC) + золотая торцевая лента', types: ['rubber'], cap: 1000, bonus: 'rw-tape-gold:gold' },
  { league: 'platinum', name: 'Платина', text: 'Основание на выбор (до 3 000 PC)', types: ['blade'], cap: 3000 },
  { league: 'diamond', name: 'Алмаз', text: 'Кроссовки на выбор + алмазная рамка профиля', types: ['shoes'], cap: 99999 },
];
export const STREAK = [20, 30, 40, 50, 60, 80, 120];
export const STARTER = 'cn-b1:FL';
export { BRANDS, ITEMS, RG, RGSUB, RUBBER_COLORS, STYLE, EQUIP, byId, colorOf, priceOf, keyOf, parseKey, brandName };
