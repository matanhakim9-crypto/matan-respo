const LODGE_ICON = {
  tent: '⛺', guesthouse: '🏡', teahouse: '🍵', lodge: '🛖', refuge: '🏔️', hotel: '🏨',
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
      { v: 'israel', i: '🇮🇱', t: 'ישראל וסביבה' },
      { v: 'europe', i: '🏔️', t: 'אירופה', s: 'אלפים, פירנאים' },
      { v: 'asia', i: '🏯', t: 'אסיה', s: 'הימלאיה ומעבר לה' },
      { v: 'south-america', i: '🗻', t: 'דרום אמריקה', s: 'אנדים, פטגוניה' },
      { v: 'africa', i: '🏜️', t: 'אפריקה', s: 'אטלס, קילימנג׳רו' },
      { v: 'north-america', i: '🌲', t: 'צפון אמריקה', s: 'סיירה נבדה, רוקיז' },
      { v: 'any', i: '🌍', t: 'פתוח לכל אפשרות' },
    ],
  },
  {
    key: 'days', title: 'כמה ימים יש לך פנויים לטרק עצמו?', multi: false,
    opts: [
      { v: 'short', i: '📅', t: '2–4 ימים' },
      { v: 'medium', i: '📅', t: '5–8 ימים' },
      { v: 'long', i: '📅', t: '9–14 ימים' },
      { v: 'xlong', i: '📅', t: 'מעל שבועיים' },
    ],
  },
  {
    key: 'difficulty', title: 'מה רמת הכושר / הניסיון שלך בטרקים?', multi: false,
    opts: [
      { v: 'easy', i: '🟢', t: 'מתחיל', s: 'הליכות יומיות קלות' },
      { v: 'moderate', i: '🟡', t: 'מנוסה', s: 'טיפוסים משמעותיים, כושר סביר' },
      { v: 'hard', i: '🔴', t: 'מקצועני', s: 'ימים ארוכים, גבהים, תנאי שטח קשים' },
    ],
  },
  {
    key: 'lodging', title: 'איך תרצה/י לישון בדרך?', multi: true,
    opts: [
      { v: 'tent', i: '⛺', t: 'אוהל / קמפינג פראי' },
      { v: 'refuge', i: '🏔️', t: 'בקתות / רפוז׳ים הרריים' },
      { v: 'guesthouse', i: '🏡', t: 'בתי הארחה / לודג׳ים' },
      { v: 'hotel', i: '🏨', t: 'מלונות בקצוות המסלול' },
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
        return `<div class="opt ${isSel ? 'selected' : ''}" data-v="${o.v}">
          <div class="oi">${o.i}</div>
          <div class="ot">${o.t}${o.s ? `<small>${o.s}</small>` : ''}</div>
          <div class="opt-check"><svg viewBox="0 0 24 24" fill="none"><path d="M4 12l5 5L20 6" stroke="#1B2B2F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
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

function elevationSVG(stages, w = 400, h = 108, strokeColor = '#E8A33D', fillOpacity = 0.16) {
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
  const payload = {
    regions: answers.region || ['any'],
    days: answers.days,
    difficulty: answers.difficulty,
    lodging: answers.lodging || [],
  };
  try {
    const res = await fetch('/api/trek/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    showResults(data.treks || [], !!data.usingFallback);
  } catch (err) {
    showResults([], true);
  }
}

function showResults(treks, usingFallback) {
  lastResults = [...treks].sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
  document.getElementById('results-sub').textContent =
    `${lastResults.length} טרקים לפי ${QUESTIONS.length} ההעדפות שסימנת — ממוינים לפי רמת התאמה.`;

  const list = document.getElementById('results-list');
  list.innerHTML = lastResults.map((t, i) => `
    <div class="trek-card ${i === 0 ? 'top-match' : ''}" data-id="${t.id}">
      <div class="profile-wrap">
        ${elevationSVG(t.stages)}
        <div class="match-badge">${t.matchScore ?? '–'}% התאמה</div>
        <div class="region-tag">${t.country}</div>
      </div>
      <div class="trek-body">
        <h3 class="trek-name">${t.name}</h3>
        <p class="trek-loc">${t.blurb}</p>
        <div class="trek-stats">
          <span class="diff-pill ${DIFF_CLASS[t.difficulty] || ''}">${DIFF_LABEL[t.difficulty] || t.difficulty}</span>
          <div class="stat">📅 <b>${t.days}</b> ימים</div>
          <div class="stat">📏 <b>${t.distance}</b> ק"מ</div>
          <div class="stat">⛰️ <b>${(t.gain || 0).toLocaleString()}</b> מ׳ טיפוס</div>
        </div>
      </div>
    </div>
  `).join('');
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

function showDetail(id) {
  const t = lastResults.find((x) => x.id === id);
  if (!t) return;
  const c = document.getElementById('detail-content');
  const flightUrl = `https://www.google.com/travel/flights?q=${encodeURIComponent('טיסות ל' + t.country)}`;
  const hotelUrl = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(t.country)}`;
  c.innerHTML = `
    <div class="detail-hero">
      <div class="back-row" id="backToResults">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="#A9B8B7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="scale(-1,1) translate(-24,0)"/></svg>
        חזרה לתוצאות
      </div>
      <div class="detail-profile">${elevationSVG(t.stages, 400, 150)}</div>
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 16l20-8-8 20-2-8-8-2z"/></svg>
          חיפוש טיסות
        </a>
        <a class="action-btn" href="${hotelUrl}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 21V8l9-5 9 5v13M9 21v-6h6v6"/></svg>
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
              <span>📏 ${d.dist}</span>
              <span>⛰️ ${d.gain}</span>
              <span class="lodge-tag">${LODGE_ICON[d.lodge] || ''} ${LODGE_LABEL[d.lodge] || d.lodge}</span>
            </div>
            <p class="day-desc">${d.desc}</p>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  document.getElementById('backToResults').addEventListener('click', () => showScreen('screen-results'));
  showScreen('screen-detail');
}

renderQuestion();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/trek/sw.js').catch(() => {});
  });
}
