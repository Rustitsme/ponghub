// Каталог магазина PongHub: вымышленные бренды, предметы, цены, варианты (цвет / форма ручки).
// Цены дублируются в базе (shop_items) — менять в обоих местах (supabase/migration-015-shop.sql).
// ───────────── Бренды PongHub (вымышленные) ─────────────
const BRANDS = {
  tsubame: { name: 'Tsubame', color: '#d62839', mark: 'bird' },
  rhein: { name: 'Rheinwerk', color: '#1f5fc4', mark: 'ring' },
  nordvik: { name: 'Nordvik', color: '#0e3b8c', mark: 'chevron' },
  falkner: { name: 'Falkner', color: '#e8590c', mark: 'flame' },
  kraft: { name: 'Kraftmann', color: '#2b2f36', mark: 'box' },
  shiro: { name: 'Shirokaze', color: '#c1121f', mark: 'sun' },
  kirameki: { name: 'Kirameki', color: '#0b7a47', mark: 'stars' },
  raijin: { name: 'Raijin', color: '#6a1b9a', mark: 'bolt' },
  longwei: { name: 'Longwei', color: '#d62839', mark: 'tri' },
  baima: { name: 'Baima', color: '#1f5fc4', mark: 'diamond' },
  qinglan: { name: 'Qinglan', color: '#e8590c', mark: 'wave' },
  kunlun: { name: 'Kunlun', color: '#16181d', mark: 'mountain' },
  huaxia: { name: 'Huaxia', color: '#d62839', mark: 'stripes' },
  ph: { name: 'PongHub', color: '#e63946', mark: 'bolt' },
  aozora: { name: 'Aozora', color: '#1f5fc4', mark: 'diamond' },
};
const brandName = bk => BRANDS[bk]?.name || bk;

