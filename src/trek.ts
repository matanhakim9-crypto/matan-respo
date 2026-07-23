import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';

type Bindings = {
  DB: D1Database;
};

type TrekRegion = 'israel' | 'europe' | 'asia' | 'south-america' | 'africa' | 'north-america';
type TrekDifficulty = 'easy' | 'moderate' | 'hard';
type TrekLodging = 'tent' | 'refuge' | 'teahouse' | 'guesthouse' | 'lodge' | 'hotel';
type DaysRange = 'short' | 'medium' | 'long' | 'xlong';

type TrekPlanRequest = {
  regions?: string[];
  days?: DaysRange;
  difficulty?: TrekDifficulty;
  lodging?: string[];
};

type DayPlanEntry = { title: string; dist: string; gain: string; lodge: TrekLodging; desc: string };

type Trek = {
  id: string;
  name: string;
  country: string;
  region: TrekRegion;
  days: number;
  distance: number;
  gain: number;
  difficulty: TrekDifficulty;
  lodging: TrekLodging[];
  blurb: string;
  matchScore: number;
  stages: { elevs: number[] }[];
  dayPlan: DayPlanEntry[];
  photos?: string[];
};

export const trekRoutes = new Hono<{ Bindings: Bindings }>();

// Mirrors the fmp_api_key / alpha_vantage_api_key pattern already used for
// the dividend tracker's third-party keys — set via:
//   wrangler d1 execute dividend-tracker-db --remote \
//     --command "INSERT INTO app_settings (key, value) VALUES ('anthropic_api_key', 'sk-ant-...')"
let cachedAnthropicKey: string | null | undefined;

async function getAnthropicApiKey(env: Bindings): Promise<string | null> {
  if (cachedAnthropicKey !== undefined) return cachedAnthropicKey;
  try {
    const row = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'anthropic_api_key'`).first<{ value: string }>();
    cachedAnthropicKey = row?.value ?? null;
  } catch {
    cachedAnthropicKey = null;
  }
  return cachedAnthropicKey;
}

// Real trek photos, pulled from Wikipedia/Wikimedia — no API key needed, and it's
// fetched server-side (once per trek, then cached) so results don't depend on the
// visitor's browser being able to reach Wikipedia and don't slow down every render.
const BAD_IMAGE_HINTS = ['icon', 'logo', 'symbol', 'flag', 'map', 'pictogram', 'commons-logo', 'edit-icon', 'wiki'];

async function wikiSearchTitle(lang: string, query: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=1`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    return data?.query?.search?.[0]?.title ?? null;
  } catch {
    return null;
  }
}

function filterImageInfos(infos: any[], limit: number): string[] {
  return infos
    .filter((info) => {
      if (!info?.url) return false;
      if (!/^image\/(jpeg|png)$/.test(info.mime || '')) return false;
      if ((info.width || 0) < 350) return false;
      const lower = String(info.url).toLowerCase();
      return !BAD_IMAGE_HINTS.some((hint) => lower.includes(hint));
    })
    .sort((a, b) => (b.width || 0) - (a.width || 0))
    .slice(0, limit)
    .map((info) => info.url as string);
}

async function wikiPageGallery(lang: string, title: string, limit: number): Promise<string[]> {
  try {
    const res = await fetch(
      `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}` +
        `&generator=images&gimlimit=25&prop=imageinfo&iiprop=url|size|mime&format=json&origin=*`
    );
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const pages = Object.values(data?.query?.pages ?? {}) as any[];
    return filterImageInfos(pages.map((p) => p?.imageinfo?.[0]), limit);
  } catch {
    return [];
  }
}

