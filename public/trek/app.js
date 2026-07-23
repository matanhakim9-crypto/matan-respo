// consistent line-icon set (24x24, stroke=currentColor) — same style as the brand mark / action buttons
function icon(path, extra) {
  return `<svg viewBox="0 0 24 24" fill="none">${path}</svg>`;
}
const ICONS = {
  pin: icon('<path d="M12 21s7-7.9 7-12.5A7 7 0 0 0 5 8.5C5 13.1 12 21 12 21Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><circle cx="12" cy="8.5" r="2.3" stroke="currentColor" stroke-width="1.9"/>'),
  mountains: icon('<path d="M2.5 18.5 8 9.5l3 4.5 2.3-3.4 8.2 7.9H2.5Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M6.5 12.3 8 9.5l1.1 1.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'),
  pagoda: icon('<path d="M12 3l3 3.4H9L12 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5 9.4h14l-1.6 2.6H6.6L5 9.4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.5 12v6.5M14.5 12v6.5M4 20.5h16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'),
  peak: icon('<path d="M2.5 19 10 5l3 5.5L15.5 8l6 11H2.5Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>'),
  sun: icon('<circle cx="12" cy="9" r="3.3" stroke="currentColor" stroke-width="1.9"/><path d="M3 19.5c2-3 5.4-4.5 9-4.5s7 1.5 9 4.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'),
  pine: icon('<path d="M12 3l4 6h-2.4l3.4 5.4h-3.2L17 19H7l3.2-4.6H7l3.4-5.4H8L12 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 19v2.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'),
  globe: icon('<circle cx="12" cy="12" r="8.3" stroke="currentColor" stroke-width="1.9"/><path d="M3.7 12h16.6M12 3.7c2.5 2.3 3.9 5.2 3.9 8.3s-1.4 6-3.9 8.3c-2.5-2.3-3.9-5.2-3.9-8.3S9.5 6 12 3.7Z" stroke="currentColor" stroke-width="1.4"/>'),
  calendar: icon('<rect x="3.3" y="5" width="17.4" height="15.5" rx="2.4" stroke="currentColor" stroke-width="1.9"/><path d="M3.3 9.6h17.4M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'),
  tent: icon('<path d="M3 19 11 5l1 2-6 12H3Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M13 5l8 14h-6l-4.8-9.5" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M9 19l2.3-4.4L13.5 19" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'),
  cabin: icon('<path d="M3.5 11 12 4l8.5 7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 9.6V20h13V9.6" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M10 20v-5h4v5" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>'),
  house: icon('<path d="M4 11 12 4.5 20 11" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 9.5V20h12V9.5" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><rect x="10" y="14" width="4" height="6" stroke="currentColor" stroke-width="1.5"/>'),
  hotel: icon('<path d="M3 21V8l9-5 9 5v13" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M9 21v-6h6v6" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>'),
  route: icon('<circle cx="5" cy="19" r="1.7" fill="currentColor"/><circle cx="19" cy="5" r="1.7" fill="currentColor"/><path d="M6.3 17.7 17.7 6.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="0.4 3"/>'),
  trendUp: icon('<path d="M3 17 9 10l4 3 7-9" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 5h4v4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>'),
};
function statIcon(name) { return `<span class="stat-ic">${ICONS[name]}</span>`; }
function diffIcon(level) {
  const bars = [8, 13, 18];
  const fillCount = level === 'easy' ? 1 : level === 'moderate' ? 2 : 3;
  const rects = bars.map((h, i) => {
    const x = 5 + i * 6;
    const filled = i < fillCount;
    return `<rect x="${x}" y="${20 - h}" width="3.4" height="${h}" rx="1" ${filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.3"'}/>`;
  }).join('');
  return `<svg viewBox="0 0 24 24" fill="none">${rects}</svg>`;
}

