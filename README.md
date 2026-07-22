# Dividend Tracker + מתכנן הטרקים

מעקב אחרי מניות דיבידנד, תשלומים צפויים ותשואה שנתית. רץ כ-Cloudflare Worker
(Hono + D1), עם פרונט־אנד סטטי שמותקן בטלפון כ-PWA.

הריפו כולל גם אפליקציה שנייה, נפרדת לגמרי: **מתכנן הטרקים** (`/trek/`) — עונה
על כמה שאלות (אזור, ימים, רמת קושי, סוג לינה) ומציע מסלולי טרק רב-יומיים
מתאימים, עם חלוקה יומית וקישורים לחיפוש טיסות ומלונות. פרטים בהמשך.

## מבנה הפרויקט

- `src/index.ts` — ה-Worker: API routes (`/api/holdings`, `/api/dividends`, `/api/quote/:ticker`, `/api/summary`) ו-DB queries מול D1.
- `src/trek.ts` — ה-API של מתכנן הטרקים (`/api/trek/plan`), נטען נפרד ולא דורש התחברות.
- `schema.sql` — סכימת D1: `holdings`, `dividend_payments`, `quote_cache`, `app_settings` (גם למפתחות ה-API של הדיווידנד טראקר וגם למפתח ה-Anthropic של הטרקים).
- `public/` — הפרונט־אנד הסטטי של הדיווידנד טראקר (HTML/CSS/JS רגיל, בלי בילד סטפ) + קבצי ה-PWA (`manifest.json`, `sw.js`, אייקונים).
- `public/trek/` — הפרונט־אנד הסטטי של מתכנן הטרקים, עם ה-PWA שלו (manifest/sw נפרדים, scope `/trek/`).
- `wrangler.toml` — קונפיגורציית ה-Worker, כולל bind ל-D1, static assets, ו-`nodejs_compat` (נדרש ל-SDK של Anthropic).

## הרצה מקומית

```bash
npm install
wrangler d1 create dividend-tracker-db   # פעם ראשונה בלבד — הדבק את ה-database_id ל-wrangler.toml
npm run db:migrate:local
npm run dev
```

## פריסה (deploy)

```bash
wrangler login                # פעם ראשונה בלבד
npm run db:migrate:remote     # מריץ את schema.sql מול ה-D1 האמיתי
wrangler secret put ALPHA_VANTAGE_API_KEY   # מפתח API חינמי מ-alphavantage.co/support/#api-key
npm run deploy
```

## הערות

- מחירי מניות מגיעים מ-Alpha Vantage (`GLOBAL_QUOTE`) ונשמרים בקאש ב-D1 ל-15 דקות, כדי לא לחרוג ממכסת הבקשות של החינמי (25/יום).
- כדי להוסיף אפליקציה למסך הבית בטלפון: פתחו את הכתובת שקיבלתם מ-`wrangler deploy`, ואז iOS: Safari → שיתוף → "הוסף למסך הבית". Android: Chrome → תפריט → "התקנת אפליקציה".

## מתכנן הטרקים (`/trek/`)

אפליקציה נפרדת באותו Worker — לא דורשת התחברות/משתמש, ולא נוגעת בנתוני
הדיווידנד טראקר. אחרי 4 שאלות קצרות (אזור, ימים, רמת קושי, סוג לינה), ה-Worker
פונה ל-Claude API (Anthropic) עם כלי חיפוש אינטרנט (`web_search`) כדי למצוא 5
מסלולי טרק אמיתיים ומתועדים שמתאימים, כולל חלוקה יומית ופרופיל גובה. כפתורי
"חיפוש טיסות"/"מלונות" הם דיפ-לינק ל-Google Flights/Booking.com — בלי API
נוסף.

**בלי מפתח Anthropic מוגדר** (או אם הקריאה נכשלת מכל סיבה — כולל timeout),
האפליקציה חוזרת אוטומטית לרשימת 6 מסלולים לדוגמה קבועה בקוד, כדי שהיא תמיד
עובדת. הקריאה החיה מסתמנת בתשובה (`usingFallback: true/false`) ובהערה שמוצגת
למשתמש במסך התוצאות.

כדי להפעיל את החיפוש האמיתי, הוסיפו מפתח Anthropic ל-D1 (אותו pattern כמו
`fmp_api_key`/`alpha_vantage_api_key` הקיימים — טבלת `app_settings`, לא
`wrangler secret`):

```bash
npx wrangler d1 execute dividend-tracker-db --remote \
  --command "INSERT INTO app_settings (key, value) VALUES ('anthropic_api_key', 'sk-ant-...')"
```

(להרצה מקומית: אותה פקודה עם `--local` במקום `--remote`.)