// Wikimedia Commons indexes many more standalone landscape/hiking photos than
// any one Wikipedia article embeds, and its file search is far more forgiving
// of a query that isn't an exact article title — a good broad fallback for
// trek names that don't have their own Wikipedia page.
async function commonsFileSearch(query: string, limit: number): Promise<string[]> {
  try {
    const res = await fetch(
      `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}` +
        `&gsrnamespace=6&gsrlimit=20&prop=imageinfo&iiprop=url|size|mime&format=json&origin=*`
    );
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const pages = Object.values(data?.query?.pages ?? {}) as any[];
    return filterImageInfos(pages.map((p) => p?.imageinfo?.[0]), limit);
  } catch {
    return [];
  }
}

// Last-resort generic search term per region, in English (Commons/enwiki index
// best in English) — guarantees a thematically-relevant photo even when a
// trek's exact name and country both come up empty.
const REGION_PHOTO_FALLBACK: Record<string, string> = {
  israel: 'Negev desert hiking Israel',
  europe: 'Alps mountains hiking trail',
  asia: 'Himalaya mountains trekking',
  'south-america': 'Andes mountains Patagonia',
  africa: 'Atlas Mountains Morocco',
  'north-america': 'Sierra Nevada mountains trail',
};

async function fetchTrekGallery(t: Trek, limit = 6): Promise<string[]> {
  for (const [lang, query] of [
    ['he', t.name],
    ['en', t.name],
  ] as const) {
    const title = await wikiSearchTitle(lang, query);
    if (title) {
      const photos = await wikiPageGallery(lang, title, limit);
      if (photos.length) return photos;
    }
  }
  const byName = await commonsFileSearch(t.name, limit);
  if (byName.length) return byName;

  const byCountry = await commonsFileSearch(t.country, limit);
  if (byCountry.length) return byCountry;

  const fallbackQuery = REGION_PHOTO_FALLBACK[t.region];
  if (fallbackQuery) {
    const byRegion = await commonsFileSearch(fallbackQuery, limit);
    if (byRegion.length) return byRegion;
  }

  return [];
}

async function enrichWithPhotos(treks: Trek[]): Promise<Trek[]> {
  return Promise.all(treks.map(async (t) => ({ ...t, photos: await fetchTrekGallery(t) })));
}

const REGION_LABELS: Record<string, string> = {
  israel: 'ישראל וסביבתה',
  europe: 'אירופה (למשל אלפים, פירנאים)',
  asia: 'אסיה (למשל ההימלאיה)',
  'south-america': 'דרום אמריקה (למשל האנדים, פטגוניה)',
  africa: 'אפריקה (למשל האטלס, קילימנג׳רו)',
  'north-america': 'צפון אמריקה (למשל הסיירה נבדה, הרוקיז)',
  any: 'כל העולם — פתוח לכל אזור',
};

const DAYS_LABELS: Record<DaysRange, string> = {
  short: '2–4 ימים',
  medium: '5–8 ימים',
  long: '9–14 ימים',
  xlong: 'מעל שבועיים',
};

const DIFFICULTY_LABELS: Record<TrekDifficulty, string> = {
  easy: 'מתחיל — הליכות יומיות קלות',
  moderate: 'מנוסה — טיפוסים משמעותיים, כושר סביר',
  hard: 'מקצועני — ימים ארוכים, גבהים, תנאי שטח קשים',
};

const LODGING_LABELS: Record<TrekLodging, string> = {
  tent: 'אוהל / קמפינג פראי',
  refuge: 'בקתות / רפוז׳ים הרריים',
  teahouse: 'טי-האוסים',
  guesthouse: 'בתי הארחה',
  lodge: 'לודג׳ים',
  hotel: 'מלונות בקצוות המסלול',
};

const LODGING_VALUES: TrekLodging[] = ['tent', 'refuge', 'teahouse', 'guesthouse', 'lodge', 'hotel'];
const REGION_VALUES: TrekRegion[] = ['israel', 'europe', 'asia', 'south-america', 'africa', 'north-america'];