const LODGE_ICON_SVG = {
  tent: ICONS.tent, guesthouse: ICONS.house, teahouse: ICONS.house, lodge: ICONS.cabin, refuge: ICONS.cabin, hotel: ICONS.hotel,
};
const LODGE_LABEL = {
  tent: 'אוהל', guesthouse: 'בית הארחה', teahouse: 'טי-האוס', lodge: 'לודג׳', refuge: 'רפוז׳ הררי', hotel: 'מלון',
};
const DIFF_LABEL = { easy: 'קל', moderate: 'בינוני', hard: 'קשה/מקצועני' };
const DIFF_CLASS = { easy: 'diff-easy', moderate: 'diff-mod', hard: 'diff-hard' };

const QUESTIONS = [
  {
    key: 'region', title: 'לאיזה אזור בעולם בא לך לטרוק?', multi: true,
    opts: [
      { v: 'israel', i: ICONS.pin, t: 'ישראל וסביבה' },
      { v: 'europe', i: ICONS.mountains, t: 'אירופה', s: 'אלפים, פירנאים' },
      { v: 'asia', i: ICONS.pagoda, t: 'אסיה', s: 'הימלאיה ומעבר לה' },
      { v: 'south-america', i: ICONS.peak, t: 'דרום אמריקה', s: 'אנדים, פטגוניה' },
      { v: 'africa', i: ICONS.sun, t: 'אפריקה', s: 'אטלס, קילימנג׳רו' },
      { v: 'north-america', i: ICONS.pine, t: 'צפון אמריקה', s: 'סיירה נבדה, רוקיז' },
      { v: 'any', i: ICONS.globe, t: 'פתוח לכל אפשרות' },
    ],
  },
  {
    key: 'days', title: 'כמה ימים יש לך פנויים לטרק עצמו?', multi: false,
    opts: [
      { v: 'short', i: ICONS.calendar, t: '2–4 ימים' },
      { v: 'medium', i: ICONS.calendar, t: '5–8 ימים' },
      { v: 'long', i: ICONS.calendar, t: '9–14 ימים' },
      { v: 'xlong', i: ICONS.calendar, t: 'מעל שבועיים' },
    ],
  },
  {
    key: 'difficulty', title: 'מה רמת הכושר / הניסיון שלך בטרקים?', multi: false,
    opts: [
      { v: 'easy', i: diffIcon('easy'), t: 'מתחיל', s: 'הליכות יומיות קלות', cls: 'diff-easy' },
      { v: 'moderate', i: diffIcon('moderate'), t: 'מנוסה', s: 'טיפוסים משמעותיים, כושר סביר', cls: 'diff-mod' },
      { v: 'hard', i: diffIcon('hard'), t: 'מקצועני', s: 'ימים ארוכים, גבהים, תנאי שטח קשים', cls: 'diff-hard' },
    ],
  },
  {
    key: 'lodging', title: 'איך תרצה/י לישון בדרך?', multi: true,
    opts: [
      { v: 'tent', i: ICONS.tent, t: 'אוהל / קמפינג פראי' },
      { v: 'refuge', i: ICONS.cabin, t: 'בקתות / רפוז׳ים הרריים' },
      { v: 'guesthouse', i: ICONS.house, t: 'בתי הארחה / לודג׳ים' },
      { v: 'hotel', i: ICONS.hotel, t: 'מלונות בקצוות המסלול' },
    ],
  },
];

let currentQ = 0;
const answers = {};
let lastResults = [];

function renderWaypoints() {
  const wrap = document.getElementById('waypoints');
  wrap.innerHTML = '';
  QUESTIONS.forEach((q, i) => {
    const dot = document.createElement('div');
    dot.className = 'wp-dot' + (i < currentQ ? ' done' : i === currentQ ? ' current' : '');
    wrap.appendChild(dot);
    if (i < QUESTIONS.length - 1) {
      const line = document.createElement('div');
      line.className = 'wp-line';
      wrap.appendChild(line);
    }
  });
}