// ───────────── Каталог ─────────────
const RG = { cn: 'Китай', eu: 'Европа', jp: 'Япония', acc: 'Аксессуары', wear: 'Форма', rw: 'Награды', skin: 'Коллекция' };
const RGSUB = { cn: 'Липкие накладки и мощный накат', eu: 'Германия и Швеция: тензоры и контроль', jp: 'Легенды японских мастеров', acc: 'Обмотки, лента, мячи, чехлы', wear: 'Футболки, шорты, кроссовки, носки, напульсники, повязки', rw: 'Бесплатно за достижения', skin: 'Эксклюзивные скины — только за достижения' };
const C = (key, name, hex, extra = 0) => ({ key, name, hex, extra });
const RUBBER_COLORS = [C('red', 'красная', '#d62839'), C('black', 'чёрная', '#18191d'), C('blue', 'синяя', '#1f5fc4', 60)];
// s: скорость, w: вращение, c: контроль (из 10)
const B = (id, region, bk, name, orig, price, real, style, s, w, c, layers, material, desc, look) => ({ id, region, type: 'blade', bk, name, orig, price, real, style, s, w, c, layers, material, desc, look });
const R = (id, region, bk, name, orig, price, real, style, s, w, c, rubber, sponge, sp, desc) => ({ id, region, type: 'rubber', bk, name, orig, price, real, style, s, w, c, rubber, sponge, sp, desc, colors: RUBBER_COLORS });
const ITEMS = [
  B('cn-b1', 'cn', 'qinglan', 'Start 7', '', 1200, '', 'uni', 6, 7, 9, '7 слоёв', 'дерево', 'Надёжная первая ракетка: прощает ошибки и учит чувствовать мяч.', { face: '#e6bd84', cheek: '#d9b07a', ply: ['#e6bd84', '#c48d4c', '#f1d3a1'] }),
  B('cn-b2', 'cn', 'baima', 'Breeze T12', '', 1550, '', 'uni', 6.5, 7.5, 9, '5 слоёв', 'лимба', 'Мягкий удар, отличный контроль для подрезки и первого наката.', { face: '#ecc58c', cheek: '#7a4b2a', ply: ['#ecc58c', '#d9a865', '#f6dcae'] }),
  B('cn-b3', 'cn', 'longwei', 'Force G7', '', 1950, '', 'atk', 7.5, 8, 8, '7 слоёв', 'дерево', 'Жёстче и быстрее — для уверенного наката с обеих сторон.', { face: '#dcab6e', cheek: '#2a2420', ply: ['#dcab6e', '#b8803f', '#ecc890'] }),
  B('cn-b4', 'cn', 'baima', 'Comet Y31', '', 2750, '', 'atk', 8.5, 8, 7, '5+2 карбон', 'карбон', 'Два слоя карбона добавляют скорость, но требуют техники.', { face: '#d6a468', cheek: '#1d1d1f', ply: ['#d6a468', '#1a1a1a', '#ecc890'] }),
  B('cn-b5', 'cn', 'longwei', 'Dragon Power 5', '', 3950, '', 'top', 9, 9, 7.5, '5+2 арилат-карбон', 'карбон', 'Основание для мощного наката: сила и вращение.', { face: '#cf9c5f', cheek: '#d6ad78', ply: ['#cf9c5f', '#2a2a2a', '#e8c088'] }),
  R('cn-r1', 'cn', 'kunlun', 'Grip III', '', 600, '', 'uni', 6, 8, 8, 'липкая', '2.0 мм', '#f2c14e', 'Классическая липкая накладка: вращение и контроль за небольшие деньги.'),
  R('cn-r2', 'cn', 'baima', 'Meteor II', '', 650, '', 'atk', 7, 8.5, 7.5, 'липкая', '2.1 мм', '#f0a64a', 'Чуть быстрее и мягче — удобна для наката с отскока.'),
  R('cn-r3', 'cn', 'baima', 'L-90 · длинные шипы', '', 750, '', 'def', 3, 6, 8.5, 'длинные шипы', '0.5 мм', '#f2c14e', 'Путает соперника: возвращает его же вращение. Для защиты.'),
  R('cn-r4', 'cn', 'qinglan', 'Tiger Spin', '', 950, '', 'atk', 8, 8.5, 7.5, 'полулипкая', '2.15 мм', '#ef8a3c', 'Губка для атаки с хорошим «зацепом» мяча.'),
  R('cn-r5', 'cn', 'longwei', 'Dragon Spin Neo', '', 1300, '', 'top', 8.5, 10, 7.5, 'липкая «нео»', '2.15 мм', '#e9772f', 'Легенда Китая: максимальное вращение и тяжёлый накат.'),

  B('eu-b1', 'eu', 'nordvik', 'Fjord ALL', '', 1650, '', 'uni', 6, 7, 9.5, '5 слоёв', 'дерево', 'Классика: чувство мяча и контроль.', { face: '#e8c088', cheek: '#dcb27c', ply: ['#e8c088', '#d4a062', '#f3d8a8'] }),
  B('eu-b2', 'eu', 'rhein', 'Comfort V1', '', 2200, '', 'uni', 6.5, 7.5, 9, '5 слоёв + Sense', 'дерево', 'Вставки в ручке гасят вибрацию — удобный универсал.', { face: '#dfb47c', cheek: '#1b1d22', ply: ['#dfb47c', '#c99858', '#efd09c'] }),
  B('eu-b3', 'eu', 'falkner', 'Eiche Power', '', 3000, '', 'atk', 8, 8, 8, '7 слоёв', 'дерево', 'Мощное основание без карбона — для любителей дерева.', { face: '#d6a468', cheek: '#232325', ply: ['#d6a468', '#b9813f', '#e9c48d'] }),
  B('eu-b4', 'eu', 'kraft', 'Turbo CO', '', 4150, '', 'atk', 8.5, 8, 7.5, '5+2 карбон', 'карбон', 'Carbon Offensive: быстрое, но послушное основание.', { face: '#d19f62', cheek: '#1c2230', ply: ['#d19f62', '#1f1f1f', '#e6c088'] }),
  B('eu-b5', 'eu', 'nordvik', 'Hexa Carbon', '', 6000, '', 'top', 9.5, 9, 7.5, '5+2 карбон', 'карбон', 'Шестиугольная голова: больше «сладкая точка». Самое необычное основание.', { face: '#cb985c', cheek: '#151517', ply: ['#cb985c', '#1d1d1d', '#e2bb82'], hex: true }),
  R('eu-r1', 'eu', 'rhein', 'Soft Gold', '', 750, '', 'uni', 7, 7.5, 8.5, 'классическая', '2.0 мм', '#f4d35e', 'Мягкая и предсказуемая — для стабильной игры.'),
  R('eu-r2', 'eu', 'falkner', 'Chaos · шипы', '', 850, '', 'def', 3, 6, 8.5, 'длинные шипы', 'OX', null, 'Самые «злые» шипы Европы: мяч летит непредсказуемо.'),
  R('eu-r3', 'eu', 'rhein', 'Blitz M1', '', 1050, '', 'atk', 9, 9, 7, 'тензор', '2.0 мм', '#4da3ff', 'Жёсткий тензор: сильный удар и вращение.'),
  R('eu-r4', 'eu', 'kraft', 'Tempo 47', '', 1200, '', 'atk', 8.5, 9, 8, 'тензор', '2.1 мм', '#ffd23f', 'Баланс атаки и контроля — одна из самых популярных.'),
  R('eu-r5', 'eu', 'falkner', 'Rakete MX', '', 1450, '', 'top', 9.5, 9.5, 7, 'тензор', 'max', '#ffb627', 'Топ Европы для атакующих: скорость и «выстрел».'),

  B('jp-b1', 'jp', 'shiro', 'Kaze Soft', '', 1900, '', 'uni', 6, 7, 9.5, '5 слоёв', 'дерево', 'Мягкое и лёгкое: идеально для контроля и подрезки.', { face: '#efcb95', cheek: '#e2bd88', ply: ['#efcb95', '#ddb175', '#f7e0b6'] }),
  B('jp-b2', 'jp', 'shiro', 'Kaminari OFF', '', 2450, '', 'atk', 7.5, 8, 8.5, '5 слоёв', 'дерево', 'Основание для нападения у стола, любимое у азиатских атакующих.', { face: '#e4b67c', cheek: '#b8824e', ply: ['#e4b67c', '#cf9c5c', '#f1d3a1'] }),
  B('jp-b3', 'jp', 'tsubame', 'Heritage', '', 3300, '', 'atk', 8, 8.5, 8.5, '5 слоёв', 'дерево', 'Легенда: «как продолжение руки».', { face: '#ddb077', cheek: '#dcb684', ply: ['#ddb077', '#c79656', '#eccb95'] }),
  B('jp-b4', 'jp', 'tsubame', 'Core Layer', '', 6200, '', 'atk', 8.5, 9, 8.5, '5+2 ALC внутри', 'ALC', 'Карбон спрятан ближе к центру: мощь с ощущением дерева.', { face: '#d9ab70', cheek: '#d9b27e', ply: ['#d9ab70', '#c9b27a', '#eac792'] }),
  B('jp-b5', 'jp', 'tsubame', 'Zenith ZC', '', 9200, '', 'top', 9.5, 9.5, 8, '5+2 ZL-карбон', 'ZLC', 'Вершина каталога: основание чемпионов.', { face: '#d4a468', cheek: '#3a2a1e', ply: ['#d4a468', '#8a8f99', '#e7c38c'] }),
  R('jp-r1', 'jp', 'shiro', 'Stable 5', '', 900, '', 'uni', 7, 7.5, 9, 'классическая', '2.0 мм', '#f6e27a', 'Надёжная и стабильная — подходит любому стилю.'),
  R('jp-r2', 'jp', 'tsubame', 'Control One', '', 1000, '', 'uni', 7, 7.5, 9.5, 'классическая', '1.9 мм', '#f8d77a', 'Эталон контроля, на ней учились поколения игроков.'),
  R('jp-r3', 'jp', 'raijin', 'Raiden · шипы', '', 950, '', 'def', 3, 6.5, 9, 'длинные шипы', 'OX', null, 'Мягкие шипы для защитников у стола.'),
  R('jp-r4', 'jp', 'tsubame', 'Swift', '', 1450, '', 'atk', 8.5, 8.5, 8.5, 'тензор', '2.1 мм', '#ffc94d', 'Быстрая, но послушная — шаг к профессиональным накладкам.'),
  R('jp-r5', 'jp', 'tsubame', 'Apex Pro', '', 2000, '', 'top', 9.5, 10, 8.5, 'полулипкий тензор', '2.1 мм', '#ffb000', 'Накладка чемпионов: липкость Китая и скорость Японии.'),

  // аксессуары — у каждого свои цвета
  { id: 'acc-g1', region: 'acc', type: 'grip', bk: 'baima', name: 'Махровая обмотка', price: 180, style: 'uni', desc: 'Мягкая махровая обмотка: рука не скользит даже в жару.', colors: [C('blue', 'синяя', '#2563b8'), C('white', 'белая', '#f2f4f8'), C('red', 'красная', '#d62839')] },
  { id: 'acc-g2', region: 'acc', type: 'grip', bk: 'tsubame', name: 'Grip Tape', price: 250, style: 'uni', desc: 'Тонкая липкая лента на ручку.', colors: [C('black', 'чёрная', '#1b1c20'), C('red', 'красная', '#d62839'), C('mint', 'мятная', '#3ccfa8'), C('pink', 'розовая', '#ff6fa7')] },
  { id: 'acc-g3', region: 'acc', type: 'grip', bk: 'nordvik', name: 'Кожаная обмотка', price: 400, style: 'top', desc: 'Премиальная кожа с прострочкой.', colors: [C('brown', 'коричневая', '#6b4226'), C('black', 'чёрная', '#222'), C('gold', 'золотая', '#c9a227', 150)] },
  { id: 'acc-t1', region: 'acc', type: 'tape', bk: 'rhein', name: 'Торцевая лента Classic', price: 150, style: 'uni', tape: 'classic', desc: 'Тонкая лента по краю основания: защищает от ударов о стол.', colors: [C('black', 'чёрная', '#1b1c20'), C('blue', 'синяя', '#1f5fc4'), C('red', 'красная', '#d62839'), C('silver', 'серебристая', '#c0c4cc', 50)] },
  { id: 'acc-t2', region: 'acc', type: 'tape', bk: 'tsubame', name: 'Торцевая лента Pro', price: 220, style: 'top', tape: 'pro', desc: 'Узкая лента с фирменной надписью по всей длине.', colors: [C('black', 'чёрная', '#16171b'), C('white', 'белая', '#f2f4f7'), C('red', 'красная', '#c8102e'), C('green', 'зелёная', '#12a061')] },
  { id: 'acc-t3', region: 'acc', type: 'tape', bk: 'kraft', name: 'Торцевая лента Carbon', price: 280, style: 'top', tape: 'carbon', desc: 'Плетение «под карбон» с тонкой цветной полосой.', colors: [C('graphite', 'графит', '#2a2d33'), C('gold', 'с золотом', '#d4af37', 60), C('blue', 'с синим', '#2f7de1')] },
  { id: 'acc-t4', region: 'acc', type: 'tape', bk: 'raijin', name: 'Торцевая лента Neon', price: 200, style: 'atk', tape: 'neon', desc: 'Яркий неон — ракетку видно издалека.', colors: [C('lime', 'лайм', '#b6f400'), C('pink', 'розовая', '#ff3d9a'), C('cyan', 'бирюзовая', '#00d3e6'), C('orange', 'оранжевая', '#ff7a00')] },
  { id: 'acc-b1', region: 'acc', type: 'ball', bk: 'rhein', name: 'Мячи Training ×6', price: 180, style: 'uni', desc: 'Тренировочные мячи — для отработки ударов.', stars: 1, colors: [C('white', 'белые', '#f5f5f5'), C('orange', 'оранжевые', '#ff8a1f')] },
  { id: 'acc-b2', region: 'acc', type: 'ball', bk: 'longwei', name: 'Мячи Turnir 40+ ★★★ ×3', price: 250, style: 'uni', desc: 'Мячи турнирного класса.', stars: 3, colors: [C('white', 'белые', '#f5f5f5')] },
  { id: 'acc-b3', region: 'acc', type: 'ball', bk: 'kirameki', name: 'Мячи Pro 40+ ×3', price: 400, style: 'top', desc: 'Мячи высшего класса, лучший отскок.', stars: 3, colors: [C('white', 'белые', '#f5f5f5')] },
  { id: 'acc-c1', region: 'acc', type: 'case', bk: 'nordvik', name: 'Чехол для ракетки', price: 450, style: 'uni', desc: 'Мягкий чехол с отделением для мячей.', colors: [C('navy', 'синий', '#14306b'), C('black', 'чёрный', '#1b1c20'), C('red', 'красный', '#b8212f')] },
  { id: 'acc-c2', region: 'acc', type: 'case', bk: 'tsubame', name: 'Жёсткий кейс', price: 1050, style: 'top', desc: 'Кейс, который защитит ракетку в дороге.', colors: [C('black', 'чёрный', '#1b1c20'), C('white', 'белый', '#eef1f6'), C('carbon', 'карбон', '#33363d', 200)] },

  // форма: чем круче бренд — тем дороже; лимитированные цвета — дороже
  { id: 'wr-t1', region: 'wear', type: 'shirt', bk: 'qinglan', name: 'Футболка Basic', price: 900, style: 'uni', desc: 'Простая и удобная, для каждой игры.', colors: [C('white', 'белая', '#f4f6fa'), C('black', 'чёрная', '#1b1c20'), C('red', 'красная', '#d62839')] },
  { id: 'wr-t2', region: 'wear', type: 'shirt', bk: 'baima', name: 'Футболка Pro', price: 1100, style: 'uni', desc: 'Лёгкая сетка на спине — не жарко.', colors: [C('blue', 'синяя', '#1f5fc4'), C('red', 'красная', '#d62839'), C('black', 'чёрная', '#1b1c20')] },
  { id: 'wr-t3', region: 'wear', type: 'shirt', bk: 'rhein', name: 'Футболка Team', price: 1350, style: 'atk', desc: 'Командная футболка с яркими вставками.', colors: [C('blue', 'синяя', '#1f5fc4'), C('white', 'белая', '#f4f6fa'), C('yellow', 'жёлтая', '#ffd23f')] },
  { id: 'wr-t4', region: 'wear', type: 'shirt', bk: 'nordvik', name: 'Футболка Nord', price: 1500, style: 'atk', desc: 'Северные цвета: синий и жёлтый.', colors: [C('blue', 'синяя', '#0e3b8c'), C('yellow', 'жёлтая', '#ffcc00'), C('black', 'чёрная', '#1b1c20')] },
  { id: 'wr-t5', region: 'wear', type: 'shirt', bk: 'falkner', name: 'Футболка Blaze', price: 1650, style: 'atk', desc: 'Огненный принт для смелых.', colors: [C('orange', 'оранжевая', '#ff6b1a'), C('black', 'чёрная', '#1b1c20')] },
  { id: 'wr-t6', region: 'wear', type: 'shirt', bk: 'tsubame', name: 'Футболка Tour', price: 1900, style: 'top', desc: 'В такой выходят на мировые турниры.', colors: [C('white', 'белая', '#f4f6fa'), C('navy', 'тёмно-синяя', '#14306b'), C('red', 'красная', '#d62839'), C('gold', 'золотая · лимит', '#d4af37', 400)] },
  { id: 'wr-t7', region: 'wear', type: 'shirt', bk: 'huaxia', name: 'Футболка «Красный дракон»', price: 2300, style: 'top', desc: 'Форма чемпионов. Самая желанная.', colors: [C('red', 'красная', '#c8102e'), C('yellow', 'жёлтая', '#ffcc00')] },
  { id: 'wr-s1', region: 'wear', type: 'shorts', bk: 'qinglan', name: 'Шорты Basic', price: 700, style: 'uni', desc: 'Лёгкие игровые шорты.', colors: [C('black', 'чёрные', '#1b1c20'), C('navy', 'тёмно-синие', '#14306b')] },
  { id: 'wr-s2', region: 'wear', type: 'shorts', bk: 'rhein', name: 'Шорты Team', price: 950, style: 'uni', desc: 'Карман для мяча, эластичный пояс.', colors: [C('black', 'чёрные', '#1b1c20'), C('blue', 'синие', '#1f5fc4')] },
  { id: 'wr-s3', region: 'wear', type: 'shorts', bk: 'nordvik', name: 'Шорты Nord', price: 1050, style: 'atk', desc: 'В пару к футболке Nord.', colors: [C('blue', 'синие', '#0e3b8c'), C('black', 'чёрные', '#1b1c20')] },
  { id: 'wr-s4', region: 'wear', type: 'shorts', bk: 'tsubame', name: 'Шорты Pro', price: 1300, style: 'top', desc: 'Профессиональный крой.', colors: [C('black', 'чёрные', '#1b1c20'), C('navy', 'тёмно-синие', '#14306b'), C('white', 'белые', '#f4f6fa')] },
  { id: 'wr-s5', region: 'wear', type: 'shorts', bk: 'huaxia', name: 'Шорты «Красный дракон»', price: 1550, style: 'top', desc: 'Комплект к футболке сборной.', colors: [C('red', 'красные', '#c8102e')] },
  { id: 'wr-f1', region: 'wear', type: 'shoes', bk: 'nordvik', name: 'Кроссовки Glide', price: 2900, style: 'uni', desc: 'Цепкая подошва для быстрых шагов.', colors: [C('wb', 'бело-синие', '#f4f6fa'), C('black', 'чёрные', '#1b1c20')], accent: ['#1f5fc4', '#ffcc00'] },
  { id: 'wr-f2', region: 'wear', type: 'shoes', bk: 'rhein', name: 'Кроссовки Air Step', price: 3300, style: 'uni', desc: 'Лёгкие и устойчивые.', colors: [C('wb', 'бело-голубые', '#f4f6fa'), C('navy', 'тёмно-синие', '#14306b')], accent: ['#4da3ff', '#ffffff'] },
  { id: 'wr-f3', region: 'wear', type: 'shoes', bk: 'raijin', name: 'Кроссовки R-7', price: 3800, style: 'atk', desc: 'Японский дизайн, низкий профиль.', colors: [C('white', 'белые', '#f4f6fa'), C('purple', 'фиолетовые', '#6a1b9a')], accent: ['#6a1b9a', '#ffd23f'] },
  { id: 'wr-f4', region: 'wear', type: 'shoes', bk: 'aozora', name: 'Кроссовки Sky Pro', price: 5200, style: 'top', desc: 'Любимые у профессионалов.', colors: [C('wb', 'бело-синие', '#f4f6fa'), C('bg', 'чёрно-золотые', '#1b1c20', 500)], accent: ['#1f5fc4', '#d4af37'] },
  { id: 'wr-f5', region: 'wear', type: 'shoes', bk: 'tsubame', name: 'Кроссовки Phoenix', price: 6300, style: 'top', desc: 'Топовая модель — мечта каждого игрока.', colors: [C('wr', 'бело-красные', '#f4f6fa'), C('neon', 'чёрные неон', '#1b1c20', 500)], accent: ['#d62839', '#c6ff1a'] },
  { id: 'wr-k1', region: 'wear', type: 'socks', bk: 'qinglan', name: 'Носки Basic', price: 250, style: 'uni', desc: 'Короткие спортивные носки.', colors: [C('white', 'белые', '#f4f6fa'), C('black', 'чёрные', '#1b1c20')] },
  { id: 'wr-k2', region: 'wear', type: 'socks', bk: 'rhein', name: 'Гетры Team', price: 450, style: 'atk', high: true, desc: 'Высокие, почти до колена — как у профи.', colors: [C('white', 'белые', '#f4f6fa'), C('black', 'чёрные', '#1b1c20'), C('blue', 'синие', '#1f5fc4'), C('red', 'красные', '#d62839')] },
  { id: 'wr-w1', region: 'wear', type: 'wrist', bk: 'baima', name: 'Напульсники', price: 300, style: 'uni', desc: 'Пара на обе руки: пот не мешает хвату.', colors: [C('white', 'белые', '#f4f6fa'), C('black', 'чёрные', '#1b1c20'), C('red', 'красные', '#d62839'), C('blue', 'синие', '#1f5fc4')] },
  { id: 'wr-w2', region: 'wear', type: 'wrist', bk: 'tsubame', name: 'Напульсники Pro', price: 550, style: 'top', desc: 'Плотная махра и эмблема бренда.', colors: [C('red', 'красные', '#d62839'), C('navy', 'тёмно-синие', '#14306b'), C('gold', 'золотые · лимит', '#d4af37', 200)] },
  { id: 'wr-h1', region: 'wear', type: 'head', bk: 'longwei', name: 'Повязка', price: 350, style: 'uni', desc: 'Держит волосы и пот — взгляд только на мяч.', colors: [C('red', 'красная', '#d62839'), C('black', 'чёрная', '#1b1c20'), C('white', 'белая', '#f4f6fa'), C('blue', 'синяя', '#1f5fc4')] },
  { id: 'wr-h2', region: 'wear', type: 'head', bk: 'falkner', name: 'Повязка Blaze', price: 600, style: 'top', desc: 'Яркая, заметна с другого конца зала.', colors: [C('orange', 'оранжевая', '#ff6b1a'), C('lime', 'салатовая', '#9be31a'), C('pink', 'розовая', '#ff4f9a')] },
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



// ───────────── Коллекция: эксклюзивные скины за достижения ─────────────
// Не продаются: открываются сами, когда выполнено условие (проверяет сервер). Только внешний вид — на игру не влияют.
// unlock: rating — рейтинг клуба, wins — победы, matches — сыгранные матчи, coins — заработанные PC за всё время.
const UNLOCK_KIND = { rating: ['Рейтинг', n => `${n}`], wins: ['Победы', n => `${n}`], matches: ['Матчи', n => `${n}`], coins: ['Заработать PC', n => n.toLocaleString('ru-RU')] };
const unlockText = u => !u ? '' : ({ rating: `Достичь рейтинга ${u.n}`, wins: `Выиграть матчей: ${u.n}`, matches: `Сыграть матчей: ${u.n}`, coins: `Заработать ${u.n.toLocaleString('ru-RU')} PC за всё время` })[u.kind];
const unlockNow = (u, st) => st ? (u.kind === 'rating' ? st.rating : u.kind === 'wins' ? st.wins : u.kind === 'matches' ? st.matches : st.coins) : 0;
const SK = (o) => ({ region: 'skin', bk: 'ph', brand: 'PongHub', price: 0, style: 'top', skin: true, ...o });
const HND = [C('FL', 'FL — расширяется книзу', '#c98a4b'), C('ST', 'ST — прямая', '#c98a4b'), C('AN', 'AN — анатомическая', '#c98a4b'), C('CS', 'CS — короткая', '#c98a4b')];
const RACKET_SKINS = [
  SK({ id: 'skin-b1', type: 'blade', name: 'Obsidian Gold', unlock: { kind: 'rating', n: 70 }, s: 8.5, w: 8.5, c: 8, layers: '5+2 карбон', material: 'чёрный лак + золото', desc: 'Чёрный лак, золотая ручка и золотые тонкие полосы. Для тех, кто дошёл до лиги «Золото».', wt: 86, th: 5.9, cls: 'OFF+', look: { face: '#17171c', cheek: '#c9a227', ply: ['#17171c', '#d4af37', '#17171c'], finish: 'goldblack' }, colors: HND, handles: true }),
  SK({ id: 'skin-b2', type: 'blade', name: 'Mirror Silver', unlock: { kind: 'rating', n: 55 }, s: 8, w: 8, c: 8.5, layers: '7 слоёв', material: 'зеркальное серебро', desc: 'Зеркальное серебро: блестит, как хром. Открывается в лиге «Серебро».', wt: 85, th: 6, cls: 'ALL+', look: { face: '#cfd4de', cheek: '#e9ecf2', ply: ['#cfd4de', '#8a8f99', '#e9ecf2'], finish: 'silver' }, colors: HND, handles: true }),
  SK({ id: 'skin-b3', type: 'blade', name: 'Bronze Forge', unlock: { kind: 'wins', n: 10 }, s: 7.5, w: 8, c: 8.5, layers: '5 слоёв', material: 'бронза', desc: 'Тёплая бронза, как свежая медаль. За 10 побед.', wt: 87, th: 5.8, cls: 'ALL', look: { face: '#b0703c', cheek: '#6b3f1d', ply: ['#b0703c', '#5b3519', '#d19a64'], finish: 'bronze' }, colors: HND, handles: true }),
];
const RUBBER_SKINS = [
  SK({ id: 'skin-r1', type: 'rubber', name: 'Gold Foil', unlock: { kind: 'coins', n: 5000 }, s: 8, w: 9, c: 7, rubber: 'липкая', sponge: '2,0 мм', sp: '#d4af37', hard: '40°', arc: 'высокая', tack: 'высокая', wt: 48, desc: 'Золотая фольга на накладке. За 5 000 заработанных PC.', colors: [C('gold', 'золотая', '#d4af37')], fin: 'gold' }),
  SK({ id: 'skin-r2', type: 'rubber', name: 'Silver Glitter', unlock: { kind: 'wins', n: 50 }, s: 8, w: 8.5, c: 7.5, rubber: 'липкая', sponge: '2,0 мм', sp: '#9aa6b8', hard: '40°', arc: 'высокая', tack: 'высокая', wt: 47, desc: 'Серебряные блёстки по всей накладке. За 50 побед.', colors: [C('silver', 'серебряная', '#b9c2d0'), C('blue', 'синие блёстки', '#2f6fd1'), C('pink', 'розовые блёстки', '#e0529c')], fin: 'glitter' }),
];
const WEAR_SKINS = [
  SK({ id: 'skin-t1', type: 'shirt', name: 'Рваная футболка', unlock: { kind: 'wins', n: 5 }, desc: 'Уличная футболка с дырами и потёртыми краями. За 5 побед.', sty: 1, colors: [C('black', 'чёрная', '#1b1c20'), C('grey', 'серая', '#6b6f77'), C('white', 'белая', '#f4f6fa')] }),
  SK({ id: 'skin-t2', type: 'shirt', name: 'Баскетбольное джерси', unlock: { kind: 'rating', n: 55 }, desc: 'Майка без рукавов и контрастные вставки по бокам. Рейтинг 55.', sty: 2, accMap: { red: '#ffffff', blue: '#ffcc00', black: '#e63946' }, colors: [C('red', 'красное', '#d62839'), C('blue', 'синее', '#1f5fc4'), C('black', 'чёрное', '#1b1c20')] }),
  SK({ id: 'skin-t3', type: 'shirt', name: 'Футбольное джерси', unlock: { kind: 'wins', n: 25 }, desc: 'Классические вертикальные полосы и цветные рукава. За 25 побед.', sty: 3, accMap: { red: '#1b1c20', blue: '#ffffff', green: '#ffffff' }, colors: [C('red', 'красно-чёрное', '#d62839'), C('blue', 'сине-белое', '#1f5fc4'), C('green', 'зелёно-белое', '#12a061')] }),
  SK({ id: 'skin-t4', type: 'shirt', name: 'Неоновая майка', unlock: { kind: 'rating', n: 70 }, desc: 'Яркая майка без рукавов — видно за километр. Рейтинг 70.', sty: 2, accMap: { lime: '#1b1c20', pink: '#1b1c20', cyan: '#1b1c20' }, colors: [C('lime', 'лайм', '#b6f400'), C('pink', 'розовая', '#ff3d9a'), C('cyan', 'бирюзовая', '#00d3e6')] }),
  SK({ id: 'skin-s1', type: 'shorts', name: 'Джинсовые шорты', unlock: { kind: 'matches', n: 10 }, desc: 'Настоящий деним с фактурой. За 10 сыгранных матчей.', sty: 1, colors: [C('blue', 'синие', '#3a5a8c'), C('light', 'голубые', '#6f8fb8'), C('black', 'чёрные', '#2a2c33')] }),
  SK({ id: 'skin-s2', type: 'shorts', name: 'Баскетбольные шорты', unlock: { kind: 'wins', n: 15 }, desc: 'Свободные, с лампасом сбоку. За 15 побед.', sty: 3, accMap: { red: '#ffffff', black: '#d4af37', blue: '#ffffff' }, colors: [C('red', 'красные', '#d62839'), C('black', 'чёрные', '#1b1c20'), C('blue', 'синие', '#1f5fc4')] }),
  SK({ id: 'skin-s3', type: 'shorts', name: 'Камуфляж', unlock: { kind: 'coins', n: 2000 }, desc: 'Военный рисунок: пятна трёх оттенков. За 2 000 заработанных PC.', sty: 2, accMap: { green: '#8a9a55', sand: '#c8b27a', urban: '#8d939c' }, colors: [C('green', 'зелёный', '#4d5b30'), C('sand', 'песочный', '#9c8756'), C('urban', 'городской', '#4a4f57')] }),
  SK({ id: 'skin-s4', type: 'shorts', name: 'Рваные джинсовые шорты', unlock: { kind: 'wins', n: 40 }, desc: 'Деним с дырами на ногах. За 40 побед.', sty: 4, colors: [C('blue', 'синие', '#3a5a8c'), C('black', 'чёрные', '#2a2c33')] }),
];
const CAP_SKINS = [
  SK({ id: 'skin-c1', type: 'cap', name: 'Бейсболка', unlock: { kind: 'wins', n: 3 }, desc: 'Классическая бейсболка с козырьком. За 3 победы.', cap: 'cap', colors: [C('red', 'красная', '#d62839'), C('black', 'чёрная', '#1b1c20'), C('white', 'белая', '#f4f6fa'), C('blue', 'синяя', '#1f5fc4')] }),
  SK({ id: 'skin-c2', type: 'cap', name: 'Снепбэк', unlock: { kind: 'wins', n: 10 }, desc: 'Плоский прямой козырёк, уличный стиль. За 10 побед.', cap: 'snap', colors: [C('black', 'чёрный', '#1b1c20'), C('white', 'белый', '#f4f6fa'), C('gold', 'золотой', '#d4af37')] }),
  SK({ id: 'skin-c3', type: 'cap', name: 'Кепка задом наперёд', unlock: { kind: 'matches', n: 25 }, desc: 'Козырёк назад, как у настоящих уличных игроков. За 25 матчей.', cap: 'rev', colors: [C('navy', 'тёмно-синяя', '#14306b'), C('red', 'красная', '#d62839'), C('green', 'зелёная', '#12a061')] }),
  SK({ id: 'skin-c4', type: 'cap', name: 'Шапка-бини', unlock: { kind: 'coins', n: 1000 }, desc: 'Тёплая вязаная шапка с отворотом. За 1 000 заработанных PC.', cap: 'beanie', colors: [C('black', 'чёрная', '#1b1c20'), C('grey', 'серая', '#8a8f99'), C('orange', 'оранжевая', '#ff7a00')] }),
  SK({ id: 'skin-c5', type: 'cap', name: 'Панама', unlock: { kind: 'wins', n: 50 }, desc: 'Широкие поля, лёгкая ткань. За 50 побед.', cap: 'bucket', colors: [C('beige', 'бежевая', '#d8c9a3'), C('black', 'чёрная', '#1b1c20'), C('green', 'зелёная', '#5b6b3a')] }),
];
const SKINS = [...RACKET_SKINS, ...RUBBER_SKINS, ...WEAR_SKINS, ...CAP_SKINS];
ITEMS.push(...SKINS);
const accOf = (it, color) => it.accMap?.[color] || it.acc || '#ffffff';

// эксклюзив за лигу «Золото» — не продаётся
ITEMS.push({ id: 'rw-tape-gold', region: 'rw', type: 'tape', bk: 'rhein', brand: 'Rheinwerk', name: 'Золотая торцевая лента', price: 0, style: 'top', tape: 'gold', desc: 'Только для тех, кто дошёл до Золота.', colors: [C('gold', 'золотая', '#d4af37')], reward: true });
// награды за лиги: что можно выбрать бесплатно
export const LEAGUE_REWARDS = [
  { league: 'silver', name: 'Серебро', text: 'Аксессуар на выбор (до 250 PC)', types: ['grip', 'tape', 'ball'], cap: 250 },
  { league: 'gold', name: 'Золото', text: 'Накладка на выбор (до 1 000 PC) + золотая торцевая лента', types: ['rubber'], cap: 1000, bonus: 'rw-tape-gold:gold' },
  { league: 'platinum', name: 'Платина', text: 'Основание на выбор (до 3 000 PC)', types: ['blade'], cap: 3000 },
  { league: 'diamond', name: 'Алмаз', text: 'Кроссовки на выбор + алмазная рамка профиля', types: ['shoes'], cap: 99999 },
];
export const STREAK = [20, 30, 40, 50, 60, 80, 120];
export const STARTER = 'cn-b1:FL';
export { UNLOCK_KIND, unlockText, unlockNow, accOf, SKINS, BRANDS, ITEMS, RG, RGSUB, RUBBER_COLORS, STYLE, EQUIP, byId, colorOf, priceOf, keyOf, parseKey, brandName };