const TREK_SCHEMA = {
  type: 'object',
  properties: {
    treks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'short unique kebab-case slug' },
          name: { type: 'string', description: 'trek name, in Hebrew' },
          country: { type: 'string', description: 'country or countries, in Hebrew' },
          region: { type: 'string', enum: REGION_VALUES },
          days: { type: 'integer' },
          distance: { type: 'integer', description: 'total distance in km' },
          gain: { type: 'integer', description: 'total cumulative elevation gain in meters' },
          difficulty: { type: 'string', enum: ['easy', 'moderate', 'hard'] },
          lodging: { type: 'array', items: { type: 'string', enum: LODGING_VALUES } },
          blurb: { type: 'string', description: '1-2 sentence description, in Hebrew' },
          matchScore: { type: 'integer', description: '0-100, how well this trek matches the stated preferences' },
          stages: {
            type: 'array',
            description: 'one entry per day (same length as dayPlan); a short array of elevation points in meters approximating that day’s elevation profile',
            items: {
              type: 'object',
              properties: { elevs: { type: 'array', items: { type: 'integer' } } },
              required: ['elevs'],
              additionalProperties: false,
            },
          },
          dayPlan: {
            type: 'array',
            description: 'one entry per day, same length as stages',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Hebrew, e.g. start point – end point' },
                dist: { type: 'string', description: 'Hebrew, e.g. "15 ק\\"מ"' },
                gain: { type: 'string', description: 'Hebrew, e.g. "+420 מ׳"' },
                lodge: { type: 'string', enum: LODGING_VALUES },
                desc: { type: 'string', description: '1 sentence, in Hebrew' },
              },
              required: ['title', 'dist', 'gain', 'lodge', 'desc'],
              additionalProperties: false,
            },
          },
        },
        required: ['id', 'name', 'country', 'region', 'days', 'distance', 'gain', 'difficulty', 'lodging', 'blurb', 'matchScore', 'stages', 'dayPlan'],
        additionalProperties: false,
      },
    },
  },
  required: ['treks'],
  additionalProperties: false,
} as const;