function renderQuestion() {
  const q = QUESTIONS[currentQ];
  const c = document.getElementById('q-content');
  const selected = answers[q.key] || (q.multi ? [] : null);
  c.innerHTML = `
    <div class="q-eyebrow">שאלה ${currentQ + 1} מתוך ${QUESTIONS.length}</div>
    <h2 class="q-title">${q.title}</h2>
    ${q.multi ? '<div class="multi-hint">ניתן לבחור כמה שרוצים</div>' : ''}
    <div class="options">
      ${q.opts.map((o) => {
        const isSel = q.multi ? selected.includes(o.v) : selected === o.v;
        return `<div class="opt ${isSel ? 'selected' : ''} ${o.cls || ''}" data-v="${o.v}">
          <div class="oi">${o.i}</div>
          <div class="ot">${o.t}${o.s ? `<small>${o.s}</small>` : ''}</div>
          <div class="opt-check"><svg viewBox="0 0 24 24" fill="none"><path d="M4 12l5 5L20 6" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        </div>`;
      }).join('')}
    </div>
  `;
  c.querySelectorAll('.opt').forEach((el) => {
    el.addEventListener('click', () => {
      const v = el.dataset.v;
      if (q.multi) {
        if (!answers[q.key]) answers[q.key] = [];
        const idx = answers[q.key].indexOf(v);
        if (idx > -1) answers[q.key].splice(idx, 1);
        else answers[q.key].push(v);
      } else {
        answers[q.key] = v;
      }
      renderQuestion();
      updateNextButton();
    });
  });
  renderWaypoints();
  document.getElementById('btnBack').style.display = currentQ > 0 ? 'block' : 'none';
  updateNextButton();
}

function updateNextButton() {
  const q = QUESTIONS[currentQ];
  const val = answers[q.key];
  const has = q.multi ? (val && val.length > 0) : !!val;
  const btn = document.getElementById('btnNext');
  btn.disabled = !has;
  btn.textContent = currentQ === QUESTIONS.length - 1 ? 'מצא לי טרקים' : 'המשך';
}

document.getElementById('btnNext').addEventListener('click', () => {
  if (currentQ < QUESTIONS.length - 1) {
    currentQ++;
    renderQuestion();
  } else {
    fetchResults();
  }
});
document.getElementById('btnBack').addEventListener('click', () => {
  if (currentQ > 0) { currentQ--; renderQuestion(); }
});
document.getElementById('btnRestart').addEventListener('click', () => {
  currentQ = 0;
  Object.keys(answers).forEach((k) => delete answers[k]);
  showScreen('screen-questions');
  renderQuestion();
});

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.getElementById('topbar').style.display = id === 'screen-questions' ? 'block' : 'none';
  window.scrollTo(0, 0);
}

