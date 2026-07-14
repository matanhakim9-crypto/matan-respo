# Dividend Tracker

מעקב אחרי מניות דיבידנד, תשלומים צפויים ותשואה שנתית. רץ כ-Cloudflare Worker
(Hono + D1), עם פרונט־אנד סטטי שמותקן בטלפון כ-PWA.

## מבנה הפרויקט

- `src/index.ts` — ה-Worker: API routes (`/api/holdings`, `/api/dividends`, `/api/quote/:ticker`, `/api/summary`) ו-DB queries מול D1.
- `schema.sql` — סכימת D1: `holdings`, `dividend_payments`, `quote_cache`.
- `public/` — הפרונט־אנד הסטטי (HTML/CSS/JS רגיל, בלי בילד סטפ) + קבצי ה-PWA (`manifest.json`, `sw.js`, אייקונים).
- `wrangler.toml` — קונפיגורציית ה-Worker, כולל bind ל-D1 ול-static assets.

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