// Curated, hand-written examples used whenever the live AI lookup isn't
// available (no API key configured yet, or the call fails) so the app is
// always usable, matching the dividend tracker's own fallback conventions.
const CURATED_TREKS: Trek[] = [
  {
    id: 'israel-galil', name: 'שביל ישראל — קטע הגליל העליון', country: 'ישראל', region: 'israel',
    days: 4, distance: 64, gain: 2100, difficulty: 'easy', lodging: ['tent', 'guesthouse'], matchScore: 70,
    blurb: 'מסלול נופי בין הרי הגליל, משלב לינה בקמפינגים מוסדרים ובצימרים כפריים. מתאים כחימום לטרקים ארוכים יותר.',
    stages: [{ elevs: [300, 450, 380, 520] }, { elevs: [520, 700, 600, 780] }, { elevs: [780, 650, 500, 410] }, { elevs: [410, 300, 250, 180] }],
    dayPlan: [
      { title: 'מצפה הילה – נחל כזיב', dist: '15 ק"מ', gain: '+420 מ׳', lodge: 'tent', desc: 'ירידה לנחל כזיב, הליכה בצל עצי אלון ובריכות טבעיות.' },
      { title: 'נחל כזיב – מירון', dist: '18 ק"מ', gain: '+380 מ׳', lodge: 'guesthouse', desc: 'טיפוס מתון לכיוון הר מירון, לינה בצימר כפרי.' },
      { title: 'מירון – פקיעין', dist: '16 ק"מ', gain: '+210 מ׳', lodge: 'guesthouse', desc: 'מסלול נוף עם תצפית להרי הגליל המערבי.' },
      { title: 'פקיעין – עכו (סיום)', dist: '15 ק"מ', gain: '+90 מ׳', lodge: 'hotel', desc: 'ירידה לעבר החוף וסיום בעיר העתיקה עכו.' },
    ],
  },
  {
    id: 'ebc', name: 'מחנה הבסיס של האוורסט', country: 'נפאל', region: 'asia',
    days: 12, distance: 130, gain: 5400, difficulty: 'hard', lodging: ['teahouse'], matchScore: 60,
    blurb: 'הטרק ההימלאי הקלאסי. לינה בטי-האוסים לאורך כל הדרך, טיפוס הדרגתי לאקלימטיזציה בגובה.',
    stages: [
      { elevs: [2800, 3440] }, { elevs: [3440, 3440] }, { elevs: [3440, 3860] }, { elevs: [3860, 4410] },
      { elevs: [4410, 4410] }, { elevs: [4410, 4940] }, { elevs: [4940, 5164] }, { elevs: [5164, 5364, 4940] },
      { elevs: [4940, 3860] }, { elevs: [3860, 3440] }, { elevs: [3440, 2800] }, { elevs: [2800, 2800] },
    ],
    dayPlan: [
      { title: 'לוקלה – פאקדינג', dist: '8 ק"מ', gain: '+640 מ׳', lodge: 'teahouse', desc: 'טיסה פנימית קצרה ללוקלה, הליכה ראשונה לאורך נהר דודה קוסי.' },
      { title: 'פאקדינג – נמצ׳ה בזאר', dist: '11 ק"מ', gain: '+800 מ׳', lodge: 'teahouse', desc: 'כניסה לפארק הלאומי סגרמאטה, טיפוס תלול לנמצ׳ה.' },
      { title: 'יום אקלימטיזציה — נמצ׳ה', dist: 'הליכה קלה', gain: '+420 מ׳', lodge: 'teahouse', desc: 'יום מנוחה פעיל עם עלייה להוטל אוורסט וויו לצפייה בפסגה.' },
      { title: 'נמצ׳ה – טנגבוצ׳ה', dist: '10 ק"מ', gain: '+550 מ׳', lodge: 'teahouse', desc: 'מנזר טנגבוצ׳ה עם תצפית ישירה על האמה דבלם.' },
      { title: 'יום אקלימטיזציה — דינגבוצ׳ה', dist: 'הליכה קלה', gain: '+400 מ׳', lodge: 'teahouse', desc: 'עלייה להר נאנגקרצאנג לצורך הסתגלות לגובה.' },
      { title: 'דינגבוצ׳ה – לובוצ׳ה', dist: '8 ק"מ', gain: '+530 מ׳', lodge: 'teahouse', desc: 'מסלול לאורך המורנה של קרחון חומבו.' },
      { title: 'לובוצ׳ה – גורק שפ', dist: '8 ק"מ', gain: '+224 מ׳', lodge: 'teahouse', desc: 'הכפר האחרון לפני מחנה הבסיס.' },
      { title: 'מחנה בסיס + קאלה פתאר', dist: '15 ק"מ', gain: '+200 מ׳', lodge: 'teahouse', desc: 'עלייה למחנה הבסיס של האוורסט ולקאלה פתאר לזריחה.' },
      { title: 'ירידה לפריצ׳ה', dist: '19 ק"מ', gain: '-1080 מ׳', lodge: 'teahouse', desc: 'ירידה ארוכה, תחושת הקלה מהגובה.' },
      { title: 'פריצ׳ה – נמצ׳ה', dist: '14 ק"מ', gain: '-420 מ׳', lodge: 'teahouse', desc: 'חזרה דרך טנגבוצ׳ה.' },
      { title: 'נמצ׳ה – לוקלה', dist: '18 ק"מ', gain: '-640 מ׳', lodge: 'teahouse', desc: 'יום הליכה אחרון לפני הטיסה חזרה.' },
      { title: 'טיסה חזרה לקטמנדו', dist: '—', gain: '—', lodge: 'hotel', desc: 'טיסת בוקר ללוקלה-קטמנדו (כפוף למזג אוויר).' },
    ],
  },
  {
    id: 'salkantay', name: 'טרק סלקנטיי למאצ׳ו פיצ׳ו', country: 'פרו', region: 'south-america',
    days: 5, distance: 72, gain: 3200, difficulty: 'hard', lodging: ['tent', 'lodge'], matchScore: 55,
    blurb: 'אלטרנטיבה פחות מוכרת ל"אינקה טרייל" הקלאסי, עם מעבר הרים בגובה 4,600 מ׳ ושילוב לינה באוהלים ובלודג׳ים הרריים.',
    stages: [{ elevs: [3000, 3900] }, { elevs: [3900, 4630, 3850] }, { elevs: [3850, 2900] }, { elevs: [2900, 2050] }, { elevs: [2050, 2450] }],
    dayPlan: [
      { title: 'מוליפאטה – סוריאיוק', dist: '12 ק"מ', gain: '+900 מ׳', lodge: 'tent', desc: 'עלייה ראשונה עם תצפית להר סלקנטיי המושלג.' },
      { title: 'מעבר סלקנטיי (4,630 מ׳)', dist: '22 ק"מ', gain: '+730 מ׳ / -780 מ׳', lodge: 'tent', desc: 'יום השיא — מעבר ההרים הגבוה ביותר במסלול.' },
      { title: 'ירידה ליער הגשם', dist: '15 ק"מ', gain: '-950 מ׳', lodge: 'lodge', desc: 'מעבר דרסטי מנוף אלפיני ליער ענן טרופי.' },
      { title: 'לה פלייה – הידרואלקטריקה', dist: '14 ק"מ', gain: '-850 מ׳', lodge: 'lodge', desc: 'הליכה לאורך מסילת רכבת לעבר אגואס קליינטס.' },
      { title: 'מאצ׳ו פיצ׳ו', dist: '9 ק"מ', gain: '+400 מ׳', lodge: 'hotel', desc: 'עלייה לשער השמש וסיור באתר מאצ׳ו פיצ׳ו.' },
    ],
  },
  {
    id: 'tmb', name: 'טור דה מון בלאן', country: 'צרפת · איטליה · שוויץ', region: 'europe',
    days: 10, distance: 170, gain: 10000, difficulty: 'moderate', lodging: ['refuge'], matchScore: 65,
    blurb: 'הקפה מלאה סביב עיסוק מון בלאן דרך שלוש מדינות, עם לינה ברפוז׳ים הרריים לאורך כל הדרך.',
    stages: [
      { elevs: [1000, 1800] }, { elevs: [1800, 2500, 1900] }, { elevs: [1900, 2650, 2100] }, { elevs: [2100, 2400] },
      { elevs: [2400, 2600, 1700] }, { elevs: [1700, 2000] }, { elevs: [2000, 2450, 1900] }, { elevs: [1900, 2100] },
      { elevs: [2100, 2350, 1600] }, { elevs: [1600, 1000] },
    ],
    dayPlan: [
      { title: 'לה הוש – רפוז׳ דו מיאז', dist: '17 ק"מ', gain: '+800 מ׳', lodge: 'refuge', desc: 'יציאה מצרפת, טיפוס ראשון ליער האלפיני.' },
      { title: 'עיקול קול דה בונום', dist: '15 ק"מ', gain: '+700 מ׳', lodge: 'refuge', desc: 'מעבר גבול לאיטליה.' },
      { title: 'קורמאיור', dist: '19 ק"מ', gain: '+750 מ׳', lodge: 'refuge', desc: 'צד איטלקי של המסיב, נופי קרחונים מרשימים.' },
      { title: 'רפוז׳ בונטי', dist: '14 ק"מ', gain: '+300 מ׳', lodge: 'refuge', desc: 'הליכה תחת הפסגות הגבוהות באירופה.' },
      { title: 'מעבר לשוויץ — לה פול', dist: '16 ק"מ', gain: '+200 מ׳', lodge: 'refuge', desc: 'כניסה לקנטון ולה, נופי אלפיים שוויצריים.' },
      { title: 'שאמפקס', dist: '12 ק"מ', gain: '+300 מ׳', lodge: 'refuge', desc: 'יום קל יחסית, כפר שוויצרי קטן.' },
      { title: 'חזרה לצרפת — טרה נואר', dist: '16 ק"מ', gain: '+450 מ׳', lodge: 'refuge', desc: 'טיפוס אחרון משמעותי לפני הירידה לוואלה.' },
      { title: 'שאמוני', dist: '14 ק"מ', gain: '+200 מ׳', lodge: 'refuge', desc: 'ירידה לעמק שאמוני המפורסם.' },
      { title: 'לה טור', dist: '15 ק"מ', gain: '+250 מ׳', lodge: 'refuge', desc: 'הקטע הפחות עמוס במסלול, נוף פתוח.' },
      { title: 'חזרה ללה הוש (סגירת מעגל)', dist: '12 ק"מ', gain: '-600 מ׳', lodge: 'hotel', desc: 'סיום המעגל בדיוק בנקודת ההתחלה.' },
    ],
  },
  {
    id: 'toubkal', name: 'הר טובקאל', country: 'מרוקו', region: 'africa',
    days: 3, distance: 24, gain: 1900, difficulty: 'moderate', lodging: ['refuge', 'tent'], matchScore: 50,
    blurb: 'הפסגה הגבוהה ביותר בצפון אפריקה, טרק קצר ואינטנסיבי המתאים כ"מנה ראשונה" לפני טרקים ארוכים יותר.',
    stages: [{ elevs: [1800, 3200] }, { elevs: [3200, 4167, 3200] }, { elevs: [3200, 1800] }],
    dayPlan: [
      { title: 'אימלין – רפוז׳ טובקאל', dist: '10 ק"מ', gain: '+1400 מ׳', lodge: 'refuge', desc: 'עלייה הדרגתית דרך כפרי בֶּרְבֶּר בהרי האטלס הגבוה.' },
      { title: 'פסגת טובקאל (4,167 מ׳)', dist: '10 ק"מ', gain: '+967 מ׳ / -967 מ׳', lodge: 'refuge', desc: 'עלייה לפני עלות השחר לפסגה, נוף עד המדבר.' },
      { title: 'ירידה לאימלין', dist: '14 ק"מ', gain: '-1400 מ׳', lodge: 'hotel', desc: 'ירידה מהירה וסיום בכפר עם ריאד מקומי ללינה.' },
    ],
  },
  {
    id: 'jmt', name: 'ג׳ון מיור טרייל', country: 'ארה"ב · קליפורניה', region: 'north-america',
    days: 14, distance: 340, gain: 14500, difficulty: 'hard', lodging: ['tent'], matchScore: 45,
    blurb: 'טרק קמפינג פראי לאורך הרי הסיירה נבדה, ללא בקתות בדרך — נדרשת חפירה עצמאית של ציוד ומזון לכל הדרך.',
    stages: [
      { elevs: [2400, 2700] }, { elevs: [2700, 3300] }, { elevs: [3300, 3600, 2900] }, { elevs: [2900, 3400] },
      { elevs: [3400, 3600] }, { elevs: [3600, 3300] }, { elevs: [3300, 3700] }, { elevs: [3700, 4009, 3300] },
      { elevs: [3300, 3600] }, { elevs: [3600, 3900] }, { elevs: [3900, 4300] }, { elevs: [4300, 3900] },
      { elevs: [3900, 4421, 3600] }, { elevs: [3600, 2500] },
    ],
    dayPlan: [
      { title: 'יוסמיטי — כניסה מהוואלי', dist: '22 ק"מ', gain: '+300 מ׳', lodge: 'tent', desc: 'יציאה מעמק יוסמיטי המפורסם.' },
      { title: 'טובלר לייק', dist: '25 ק"מ', gain: '+600 מ׳', lodge: 'tent', desc: 'אגמים אלפיניים צלולים.' },
      { title: 'מעבר דונוהיו', dist: '20 ק"מ', gain: '+300 מ׳ / -700 מ׳', lodge: 'tent', desc: 'המעבר הראשון מבין כמה במסלול.' },
      { title: 'אזור רדס מדוז', dist: '24 ק"מ', gain: '+500 מ׳', lodge: 'tent', desc: 'נקודת חידוש אספקה אופציונלית.' },
      { title: 'תעלת דוד', dist: '23 ק"מ', gain: '+200 מ׳', lodge: 'tent', desc: 'הליכה לאורך נהר סן חואקין.' },
      { title: 'מארי לייק', dist: '25 ק"מ', gain: '-300 מ׳', lodge: 'tent', desc: 'יום קליל יחסית לפני הקטע התובעני הבא.' },
      { title: 'מעבר סילבר פאס', dist: '22 ק"מ', gain: '+400 מ׳', lodge: 'tent', desc: 'אחד המעברים היפים במסלול.' },
      { title: 'מעבר מות׳ר (4,009 מ׳)', dist: '26 ק"מ', gain: '+309 מ׳ / -709 מ׳', lodge: 'tent', desc: 'המעבר הצפוני הגבוה במסלול.' },
      { title: 'עמק סקוויר לייק', dist: '21 ק"מ', gain: '+300 מ׳', lodge: 'tent', desc: 'אזור שקט עם דגי טראוט באגמים.' },
      { title: 'רה טרייל / ווננה לייק', dist: '23 ק"מ', gain: '+300 מ׳', lodge: 'tent', desc: 'התקרבות לאזור פורסטר פאס.' },
      { title: 'מעבר פורסטר', dist: '20 ק"מ', gain: '+400 מ׳', lodge: 'tent', desc: 'הכניסה לפארק הלאומי קינגס קניון.' },
      { title: 'עמק קר לייק', dist: '19 ק"מ', gain: '-400 מ׳', lodge: 'tent', desc: 'יום מנוחה יחסי לפני הפסגה הגבוהה בארה"ב.' },
      { title: 'הר וויטני (4,421 מ׳)', dist: '27 ק"מ', gain: '+521 מ׳ / -821 מ׳', lodge: 'tent', desc: 'הפסגה הגבוהה ביותר ב-48 המדינות הסמוכות בארה"ב.' },
      { title: 'ירידה לוובל פורטל (סיום)', dist: '18 ק"מ', gain: '-1100 מ׳', lodge: 'hotel', desc: 'סיום המסלול וחזרה לציביליזציה.' },
    ],
  },
];