function elevationSVG(stages, w = 400, h = 108, strokeColor = '#204B2C', fillOpacity = 0.16) {
  const pts = [];
  (stages || []).forEach((s) => (s.elevs || []).forEach((e) => pts.push(e)));
  if (pts.length < 2) pts.push(0, 1);
  const min = Math.min(...pts), max = Math.max(...pts);
  const range = (max - min) || 1;
  const stepX = w / (pts.length - 1);
  const coords = pts.map((e, i) => {
    const x = i * stepX;
    const y = h - 14 - ((e - min) / range) * (h - 34);
    return [x, y];
  });
  const linePath = coords.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const fillPath = linePath + ` L${w},${h} L0,${h} Z`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <path d="${fillPath}" fill="${strokeColor}" opacity="${fillOpacity}"/>
    <path d="${linePath}" fill="none" stroke="${strokeColor}" stroke-width="2"/>
  </svg>`;
}

async function fetchResults() {
  showScreen('screen-loading');
  const mockToggle = document.getElementById('mockToggle');
  const payload = {
    regions: answers.region || ['any'],
    days: answers.days,
    difficulty: answers.difficulty,
    lodging: answers.lodging || [],
    mock: !!(mockToggle && mockToggle.checked),
  };
  try {
    const res = await fetch('/api/trek/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    await showResults(data.treks || [], !!data.usingFallback);
  } catch (err) {
    await showResults([], true);
  }
}

function showResults(treks, usingFallback) {
  lastResults = [...treks].sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
  document.getElementById('results-sub').textContent =
    `${lastResults.length} טרקים לפי ${QUESTIONS.length} ההעדפות שסימנת — ממוינים לפי רמת התאמה.`;

  const list = document.getElementById('results-list');
  list.innerHTML = lastResults.map((t, i) => {
    const cover = t.photos && t.photos[0];
    return `
    <div class="trek-card ${i === 0 ? 'top-match' : ''}" data-id="${t.id}">
      <div class="profile-wrap" style="${cover ? `background-image:url('${cover}')` : ''}">
        ${cover ? '<div class="scrim"></div>' : elevationSVG(t.stages, 400, 132, '#204B2C', 0.16)}
        <div class="match-badge">${t.matchScore ?? '–'}% התאמה</div>
        <div class="region-tag">${t.country}</div>
      </div>
      <div class="trek-body">
        <h3 class="trek-name">${t.name}</h3>
        <p class="trek-loc">${t.blurb}</p>
        <div class="trek-stats">
          <span class="diff-pill ${DIFF_CLASS[t.difficulty] || ''}">${DIFF_LABEL[t.difficulty] || t.difficulty}</span>
          <div class="stat">${statIcon('calendar')}<b>${t.days}</b> ימים</div>
          <div class="stat">${statIcon('route')}<b>${t.distance}</b> ק"מ</div>
          <div class="stat">${statIcon('trendUp')}<b>${(t.gain || 0).toLocaleString()}</b> מ׳ טיפוס</div>
        </div>
      </div>
    </div>
  `;
  }).join('');
  list.querySelectorAll('.trek-card').forEach((el) => {
    el.addEventListener('click', () => showDetail(el.dataset.id));
  });

  const note = document.getElementById('results-note');
  if (lastResults.length === 0) {
    note.classList.remove('hidden');
    note.textContent = '⚠ לא הצלחנו לטעון הצעות כרגע. נסו שוב בעוד רגע.';
  } else if (usingFallback) {
    note.classList.remove('hidden');
    note.textContent = '⚠ אלו דוגמאות קבועות (לא חיפוש AI חי כרגע) — כדאי לאמת פרטים (מזג אוויר, זמינות בקתות) מול מקור מקומי לפני נסיעה.';
  } else {
    note.classList.remove('hidden');
    note.textContent = '⚠ התוצאות מבוססות על חיפוש AI באינטרנט — כדאי לאמת פרטים (מזג אוויר, זמינות בקתות, מחירים) מול מקור מקומי לפני נסיעה.';
  }

  showScreen('screen-results');
}

let detailBackTarget = 'screen-results';

function showDetail(id) {
  const t = lastResults.find((x) => x.id === id);
  if (!t) return;
  const c = document.getElementById('detail-content');
  const photos = t.photos || [];
  const cover = photos[0];
  const flightUrl = `https://www.google.com/travel/flights?q=${encodeURIComponent('טיסות ל' + t.country)}`;
  const hotelUrl = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(t.country)}`;
  c.innerHTML = `
    <div class="detail-hero">
      <div class="back-row" id="backToResults">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="#66716A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="scale(-1,1) translate(-24,0)"/></svg>
        ${detailBackTarget === 'screen-home' ? 'חזרה' : 'חזרה לתוצאות'}
      </div>
      <div class="detail-profile" style="${cover ? `background-image:url('${cover}')` : ''}">
        ${cover ? '<div class="scrim"></div>' : elevationSVG(t.stages, 400, 190, '#204B2C', 0.16)}
      </div>
      ${photos.length > 1 ? `
        <div class="photo-strip">
          ${photos.map((p) => `<a class="photo-thumb" style="background-image:url('${p}')" href="${p}" target="_blank" rel="noopener"></a>`).join('')}
        </div>
      ` : ''}
      <h1 class="detail-title">${t.name}</h1>
      <p class="detail-loc">${t.country} · ${t.blurb}</p>
      <div class="detail-stats-row">
        <div class="dstat"><b>${t.days}</b><span>ימים</span></div>
        <div class="dstat"><b>${t.distance}</b><span>ק"מ</span></div>
        <div class="dstat"><b>${((t.gain || 0) / 1000).toFixed(1)}K</b><span>טיפוס מ׳</span></div>
        <div class="dstat"><b>${DIFF_LABEL[t.difficulty] || t.difficulty}</b><span>רמת קושי</span></div>
      </div>

      <div class="action-row">
        <a class="action-btn" href="${flightUrl}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M2 16l20-8-8 20-2-8-8-2z"/></svg>
          חיפוש טיסות
        </a>
        <a class="action-btn" href="${hotelUrl}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M3 21V8l9-5 9 5v13M9 21v-6h6v6"/></svg>
          מלונות בקצוות
        </a>
      </div>

      <div class="section-label">חלוקה יומית</div>
      ${(t.dayPlan || []).map((d, i) => `
        <div class="day-item">
          <div class="day-num">${i + 1}</div>
          <div class="day-info">
            <h4>${d.title}</h4>
            <div class="day-meta">
              <span>${statIcon('route')}${d.dist}</span>
              <span>${statIcon('trendUp')}${d.gain}</span>
              <span class="lodge-tag"><span class="stat-ic">${LODGE_ICON_SVG[d.lodge] || ICONS.house}</span>${LODGE_LABEL[d.lodge] || d.lodge}</span>
            </div>
            <p class="day-desc">${d.desc}</p>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  document.getElementById('backToResults').addEventListener('click', () => showScreen(detailBackTarget));
  showScreen('screen-detail');
}

async function loadPopularTreks() {
  const strip = document.getElementById('popularStrip');
  try {
    const res = await fetch('/api/trek/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regions: ['any'], days: 'medium', difficulty: 'moderate', lodging: [], mock: true }),
    });
    const data = await res.json();
    const all = (data.treks || []).sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0)).slice(0, 6);
    const featured = all.find((t) => t.photos && t.photos[0]) || all[0];
    const treks = all.filter((t) => t !== featured);

    if (featured) {
      const featuredEl = document.getElementById('homeFeatured');
      const cover = featured.photos && featured.photos[0];
      if (cover) featuredEl.style.backgroundImage = `url('${cover}')`;
      document.getElementById('homeFeaturedName').textContent = featured.name;
      document.getElementById('homeFeaturedLoc').textContent = featured.country;
      featuredEl.addEventListener('click', () => {
        lastResults = all;
        detailBackTarget = 'screen-home';
        showDetail(featured.id);
      });
    }

    if (!treks.length) { strip.innerHTML = ''; return; }
    strip.innerHTML = treks.map((t) => {
      const cover = t.photos && t.photos[0];
      return `<div class="popular-card" data-id="${t.id}" style="${cover ? `background-image:url('${cover}')` : ''}">
        <div class="scrim"></div>
        <div class="pc-text"><b>${t.name}</b><span>${t.country}</span></div>
      </div>`;
    }).join('');
    strip.querySelectorAll('.popular-card').forEach((el) => {
      el.addEventListener('click', () => {
        lastResults = all;
        detailBackTarget = 'screen-home';
        showDetail(el.dataset.id);
      });
    });
  } catch {
    strip.innerHTML = '';
  }
}

document.getElementById('btnStart').addEventListener('click', () => {
  detailBackTarget = 'screen-results';
  showScreen('screen-questions');
});

renderQuestion();
loadPopularTreks();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/trek/sw.js').catch(() => {});
  });
}
