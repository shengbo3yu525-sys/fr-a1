/* =========================================================
   法语 A1 词汇复习 —— 应用逻辑
   数据与逻辑分离：词库见 data/words.js (window.WORD_BANK)
   ========================================================= */
(function () {
'use strict';

/* ---------- 常量 ---------- */
const LS_STATE = 'frA1.state.v1';
const LS_BANK  = 'frA1.bank.v1';
const INTERVALS = { 1: 1, 2: 3, 3: 7, 4: 15, 5: 30 };   // Leitner 五盒
const LEECH_AT = 5;                                      // 连续错 5 次 → 顽固词
const TYPES = {
  FR_ZH:  { key: 'FR_ZH',  label: '法 → 中', short: '法中', icon: '👁' },
  ZH_FR:  { key: 'ZH_FR',  label: '中 → 法', short: '中法', icon: '✍️' },
  PRON:   { key: 'PRON',   label: '发音',    short: '发音', icon: '🔊' },
  GENDER: { key: 'GENDER', label: '阴阳性',  short: '性',   icon: '⚥' },
  FEM:    { key: 'FEM',    label: '阴性变形', short: '变形', icon: '♀' }
};
const TYPE_ORDER = ['FR_ZH', 'PRON', 'GENDER', 'FEM', 'ZH_FR'];
const ACCENTS = ['é','è','ê','ë','à','â','ù','û','ü','ç','î','ï','ô','œ','æ','’'];
const BOX_COLORS = ['var(--b0)','var(--b1)','var(--b2)','var(--b3)','var(--b4)','var(--b5)'];

/* ---------- 工具 ---------- */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
const pad = n => (n < 10 ? '0' : '') + n;
function todayStr(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function addDays(ds, n) { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return todayStr(d); }
function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function deacc(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function senses(zh) { return String(zh || '').split(/[;；,，、]/).map(s => s.trim()).filter(Boolean); }
let toastTimer = null;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- 词库 ---------- */
let BANK = [];
function loadBank() {
  try {
    const custom = localStorage.getItem(LS_BANK);
    if (custom) { const b = JSON.parse(custom); if (Array.isArray(b) && b.length) { BANK = b; return; } }
  } catch (e) { /* ignore */ }
  BANK = (window.WORD_BANK || []).slice();
}
let BY_ID = {}, ZH_INDEX = {}, ALL_TAGS = [];
function indexBank() {
  BY_ID = {}; ZH_INDEX = {}; const tags = {};
  BANK.forEach(w => {
    BY_ID[w.id] = w;
    senses(w.zh).forEach(s => { (ZH_INDEX[s] = ZH_INDEX[s] || []).push(w.id); });
    (w.tags || []).forEach(t => tags[t] = 1);
  });
  ALL_TAGS = Object.keys(tags).sort();
}

/* 一个单词生成哪些卡片 */
function cardTypesOf(w) {
  const out = ['FR_ZH', 'PRON'];
  if (w.zh) out.push('ZH_FR');
  if (w.genderCard || (w.gender && !w.plural && (w.posBase === 'n.' || /^n\./.test(w.pos || '')))) out.push('GENDER');
  if (w.fem) out.push('FEM');
  return TYPE_ORDER.filter(t => out.indexOf(t) >= 0);
}
function allCards() {
  const out = [];
  BANK.forEach(w => cardTypesOf(w).forEach(t => out.push({ id: w.id + '|' + t, wordId: w.id, type: t })));
  return out;
}

/* ---------- 状态 ---------- */
const DEFAULT_SETTINGS = {
  sessionSize: 20, newPerDay: 10, strict: false, rate: 0.85, theme: 'auto',
  tags: null,                       // null = 全部
  types: { FR_ZH: 1, ZH_FR: 1, PRON: 1, GENDER: 1, FEM: 1 }
};
let S = null;   // { rec:{}, daily:{}, settings:{}, mastered:{} }
function loadState() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(LS_STATE) || 'null'); } catch (e) { raw = null; }
  S = raw && typeof raw === 'object' ? raw : {};
  S.rec = S.rec || {};
  S.daily = S.daily || {};
  S.mastered = S.mastered || {};
  S.settings = Object.assign({}, DEFAULT_SETTINGS, S.settings || {});
  S.settings.types = Object.assign({}, DEFAULT_SETTINGS.types, S.settings.types || {});
}
let saveTimer = null;
function save(now) {
  clearTimeout(saveTimer);
  const doIt = () => {
    try { localStorage.setItem(LS_STATE, JSON.stringify(S)); }
    catch (e) { toast('保存失败：本地存储已满，请先导出备份'); }
  };
  if (now) doIt(); else saveTimer = setTimeout(doIt, 400);
}
/* 记录: [box, due, correct, wrong, consecWrong, leech, lastReviewed] */
function rec(cardId) { return S.rec[cardId]; }
function newRec() { return [1, todayStr(), 0, 0, 0, 0, '']; }
function dailyOf(ds) { return S.daily[ds] || (S.daily[ds] = [0, 0, 0]); }   // [reviewed, correct, newWords]

/* ---------- 调度 ---------- */
function typeEnabled(t) { return !!S.settings.types[t]; }
function tagOk(w) {
  const sel = S.settings.tags;
  if (!sel || !sel.length) return true;
  return (w.tags || []).some(t => sel.indexOf(t) >= 0);
}
function dueCards(ds) {
  ds = ds || todayStr();
  const out = [];
  BANK.forEach(w => {
    if (!tagOk(w)) return;
    cardTypesOf(w).forEach(t => {
      if (!typeEnabled(t)) return;
      const r = S.rec[w.id + '|' + t];
      if (!r || r[5]) return;
      if (r[1] <= ds) out.push({ id: w.id + '|' + t, wordId: w.id, type: t, over: daysBetween(r[1], ds) });
    });
  });
  out.sort((a, b) => b.over - a.over);
  return out;
}
function newWordsAvailable() {
  const out = [];
  BANK.forEach(w => {
    if (!tagOk(w)) return;
    const ts = cardTypesOf(w).filter(typeEnabled);
    if (!ts.length) return;
    if (ts.every(t => !S.rec[w.id + '|' + t])) out.push(w);
  });
  return out;
}
function newLeftToday() {
  const d = dailyOf(todayStr());
  return Math.max(0, S.settings.newPerDay - d[2]);
}
function buildSession(mode) {
  const size = S.settings.sessionSize;
  const ds = todayStr();
  let queue = [];
  if (mode !== 'new') queue = dueCards(ds).slice(0, size);
  let newWords = 0;
  if (mode !== 'due') {
    const room = () => size - queue.length;
    const avail = newWordsAvailable();
    const cap = newLeftToday();
    for (let i = 0; i < avail.length && room() > 0 && newWords < cap; i++) {
      const w = avail[i];
      const cs = cardTypesOf(w).filter(typeEnabled).map(t => ({ id: w.id + '|' + t, wordId: w.id, type: t, isNew: true }));
      if (!cs.length) continue;
      queue = queue.concat(cs.slice(0, Math.max(1, room())));
      newWords++;
    }
  }
  /* 排序：复习卡打乱，新词卡按 识别→产出 的顺序均匀插入 */
  const olds = shuffle(queue.filter(c => !c.isNew));
  const news = queue.filter(c => c.isNew);
  let out;
  if (!olds.length) out = news;
  else if (!news.length) out = olds;
  else {
    out = olds.slice();
    const step = Math.max(1, Math.floor(out.length / (news.length + 1)));
    news.forEach((c, i) => { const p = Math.min(out.length, (i + 1) * step + i); out.splice(p, 0, c); });
  }
  return out;
}

/* 答题结果 → 更新记录  grade: 'good' | 'ok' | 'bad' */
/* countStats=false 用于同一会话内的「再来一次」，只调盒子不重复计数 */
function applyGrade(card, grade, countStats) {
  const ds = todayStr();
  let r = S.rec[card.id];
  const isFirst = !r;
  if (isFirst) r = S.rec[card.id] = newRec();
  const cnt = countStats !== false;
  if (grade === 'good') {
    r[0] = Math.min(5, r[0] + 1); if (cnt) { r[2]++; r[4] = 0; }
  } else if (grade === 'ok') {
    if (cnt) { r[2]++; r[4] = 0; }          // 盒子原地不动
  } else {
    r[0] = 1;
    if (cnt) { r[3]++; r[4]++; if (r[4] >= LEECH_AT) r[5] = 1; }
  }
  r[1] = addDays(ds, INTERVALS[r[0]]);
  r[6] = ds;
  return { isFirst: isFirst };
}
function markWordIntroduced(wordId) {
  const ds = todayStr();
  S.introd = S.introd || {};
  const k = ds + '|' + wordId;
  if (S.introd[k]) return;
  S.introd[k] = 1;
  dailyOf(ds)[2]++;
  /* 清理旧的 introd 键，避免无限增长 */
  const keys = Object.keys(S.introd);
  if (keys.length > 400) keys.forEach(x => { if (x.slice(0, 10) !== ds) delete S.introd[x]; });
}

/* ---------- 判分 ---------- */
function normAns(s) {
  return String(s || '').trim().toLowerCase()
    .replace(/[’´`]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:¿¡"“”]/g, '');
}
function stripArt(s) { return s.replace(/^(les|le|la|l'|un|une|des|du|de la)\s*/, '').trim(); }
function acceptedFor(w, type) {
  const set = new Set();
  const add = x => { if (x) { set.add(normAns(x)); set.add(stripArt(normAns(x))); } };
  if (type === 'FEM') { add(w.fem); return set; }
  add(w.fr); add(w.fem);
  if (w.article) add(w.article + ' ' + w.fr);
  senses(w.zh).forEach(s => (ZH_INDEX[s] || []).forEach(id => { const o = BY_ID[id]; if (o) { add(o.fr); add(o.fem); } }));
  return set;
}
/** 返回 {ok, accentOnly, matched} */
function judge(input, w, type) {
  const acc = acceptedFor(w, type);
  const a = stripArt(normAns(input));
  if (!a) return { ok: false, accentOnly: false };
  if (acc.has(a) || acc.has(normAns(input))) return { ok: true, accentOnly: false };
  const da = deacc(a);
  let hit = null;
  acc.forEach(x => { if (!hit && deacc(x) === da) hit = x; });
  if (hit) return { ok: !S.settings.strict, accentOnly: true, matched: hit };
  return { ok: false, accentOnly: false };
}
function otherAnswers(w, type) {
  if (type !== 'ZH_FR') return [];
  const out = [];
  senses(w.zh).forEach(s => (ZH_INDEX[s] || []).forEach(id => {
    const o = BY_ID[id];
    if (o && o.id !== w.id && out.indexOf(o.fr) < 0) out.push(o.fr);
  }));
  return out;
}

/* ---------- 发音 ---------- */
let frVoice = null, voiceWarned = false;
function pickVoice() {
  const vs = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
  frVoice = vs.find(v => /^fr[-_]FR/i.test(v.lang)) || vs.find(v => /^fr/i.test(v.lang)) || null;
}
if (window.speechSynthesis) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
function speak(text) {
  if (!window.speechSynthesis) { toast('这个浏览器不支持语音朗读'); return; }
  pickVoice();
  if (!frVoice && !voiceWarned) {
    voiceWarned = true;
    toast('未检测到法语语音包：iOS 请到 设置 → 辅助功能 → 朗读内容 → 声音 下载法语；安卓在 设置 → 语言 → 文字转语音 里下载。');
  }
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    if (frVoice) u.voice = frVoice;
    u.rate = S.settings.rate;
    speechSynthesis.speak(u);
  } catch (e) { toast('朗读失败'); }
}

/* =========================================================
   视图切换
   ========================================================= */
const TITLES = { home: '法语 A1 词汇复习', study: '学习', stats: '统计', words: '词表', more: '更多' };
let currentView = 'home';
function show(v) {
  currentView = v;
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  $$('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.v === v));
  $('#topTitle').textContent = TITLES[v];
  window.scrollTo(0, 0);
  if (v === 'home') renderHome();
  if (v === 'stats') renderStats();
  if (v === 'words') renderWords();
  if (v === 'more') { renderLeech(); renderSettings(); }
}
$$('nav.tabs button').forEach(b => b.onclick = () => show(b.dataset.v));

/* ---------- 主题 ---------- */
function applyTheme() {
  const t = S.settings.theme;
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.setAttribute('content', dark ? '#14161a' : '#f6f7f9');
}
$('#themeBtn').onclick = () => {
  const order = ['auto', 'light', 'dark'];
  S.settings.theme = order[(order.indexOf(S.settings.theme) + 1) % 3];
  applyTheme(); save(); renderSettings();
  toast('主题：' + { auto: '跟随系统', light: '浅色', dark: '深色' }[S.settings.theme]);
};
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

/* =========================================================
   首页
   ========================================================= */
function renderHome() {
  const due = dueCards();
  $('#dueCount').textContent = due.length;
  $('#newLeft').textContent = Math.min(newLeftToday(), newWordsAvailable().length);
  const d = dailyOf(todayStr());
  $('#tdReviewed').textContent = d[0];
  $('#tdCorrect').textContent = d[0] ? Math.round(d[1] / d[0] * 100) + '%' : '—';
  $('#tdNew').textContent = d[2];
  $('#tdLeech').textContent = Object.keys(S.rec).filter(k => S.rec[k][5]).length;
  $('#streakNum').textContent = streak();
  renderTagFilter();
  $('#startBtn').textContent = due.length
    ? '开始复习 · ' + Math.min(due.length, S.settings.sessionSize) + ' 张'
    : '开始今天的学习';
}
function streak() {
  let n = 0, d = todayStr();
  if (!(S.daily[d] && S.daily[d][0])) d = addDays(d, -1);
  while (S.daily[d] && S.daily[d][0]) { n++; d = addDays(d, -1); }
  return n;
}
function renderTagFilter() {
  const box = $('#tagFilter'); box.innerHTML = '';
  const sel = S.settings.tags;
  ALL_TAGS.forEach(t => {
    const b = document.createElement('button');
    b.className = 'tagbtn' + ((!sel || sel.indexOf(t) >= 0) ? ' on' : '');
    const n = BANK.filter(w => (w.tags || []).indexOf(t) >= 0).length;
    b.innerHTML = esc(t) + ' <span class="tiny" style="opacity:.7">' + n + '</span>';
    b.onclick = () => {
      let cur = S.settings.tags ? S.settings.tags.slice() : ALL_TAGS.slice();
      const i = cur.indexOf(t);
      if (i >= 0) cur.splice(i, 1); else cur.push(t);
      if (!cur.length) cur = ALL_TAGS.slice();
      S.settings.tags = cur.length === ALL_TAGS.length ? null : cur;
      save(); renderHome();
    };
    box.appendChild(b);
  });
}
$('#tagAll').onclick = () => { S.settings.tags = null; save(); renderHome(); };
$('#startBtn').onclick = () => startSession('mix');
$('#startNewOnly').onclick = () => startSession('new');
$('#startDueOnly').onclick = () => startSession('due');

/* =========================================================
   学习会话
   ========================================================= */
let SESS = null;
function startSession(mode) {
  const q = buildSession(mode);
  if (!q.length) {
    if (mode === 'new') toast('今天的新词额度用完了，或所选单元没有新词');
    else if (mode === 'due') toast('没有到期的复习卡 🎉');
    else toast('今天没有要学的了 🎉 可以去设置里调高每日新词上限');
    return;
  }
  SESS = {
    queue: q, i: 0, total: q.length, started: Date.now(),
    answered: {}, right: 0, wrong: 0, newWords: 0, newSeen: {}, wrongList: [], revealed: false
  };
  show('study');
  $('#studyEmpty').style.display = 'none';
  $('#studyDone').style.display = 'none';
  $('#studyMain').style.display = '';
  renderCard();
}
$('#quitBtn').onclick = () => {
  if (!SESS) return show('home');
  if (confirm('结束本次会话？已答的记录会保留。')) { finishSession(); }
};
$('#homeBtn').onclick = () => { SESS = null; show('home'); };
$('#againBtn').onclick = () => startSession('mix');

function progress() {
  const done = Object.keys(SESS.answered).length;
  $('#progFill').style.width = (SESS.total ? done / SESS.total * 100 : 0) + '%';
  $('#progText').textContent = done + '/' + SESS.total;
}
function currentCard() { return SESS.queue[SESS.i]; }

function renderCard() {
  if (!SESS) return;
  if (SESS.i >= SESS.queue.length) return finishSession();
  progress();
  const c = currentCard(), w = BY_ID[c.wordId];
  if (!w) { SESS.i++; return renderCard(); }
  const r = S.rec[c.id];
  SESS.revealed = false;
  const qc = $('#qcard'), ia = $('#inputArea'), ga = $('#gradeArea');
  ia.innerHTML = ''; ga.innerHTML = '';
  const badge = '<div class="qtype">' + TYPES[c.type].icon + ' ' + TYPES[c.type].label +
    (c.isNew && !r ? ' · <span style="color:var(--accent)">新词</span>' : (r ? ' · 盒' + r[0] : '')) + '</div>';
  const posChip = w.pos ? '<span class="chip">' + esc(w.pos) + '</span>' : '';

  if (c.type === 'FR_ZH') {
    qc.innerHTML = badge + '<div class="qword">' + esc(w.fr) + '</div>' +
      (w.ipa ? '<div class="qipa">' + esc(w.ipa) + '</div>' : '') +
      '<div class="qhint">' + posChip + '</div>';
    ga.innerHTML = '<button class="btn primary block" id="revealBtn">显示答案</button>';
    $('#revealBtn').onclick = () => reveal(c, w, null);

  } else if (c.type === 'ZH_FR') {
    const others = otherAnswers(w, 'ZH_FR');
    qc.innerHTML = badge + '<div class="qword zh">' + esc(w.zh.replace(/;/g, '；')) + '</div>' +
      '<div class="qhint">' + posChip +
      (w.gender && w.posBase === 'n.' ? '<span class="chip">' + (w.gender === 'm' ? '阳性' : '阴性') + '</span>' : '') +
      '</div>' +
      (others.length ? '<div class="qhint tiny">这个意思有 ' + (others.length + 1) + ' 个法语词，写出任意一个都算对</div>' : '');
    ia.innerHTML =
      '<input type="text" id="ansInput" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="写出法语单词">' +
      accentBarHTML() +
      '<div class="row" style="margin-top:6px;gap:8px"><button class="btn sm grow" id="hintBtn">💡 首字母提示</button>' +
      '<button class="btn sm grow" id="dontKnowBtn">不会，看答案</button></div>';
    ga.innerHTML = '<button class="btn primary block" id="checkBtn">检查</button>';
    wireInput(c, w);

  } else if (c.type === 'PRON') {
    qc.innerHTML = badge + '<div class="qword">' + esc(w.fr) + '</div>' +
      (w.ipa ? '<div class="qipa">' + esc(w.ipa) + '</div>' : '') +
      '<div class="qhint">请先自己读出声，再点下面播放对照</div>';
    ia.innerHTML = '<button class="btn block" id="playBtn" style="font-size:17px">🔊 播放标准发音</button>';
    ga.innerHTML = '<button class="btn primary block" id="revealBtn">我读完了，看评分</button>';
    $('#playBtn').onclick = () => speak(w.fr);
    $('#revealBtn').onclick = () => reveal(c, w, null);

  } else if (c.type === 'GENDER') {
    qc.innerHTML = badge + '<div class="qword">___ ' + esc(w.fr) + '</div>' +
      '<div class="qhint">' + esc(w.zh) + '</div>';
    ia.innerHTML = '<div class="btn-grid"><button class="btn" id="gLe" style="font-size:22px">le</button>' +
      '<button class="btn" id="gLa" style="font-size:22px">la</button></div>';
    $('#gLe').onclick = () => answerGender(c, w, 'm');
    $('#gLa').onclick = () => answerGender(c, w, 'f');

  } else if (c.type === 'FEM') {
    qc.innerHTML = badge + '<div class="qword">' + esc(w.fr) + '</div>' +
      '<div class="qhint">' + esc(w.zh) + ' ' + posChip + '</div>' +
      '<div class="qhint">写出它的<b>阴性形式</b></div>';
    ia.innerHTML =
      '<input type="text" id="ansInput" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="阴性形式">' +
      accentBarHTML() +
      '<div class="row" style="margin-top:6px;gap:8px"><button class="btn sm grow" id="hintBtn">💡 首字母提示</button>' +
      '<button class="btn sm grow" id="dontKnowBtn">不会，看答案</button></div>';
    ga.innerHTML = '<button class="btn primary block" id="checkBtn">检查</button>';
    wireInput(c, w);
  }
}

function accentBarHTML() {
  return '<div class="accentbar">' + ACCENTS.map(a => '<button type="button" data-a="' + a + '">' + a + '</button>').join('') + '</div>';
}
function wireInput(c, w) {
  const inp = $('#ansInput');
  $$('.accentbar button').forEach(b => b.onclick = e => {
    e.preventDefault();
    const ch = b.dataset.a;
    const s = inp.selectionStart == null ? inp.value.length : inp.selectionStart;
    const e2 = inp.selectionEnd == null ? s : inp.selectionEnd;
    inp.value = inp.value.slice(0, s) + ch + inp.value.slice(e2);
    inp.focus();
    try { inp.setSelectionRange(s + ch.length, s + ch.length); } catch (err) { }
  });
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#checkBtn') && $('#checkBtn').click(); } };
  $('#checkBtn').onclick = () => {
    const v = inp.value;
    if (!v.trim()) { inp.focus(); return; }
    const target = c.type === 'FEM' ? w.fem : w.fr;
    const j = judge(v, w, c.type);
    reveal(c, w, { input: v, judged: j, target: target });
  };
  $('#hintBtn').onclick = () => {
    const t = c.type === 'FEM' ? w.fem : w.fr;
    const masked = t[0] + t.slice(1).replace(/[^\s'-]/g, '_');
    toast(masked + '  （' + t.length + ' 个字母）');
  };
  $('#dontKnowBtn').onclick = () => reveal(c, w, { input: '', judged: { ok: false }, target: c.type === 'FEM' ? w.fem : w.fr });
  setTimeout(() => { try { inp.focus(); } catch (e) { } }, 60);
}

function answerGender(c, w, guess) {
  const ok = guess === w.gender;
  reveal(c, w, { gender: guess, judged: { ok: ok }, target: (w.gender === 'm' ? 'le ' : 'la ') + w.fr });
}

/* 显示答案 + 评分按钮 */
function reveal(c, w, res) {
  if (SESS.revealed) return;
  SESS.revealed = true;
  const qc = $('#qcard'), ia = $('#inputArea'), ga = $('#gradeArea');

  /* --- 答案区 --- */
  let html = '<div class="answer">';
  if (c.type === 'FR_ZH') {
    html += '<div class="ansmain zh">' + esc(w.zh.replace(/;/g, '；')) + '</div>';
    if (w.fem) html += '<div class="small muted" style="margin-top:6px">阴性：' + esc(w.fem) + '</div>';
  } else if (c.type === 'PRON') {
    html += '<div class="small muted">对照一下你的发音</div>';
  } else {
    const j = res.judged;
    if (j.ok && j.accentOnly) html += '<div class="verdict warn">✔︎ 算对，但重音符号要注意</div>';
    else if (j.ok) html += '<div class="verdict ok">✔︎ 正确</div>';
    else html += '<div class="verdict bad">✘ 不对</div>';
    if (res.input) {
      html += '<div class="small muted">你写的：' + esc(res.input) + '</div>';
    }
    const showAns = c.type === 'GENDER' ? (w.gender === 'm' ? 'le ' : 'la ') + w.fr
      : (c.type === 'FEM' ? w.fem : (w.article ? w.article + ' ' + w.fr : w.fr));
    html += '<div class="ansmain' + (j.accentOnly ? ' acc-wrong' : '') + '" style="margin-top:6px">' + esc(showAns) + '</div>';
    if (w.ipa) html += '<div class="qipa">' + esc(c.type === 'FEM' && w.femIpa ? w.femIpa : w.ipa) + '</div>';
    if (c.type !== 'GENDER') html += '<div class="small muted" style="margin-top:4px">' + esc(w.zh.replace(/;/g, '；')) + '</div>';
    const others = otherAnswers(w, c.type);
    if (others.length) html += '<div class="small muted" style="margin-top:6px">同义也可以：' + others.map(esc).join('、') + '</div>';
  }
  if (w.note) html += '<div class="notebox">📝 ' + esc(w.note) + '</div>';
  html += '<div class="row" style="justify-content:center;margin-top:12px">' +
    '<button class="btn sm" id="replayBtn">🔊 重听发音</button></div></div>';
  qc.insertAdjacentHTML('beforeend', html);
  $('#replayBtn').onclick = () => speak(c.type === 'FEM' ? (w.fem || w.fr) : w.fr);
  ia.innerHTML = '';

  /* --- 评分区 --- */
  if (c.type === 'FR_ZH') {
    ga.innerHTML = '<div class="btn-grid"><button class="btn bad" id="gBad">❌ 没想起来</button>' +
      '<button class="btn ok" id="gGood">✅ 想起来了</button></div>';
    $('#gBad').onclick = () => commit(c, 'bad');
    $('#gGood').onclick = () => commit(c, 'good');
  } else if (c.type === 'PRON') {
    ga.innerHTML = '<div class="btn-grid three"><button class="btn bad" id="gBad">完全不会</button>' +
      '<button class="btn warn" id="gOk">有出入</button><button class="btn ok" id="gGood">一致</button></div>' +
      '<div class="tiny muted center" style="margin-top:6px">「有出入」＝盒子不动，明后天再见到它</div>';
    $('#gBad').onclick = () => commit(c, 'bad');
    $('#gOk').onclick = () => commit(c, 'ok');
    $('#gGood').onclick = () => commit(c, 'good');
  } else {
    const j = res.judged;
    ga.innerHTML = '<button class="btn block ' + (j.ok ? 'primary' : '') + '" id="nextBtn">' +
      (j.ok ? '继续 →' : '知道了，继续 →') + '</button>' +
      (!j.ok && res.input ? '<button class="btn block ghost sm" id="overrideBtn" style="margin-top:8px">其实我答对了，算对</button>' : '');
    $('#nextBtn').onclick = () => commit(c, j.ok ? 'good' : 'bad');
    if ($('#overrideBtn')) $('#overrideBtn').onclick = () => commit(c, 'good');
  }
  const gaEl = $('#gradeArea');
  if (gaEl && gaEl.scrollIntoView) setTimeout(() => gaEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30);
}

function commit(c, grade) {
  const w = BY_ID[c.wordId];
  const first = !SESS.answered[c.id];
  const wasNew = !S.rec[c.id];
  applyGrade(c, grade, first);
  if (wasNew) markWordIntroduced(c.wordId);
  if (first) {
    SESS.answered[c.id] = grade;
    const d = dailyOf(todayStr());
    d[0]++;
    if (grade === 'bad') { SESS.wrong++; SESS.wrongList.push({ fr: w.fr, zh: w.zh, type: c.type }); }
    else { SESS.right++; d[1]++; }
    if (wasNew && !SESS.newSeen[c.wordId]) { SESS.newSeen[c.wordId] = 1; SESS.newWords++; }
  }
  if (grade === 'bad') {
    /* 当天会话内稍后再出现一次，最多补考 2 次，避免死循环 */
    SESS.retry = SESS.retry || {};
    if ((SESS.retry[c.id] || 0) < 2) {
      SESS.retry[c.id] = (SESS.retry[c.id] || 0) + 1;
      const again = Object.assign({}, c, { isNew: false, again: true });
      const pos = Math.min(SESS.queue.length, SESS.i + 5);
      SESS.queue.splice(pos, 0, again);
    }
  }
  save();
  SESS.i++;
  renderCard();
}

function finishSession() {
  if (!SESS) return show('home');
  save(true);
  const total = SESS.right + SESS.wrong;
  $('#studyMain').style.display = 'none';
  $('#studyDone').style.display = '';
  $('#doneAcc').textContent = total ? Math.round(SESS.right / total * 100) + '%' : '—';
  const secs = Math.round((Date.now() - SESS.started) / 1000);
  $('#doneTime').textContent = secs < 60 ? secs + '秒' : Math.floor(secs / 60) + '分' + (secs % 60) + '秒';
  $('#doneNew').textContent = SESS.newWords;
  const tom = addDays(todayStr(), 1);
  $('#doneTom').textContent = dueCards(tom).length;
  const wl = {};
  SESS.wrongList.forEach(x => { (wl[x.fr] = wl[x.fr] || []).push(TYPES[x.type].short); });
  const keys = Object.keys(wl);
  $('#doneWrongList').innerHTML = keys.length
    ? '<b>这次错的：</b><br>' + keys.map(k => esc(k) + ' <span class="muted">(' + wl[k].join('/') + ')</span>').join('、')
    : '<span class="muted">这次全对，漂亮。</span>';
  SESS = null;
}

/* =========================================================
   统计
   ========================================================= */
function boxDistribution(type) {
  const counts = [0, 0, 0, 0, 0, 0];   // index0 = 未学习
  BANK.forEach(w => cardTypesOf(w).forEach(t => {
    if (type !== 'ALL' && t !== type) return;
    const r = S.rec[w.id + '|' + t];
    if (!r) counts[0]++; else counts[r[0]]++;
  }));
  return counts;
}
function renderStats() {
  const cards = allCards();
  $('#stWords').textContent = BANK.length;
  $('#stCards').textContent = cards.length;
  $('#stStarted').textContent = Object.keys(S.rec).length;
  $('#stMastered').textContent = Object.keys(S.rec).filter(k => S.rec[k][0] === 5).length;

  const type = $('#boxChartType').value || 'ALL';
  const c = boxDistribution(type);
  const max = Math.max.apply(null, c) || 1;
  const labels = ['未学', '盒1', '盒2', '盒3', '盒4', '盒5'];
  $('#boxBars').innerHTML = c.map((n, i) =>
    '<div class="bar"><div class="val">' + n + '</div>' +
    '<div class="fill" style="height:' + (n / max * 100) + '%;background:' + BOX_COLORS[i] + '"></div>' +
    '<div class="lab">' + labels[i] + '</div></div>').join('');
  $('#boxLegend').innerHTML = '<span>间隔：盒1=1天 · 盒2=3天 · 盒3=7天 · 盒4=15天 · 盒5=30天</span>';

  /* 未来 14 天 */
  const ds = todayStr(); const f = [];
  for (let i = 0; i < 14; i++) f.push({ d: addDays(ds, i), n: 0 });
  const idx = {}; f.forEach((x, i) => idx[x.d] = i);
  Object.keys(S.rec).forEach(k => {
    const r = S.rec[k]; if (r[5]) return;
    if (r[1] <= ds) f[0].n++;
    else if (idx[r[1]] != null) f[idx[r[1]]].n++;
  });
  const fmax = Math.max.apply(null, f.map(x => x.n)) || 1;
  $('#forecastBars').innerHTML = f.map((x, i) =>
    '<div class="bar"><div class="val" style="font-size:10px">' + (x.n || '') + '</div>' +
    '<div class="fill" style="height:' + (x.n / fmax * 100) + '%;background:' + (i === 0 ? 'var(--accent)' : 'var(--b4)') + '"></div>' +
    '<div class="lab" style="font-size:9px">' + (i === 0 ? '今' : x.d.slice(8)) + '</div></div>').join('');

  renderHeat();
}
function renderHeat() {
  const weeks = 26, end = new Date();
  const days = [];
  const start = new Date(end); start.setDate(start.getDate() - (weeks * 7 - 1));
  start.setDate(start.getDate() - start.getDay());
  let total = 0, active = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = todayStr(d), n = (S.daily[ds] || [0])[0];
    total += n; if (n) active++;
    days.push({ ds: ds, n: n });
  }
  let html = '', i = 0;
  while (i < days.length) {
    html += '<div class="wk">';
    for (let k = 0; k < 7 && i < days.length; k++, i++) {
      const n = days[i].n;
      const lv = n === 0 ? '' : n < 10 ? ' l1' : n < 25 ? ' l2' : n < 50 ? ' l3' : ' l4';
      html += '<div class="d' + lv + '" title="' + days[i].ds + '：' + n + ' 张"></div>';
    }
    html += '</div>';
  }
  $('#heat').innerHTML = html;
  $('#heatSum').textContent = '近半年 ' + active + ' 天 · 共 ' + total + ' 张';
  const h = $('#heat'); h.scrollLeft = h.scrollWidth;
}
$('#boxChartType').onchange = renderStats;

/* =========================================================
   词表
   ========================================================= */
let wSortKey = 'wrong', wSortDir = -1;
function wordStats(w) {
  const st = { boxes: {}, wrong: 0, correct: 0, due: null, leech: false, started: 0 };
  cardTypesOf(w).forEach(t => {
    const r = S.rec[w.id + '|' + t];
    if (!r) { st.boxes[t] = null; return; }
    st.started++;
    st.boxes[t] = r[0]; st.correct += r[2]; st.wrong += r[3];
    if (r[5]) st.leech = true;
    if (!st.due || r[1] < st.due) st.due = r[1];
  });
  return st;
}
function renderWords() {
  const tagSel = $('#wTag');
  if (tagSel.options.length <= 1) ALL_TAGS.forEach(t => tagSel.add(new Option(t, t)));
  const q = normAns($('#wSearch').value), tag = tagSel.value, sort = $('#wSort').value;
  let list = BANK.filter(w => {
    if (tag && (w.tags || []).indexOf(tag) < 0) return false;
    if (!q) return true;
    return normAns(w.fr).indexOf(q) >= 0 || (w.zh || '').indexOf($('#wSearch').value.trim()) >= 0 ||
      (w.fem && normAns(w.fem).indexOf(q) >= 0);
  });
  const stMap = {}; list.forEach(w => stMap[w.id] = wordStats(w));
  const cmp = {
    wrong: (a, b) => stMap[b.id].wrong - stMap[a.id].wrong || stMap[b.id].correct - stMap[a.id].correct,
    id: (a, b) => a.id.localeCompare(b.id),
    fr: (a, b) => deacc(a.fr).localeCompare(deacc(b.fr)),
    box: (a, b) => avgBox(stMap[a.id]) - avgBox(stMap[b.id]),
    due: (a, b) => (stMap[a.id].due || '9999') .localeCompare(stMap[b.id].due || '9999'),
    new: (a, b) => stMap[a.id].started - stMap[b.id].started || a.id.localeCompare(b.id)
  }[sort] || (() => 0);
  list.sort(cmp);
  $('#wCount').textContent = list.length + ' 个词' + (S.settings.tags ? '' : '');
  const tb = $('#wTable tbody');
  const rows = list.slice(0, 400).map(w => {
    const st = stMap[w.id];
    const cell = t => {
      if (cardTypesOf(w).indexOf(t) < 0) return '<td class="muted tiny">—</td>';
      const b = st.boxes[t];
      return '<td>' + (b == null ? '<span class="boxdot" style="background:var(--b0)">·</span>'
        : '<span class="boxdot" style="background:' + BOX_COLORS[b] + '">' + b + '</span>') + '</td>';
    };
    return '<tr data-id="' + w.id + '">' +
      '<td class="frcell">' + (st.leech ? '🐛 ' : '') + esc(w.article ? w.article + ' ' + w.fr : w.fr) +
      (w.fem ? '<span class="tiny muted"> / ' + esc(w.fem) + '</span>' : '') + '</td>' +
      '<td' + (st.wrong ? ' style="color:var(--bad);font-weight:700"' : ' class="muted"') + '>' + st.wrong + '</td>' +
      '<td class="zhcell">' + esc((w.zh || '').replace(/;/g, '；')) + '</td>' +
      cell('FR_ZH') + cell('ZH_FR') + cell('PRON') + cell('GENDER') + cell('FEM') +
      '<td class="muted">' + st.correct + '</td>' +
      '<td class="muted tiny">' + (st.due ? st.due.slice(5) : '—') + '</td></tr>';
  }).join('');
  tb.innerHTML = rows || '<tr><td colspan="10" class="empty">没有匹配的词</td></tr>';
  if (list.length > 400) $('#wCount').textContent += '（只显示前 400 个，请用搜索缩小范围）';
  $$('#wTable tbody tr').forEach(tr => tr.onclick = () => openWord(tr.dataset.id));
  $$('#wTable thead th').forEach(th => {
    th.classList.toggle('sorted', th.dataset.s === sort);
    th.onclick = () => { if (th.dataset.s) { $('#wSort').value = th.dataset.s; renderWords(); } };
  });
}
function avgBox(st) {
  const v = Object.keys(st.boxes).map(k => st.boxes[k]);
  const known = v.filter(x => x != null);
  if (!known.length) return -1;
  return known.reduce((a, b) => a + b, 0) / v.length;
}
$('#wSearch').oninput = renderWords;
$('#wTag').onchange = renderWords;
$('#wSort').onchange = renderWords;

function openWord(id) {
  const w = BY_ID[id]; if (!w) return;
  const st = wordStats(w);
  let h = '<div class="row spread"><h2 style="margin:0">' + esc(w.article ? w.article + ' ' + w.fr : w.fr) + '</h2>' +
    '<button class="btn sm" id="mSpeak">🔊</button></div>' +
    (w.ipa ? '<div class="qipa" style="text-align:left">' + esc(w.ipa) + '</div>' : '') +
    '<div style="margin:6px 0 2px">' + esc((w.zh || '').replace(/;/g, '；')) + '</div>' +
    '<div class="small muted">' + esc(w.pos || '') + (w.fem ? ' · 阴性：' + esc(w.fem) : '') +
    ' · ' + (w.tags || []).join(' ') + '</div>' +
    (w.note ? '<div class="notebox">📝 ' + esc(w.note) + '</div>' : '');
  h += '<div class="tablewrap" style="margin-top:12px"><table style="min-width:0"><thead><tr><th>卡片</th><th>盒</th><th>对</th><th>错</th><th>连错</th><th>下次</th></tr></thead><tbody>';
  cardTypesOf(w).forEach(t => {
    const r = S.rec[w.id + '|' + t];
    h += '<tr><td>' + TYPES[t].label + '</td>' +
      (r ? '<td><span class="boxdot" style="background:' + BOX_COLORS[r[0]] + '">' + r[0] + '</span></td><td>' + r[2] + '</td><td>' + r[3] + '</td><td>' + r[4] + (r[5] ? ' 🐛' : '') + '</td><td class="tiny">' + r[1] + '</td>'
        : '<td class="muted">—</td><td class="muted">—</td><td class="muted">—</td><td class="muted">—</td><td class="muted">未学</td>') +
      '</tr>';
  });
  h += '</tbody></table></div>';
  h += '<div class="btn-grid" style="margin-top:12px">' +
    '<button class="btn" id="mReset">重置该词进度</button>' +
    '<button class="btn ok" id="mMaster">标记已掌握</button></div>' +
    '<button class="btn block ghost" id="mClose" style="margin-top:8px">关闭</button>';
  openModal(h);
  $('#mSpeak').onclick = () => speak(w.fr);
  $('#mClose').onclick = closeModal;
  $('#mReset').onclick = () => {
    cardTypesOf(w).forEach(t => delete S.rec[w.id + '|' + t]);
    save(true); closeModal(); renderWords(); toast('已重置：' + w.fr);
  };
  $('#mMaster').onclick = () => {
    cardTypesOf(w).forEach(t => {
      const r = S.rec[w.id + '|' + t] || (S.rec[w.id + '|' + t] = newRec());
      r[0] = 5; r[5] = 0; r[4] = 0; r[1] = addDays(todayStr(), INTERVALS[5]);
    });
    save(true); closeModal(); renderWords(); toast('已标记掌握：' + w.fr);
  };
}
function openModal(html) { $('#modalInner').innerHTML = html; $('#modal').classList.add('show'); }
function closeModal() { $('#modal').classList.remove('show'); }
$('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };

/* =========================================================
   顽固词
   ========================================================= */
function renderLeech() {
  const items = Object.keys(S.rec).filter(k => S.rec[k][5]).map(k => {
    const [wid, t] = k.split('|');
    return { key: k, w: BY_ID[wid], type: t, r: S.rec[k] };
  }).filter(x => x.w);
  $('#leechCount').textContent = items.length;
  const box = $('#leechList');
  if (!items.length) { box.innerHTML = '<div class="empty">还没有顽固词。<br>连续答错 5 次的卡片会出现在这里。</div>'; return; }
  box.innerHTML = items.map(x =>
    '<div class="leechitem"><div class="row spread">' +
    '<div><b style="font-size:17px">' + esc(x.w.fr) + '</b> <span class="chip">' + TYPES[x.type].label + '</span></div>' +
    '<button class="btn sm" data-speak="' + esc(x.w.fr) + '">🔊</button></div>' +
    '<div class="small muted" style="margin-top:4px">' + esc((x.w.zh || '').replace(/;/g, '；')) +
    (x.w.ipa ? ' · ' + esc(x.w.ipa) : '') + '</div>' +
    '<div class="tiny muted" style="margin-top:4px">连续错 ' + x.r[4] + ' 次 · 累计错 ' + x.r[3] + ' 次</div>' +
    (x.w.note ? '<div class="notebox">📝 ' + esc(x.w.note) + '</div>' : '') +
    '<textarea class="notebox" data-mnem="' + x.key + '" placeholder="给它编一个联想 / 例句，写下来更容易记住…" ' +
    'style="width:100%;min-height:56px;border:1px solid var(--line);font-size:14px;color:var(--fg);background:var(--bg);margin-top:8px">' +
    esc((S.mnem || {})[x.key] || '') + '</textarea>' +
    '<button class="btn sm ok block" data-done="' + x.key + '" style="margin-top:8px">✅ 已处理，放回队列</button></div>'
  ).join('');
  $$('[data-speak]', box).forEach(b => b.onclick = () => speak(b.dataset.speak));
  $$('[data-mnem]', box).forEach(t => t.onchange = () => { S.mnem = S.mnem || {}; S.mnem[t.dataset.mnem] = t.value; save(); });
  $$('[data-done]', box).forEach(b => b.onclick = () => {
    const r = S.rec[b.dataset.done];
    if (r) { r[5] = 0; r[4] = 0; r[0] = 1; r[1] = todayStr(); }
    save(true); renderLeech(); toast('已放回队列');
  });
}

/* =========================================================
   设置
   ========================================================= */
function segment(el, opts, cur, cb) {
  el.innerHTML = opts.map(o => '<button data-v="' + o[0] + '"' + (String(o[0]) === String(cur) ? ' class="on"' : '') + '>' + o[1] + '</button>').join('');
  $$('button', el).forEach(b => b.onclick = () => { cb(b.dataset.v); });
}
function renderSettings() {
  segment($('#setSize'), [[10, '10'], [20, '20'], [30, '30'], [50, '50']], S.settings.sessionSize,
    v => { S.settings.sessionSize = +v; save(); renderSettings(); });
  segment($('#setNew'), [[0, '0'], [5, '5'], [10, '10'], [20, '20'], [30, '30']], S.settings.newPerDay,
    v => { S.settings.newPerDay = +v; save(); renderSettings(); });
  segment($('#setRate'), [[0.7, '慢'], [0.85, '中'], [1, '正常']], S.settings.rate,
    v => { S.settings.rate = +v; save(); renderSettings(); });
  segment($('#setTheme'), [['auto', '跟随'], ['light', '浅'], ['dark', '深']], S.settings.theme,
    v => { S.settings.theme = v; applyTheme(); save(); renderSettings(); });
  const sw = $('#setStrict');
  sw.classList.toggle('on', !!S.settings.strict);
  sw.onclick = () => { S.settings.strict = !S.settings.strict; save(); renderSettings(); };
  const tt = $('#setTypes');
  tt.innerHTML = TYPE_ORDER.map(t => '<button class="tagbtn' + (S.settings.types[t] ? ' on' : '') + '" data-t="' + t + '">' + TYPES[t].label + '</button>').join('');
  $$('button', tt).forEach(b => b.onclick = () => {
    const on = Object.keys(S.settings.types).filter(k => S.settings.types[k]);
    if (on.length === 1 && S.settings.types[b.dataset.t]) { toast('至少保留一种卡片类型'); return; }
    S.settings.types[b.dataset.t] = S.settings.types[b.dataset.t] ? 0 : 1;
    save(); renderSettings();
  });
  $('#bankVer').textContent = (localStorage.getItem(LS_BANK) ? '自定义 ' : '') + (window.WORD_BANK_VERSION || '—') + ' · ' + BANK.length + ' 词 / ' + allCards().length + ' 卡';
}

/* =========================================================
   导入导出
   ========================================================= */
function download(name, text, mime) {
  const blob = new Blob([text], { type: mime || 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
$('#expBtn').onclick = () => {
  save(true);
  download('法语A1进度-' + todayStr() + '.json',
    JSON.stringify({ app: 'fr-a1-review', v: 1, exportedAt: new Date().toISOString(), bank: window.WORD_BANK_VERSION, state: S }, null, 1));
  toast('已导出，记得存到网盘或备忘录');
};
$('#expWordsBtn').onclick = () => download('法语A1词库-' + todayStr() + '.json', JSON.stringify(BANK, null, 1));

let importMode = 'state';
$('#impBtn').onclick = () => { importMode = 'state'; $('#fileIn').click(); };
$('#impWordsBtn').onclick = () => { importMode = 'bank'; $('#fileIn').click(); };
$('#fileIn').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const fr = new FileReader();
  fr.onload = () => { try { (importMode === 'state' ? importState : importBank)(String(fr.result), f.name); } catch (err) { toast('导入失败：' + err.message); } };
  fr.readAsText(f, 'utf-8');
  e.target.value = '';
};
function importState(text) {
  const j = JSON.parse(text);
  const st = j.state || j;
  if (!st || !st.rec) throw new Error('不是进度文件');
  const n = Object.keys(st.rec).length;
  if (!confirm('导入 ' + n + ' 条学习记录，会覆盖当前进度。继续？')) return;
  S = st;
  S.rec = st.rec; S.daily = st.daily || {}; S.settings = Object.assign({}, DEFAULT_SETTINGS, st.settings || {});
  S.settings.types = Object.assign({}, DEFAULT_SETTINGS.types, st.settings && st.settings.types || {});
  S.mastered = st.mastered || {}; S.mnem = st.mnem || {};
  save(true); applyTheme(); show('home'); toast('已导入 ' + n + ' 条记录');
}
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}
const COL_ALIAS = {
  fr: ['fr', '单词', '法语', 'word', 'french'], zh: ['zh', '中译', '中文', '释义', 'meaning'],
  pos: ['pos', '词性'], ipa: ['ipa', '音标', '发音'], gender: ['gender', '性别', '阴阳性'],
  tags: ['tags', 'tag', '标签', '单元', 'unit'], note: ['note', '备注', '笔记'], fem: ['fem', '阴性', '阴性形式'],
  article: ['article', '冠词'], level: ['level', '程度', '等级']
};
function importBank(text, name) {
  let arr;
  if (/^\s*[\[{]/.test(text)) {
    arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error('JSON 需要是数组');
  } else {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('CSV 至少要有表头和一行数据');
    const head = rows[0].map(h => String(h).trim().toLowerCase());
    const map = {};
    Object.keys(COL_ALIAS).forEach(k => {
      const i = head.findIndex(h => COL_ALIAS[k].some(a => h === a.toLowerCase()));
      if (i >= 0) map[k] = i;
    });
    if (map.fr == null) throw new Error('找不到「单词 / fr」这一列');
    arr = rows.slice(1).map(r => {
      const o = {};
      Object.keys(map).forEach(k => o[k] = String(r[map[k]] == null ? '' : r[map[k]]).trim());
      return o;
    }).filter(o => o.fr);
  }
  /* 规范化 */
  const ART = /^(les|le|la|l'|l’|un|une|des)\s+/i;
  const bank = arr.map((o, i) => {
    let fr = String(o.fr || '').trim(), article = String(o.article || '');
    const m = fr.match(ART);
    if (m && !article) { article = m[1].toLowerCase(); fr = fr.slice(m[0].length).trim(); }
    const pos = String(o.pos || '');
    let gender = o.gender || (/n\.[a-z.]*m\./.test(pos) ? 'm' : /n\.[a-z.]*f\./.test(pos) ? 'f' : (article === 'le' ? 'm' : article === 'la' ? 'f' : null));
    if (gender !== 'm' && gender !== 'f') gender = null;
    const plural = /pl\./.test(pos) || article === 'les' || article === 'des';
    const posBase = /^n\./.test(pos) ? 'n.' : /^v/.test(pos) ? 'v.' : /^adj/.test(pos) ? 'adj.' : /^adv/.test(pos) ? 'adv.' : pos;
    const tags = String(o.tags || '').split(/[,;，；\s]+/).filter(Boolean);
    return {
      id: o.id || ('x' + deacc(fr).toLowerCase().replace(/[^a-z0-9]+/g, '-')),
      fr: fr, article: article, pos: pos, posBase: posBase,
      gender: plural ? null : gender, plural: plural,
      zh: String(o.zh || ''), ipa: String(o.ipa || ''), note: String(o.note || ''),
      tags: tags.length ? tags : ['导入'], level: +(o.level || 2) || 2,
      fem: o.fem || undefined,
      genderCard: !!(posBase === 'n.' && gender && !plural)
    };
  });
  if (!bank.length) throw new Error('没解析到任何词');
  if (!confirm('导入 ' + bank.length + ' 个词，替换当前词库？\n（学习进度会按法语单词自动对应到新词库）')) return;
  /* 按 fr 迁移进度 */
  const oldByFr = {}; BANK.forEach(w => oldByFr[deacc(w.fr).toLowerCase()] = w.id);
  const newRecs = {};
  bank.forEach(w => {
    const oldId = oldByFr[deacc(w.fr).toLowerCase()];
    if (!oldId) return;
    Object.keys(S.rec).forEach(k => {
      const [wid, t] = k.split('|');
      if (wid === oldId) newRecs[w.id + '|' + t] = S.rec[k];
    });
  });
  S.rec = newRecs;
  localStorage.setItem(LS_BANK, JSON.stringify(bank));
  BANK = bank; indexBank(); save(true);
  toast('词库已替换：' + bank.length + ' 个词，保留 ' + Object.keys(newRecs).length + ' 条进度');
  renderSettings(); renderWords(); show('home');
}
$('#resetBtn').onclick = () => {
  if (!confirm('清空全部学习记录？建议先导出备份。')) return;
  if (!confirm('真的要清空吗？此操作不可撤销。')) return;
  S.rec = {}; S.daily = {}; S.mnem = {}; S.introd = {};
  save(true); show('home'); toast('已清空');
};

/* =========================================================
   启动
   ========================================================= */
loadState();
loadBank();
indexBank();
applyTheme();
if (localStorage.getItem(LS_BANK)) {
  /* 自定义词库仍需检查有效性 */
  if (!BANK.length) { localStorage.removeItem(LS_BANK); loadBank(); indexBank(); }
}
renderHome();
renderSettings();

/* Service Worker */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { });
  });
}
window.addEventListener('beforeunload', () => save(true));
document.addEventListener('visibilitychange', () => { if (document.hidden) save(true); });

/* 调试用 */
window.__app = {
  get S() { return S; }, get BANK() { return BANK; }, get SESS() { return SESS; },
  allCards, dueCards, buildSession, judge, startSession, show, applyGrade, cardTypesOf, BY_ID: () => BY_ID
};
})();