function daysToRange(days: number): DaysRange {
  if (days <= 4) return 'short';
  if (days <= 8) return 'medium';
  if (days <= 14) return 'long';
  return 'xlong';
}

const RANGE_ORDER: DaysRange[] = ['short', 'medium', 'long', 'xlong'];

function scoreCuratedTrek(trek: Trek, req: { regions: string[]; days: DaysRange; difficulty: TrekDifficulty; lodging: string[] }): number {
  let score = 40;
  if (req.regions.includes('any') || req.regions.includes(trek.region)) score += 28;
  const trekRange = daysToRange(trek.days);
  if (req.days === trekRange) score += 20;
  else if (Math.abs(RANGE_ORDER.indexOf(req.days) - RANGE_ORDER.indexOf(trekRange)) === 1) score += 8;
  if (req.difficulty === trek.difficulty) score += 14;
  else if (req.difficulty === 'moderate' && trek.difficulty !== 'moderate') score += 4;
  const overlap = trek.lodging.filter((l) => req.lodging.includes(l) || (req.lodging.includes('refuge') && l === 'teahouse')).length;
  score += Math.min(overlap * 7, 18);
  return Math.min(Math.round(score), 99);
}

function fallbackTreks(req: { regions: string[]; days: DaysRange; difficulty: TrekDifficulty; lodging: string[] }): Trek[] {
  return CURATED_TREKS.map((t) => ({ ...t, matchScore: scoreCuratedTrek(t, req) })).sort((a, b) => b.matchScore - a.matchScore);
}

async function writeCache(DB: D1Database, cacheKey: string, treks: Trek[]) {
  try {
    await DB.prepare(
      `INSERT INTO trek_plan_cache (cache_key, response, created_at) VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET response = excluded.response, created_at = excluded.created_at`
    ).bind(cacheKey, JSON.stringify(treks), new Date().toISOString()).run();
  } catch {
    // caching is best-effort; a failed write shouldn't fail the request
  }
}

trekRoutes.post('/plan', async (c) => {
  const body = await c.req.json<TrekPlanRequest>().catch(() => ({}) as TrekPlanRequest);
  const regions = body.regions?.length ? body.regions : ['any'];
  const days: DaysRange = body.days ?? 'medium';
  const difficulty: TrekDifficulty = body.difficulty ?? 'moderate';
  const lodging = body.lodging?.length ? body.lodging : ['tent', 'refuge', 'guesthouse', 'hotel'];

  const normalizedReq = { regions, days, difficulty, lodging };

  // Same preferences reuse the last result (treks and their photos don't go stale
  // fast) instead of re-paying for a fresh Anthropic call + web searches + image
  // lookups every time — this doubles as a growing "already searched" library.
  const cacheKey = JSON.stringify({
    regions: [...regions].sort(),
    days,
    difficulty,
    lodging: [...lodging].sort(),
  });
  try {
    const cached = await c.env.DB.prepare(`SELECT response FROM trek_plan_cache WHERE cache_key = ?`)
      .bind(cacheKey)
      .first<{ response: string }>();
    if (cached) {
      return c.json({ treks: JSON.parse(cached.response) as Trek[], usingFallback: false, usingCache: true });
    }
  } catch {
    // cache miss/read failure — fall through to a live lookup
  }

  const apiKey = await getAnthropicApiKey(c.env);
  if (!apiKey) {
    const treks = await enrichWithPhotos(fallbackTreks(normalizedReq));
    await writeCache(c.env.DB, cacheKey, treks);
    return c.json({ treks, usingFallback: true });
  }

  try {
    const client = new Anthropic({ apiKey });
    const regionText = regions.map((r) => REGION_LABELS[r] ?? r).join(', ');
    const lodgingText = lodging.map((l) => LODGING_LABELS[l as TrekLodging] ?? l).join(', ');

    const response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: TREK_SCHEMA },
      },
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
      system:
        'אתה עוזר לגילוי מסלולי טרק בתוך אפליקציית תכנון טיולים. בהינתן ההעדפות של המשתמש, ' +
        'השתמש בכלי חיפוש האינטרנט כדי למצוא 5 מסלולי טרק רב-יומיים אמיתיים, קיימים בפועל ומתועדים היטב, שמתאימים להעדפות. ' +
        'ענה אך ורק לפי מבנה ה-JSON שסופק, בלי טקסט נוסף. כל השדות הטקסטואליים (שם, מדינה, תיאור, כותרות ותיאורי הימים) צריכים להיות בעברית. ' +
        'ודא שאורך המערכים stages ו-dayPlan תואם למספר הימים (days), ושה-stages משקפים בצורה גסה את פרופיל הגובה האמיתי של כל יום.',
      messages: [
        {
          role: 'user',
          content:
            `אזור מועדף: ${regionText}\n` +
            `משך הטרק: ${DAYS_LABELS[days]}\n` +
            `רמת ניסיון: ${DIFFICULTY_LABELS[difficulty]}\n` +
            `העדפת לינה: ${lodgingText}\n\n` +
            'מצא לי 5 מסלולי טרק מתאימים.',
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') throw new Error('no text block in Anthropic response');
    const parsed = JSON.parse(textBlock.text) as { treks: Trek[] };
    if (!Array.isArray(parsed.treks) || parsed.treks.length === 0) throw new Error('empty treks array');

    const treks = await enrichWithPhotos(parsed.treks);
    await writeCache(c.env.DB, cacheKey, treks);

    return c.json({ treks, usingFallback: false });
  } catch (err) {
    const treks = await enrichWithPhotos(fallbackTreks(normalizedReq));
    await writeCache(c.env.DB, cacheKey, treks);
    return c.json({
      treks,
      usingFallback: true,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
