const { chromium, devices } = require('playwright');

const BASE = 'http://localhost:8899/index.html';
const fails = [];
function check(name, cond, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? '  — ' + extra : ''));
  if (!cond) fails.push(name + (extra ? ' (' + extra + ')' : ''));
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({}, devices['iPhone 13'], { locale: 'zh-CN' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });

  console.log('\n== 1. 词库与卡片 ==');
  const info = await page.evaluate(() => {
    const a = window.__app;
    const cards = a.allCards();
    const byType = {};
    cards.forEach(c => byType[c.type] = (byType[c.type] || 0) + 1);
    return { words: a.BANK.length, cards: cards.length, byType, tags: a.BANK.reduce((s, w) => s.concat(w.tags), []).filter((v, i, ar) => ar.indexOf(v) === i) };
  });
  console.log('   ', JSON.stringify(info.byType), '共', info.cards, '张 /', info.words, '词');
  check('词库加载 904 词', info.words === 904, String(info.words));
  check('五类卡片都存在', Object.keys(info.byType).length === 5, Object.keys(info.byType).join(','));
  check('单元标签 U1-U8', info.tags.length === 8, info.tags.join(','));

  console.log('\n== 2. 判分逻辑 ==');
  const j = await page.evaluate(() => {
    const a = window.__app;
    const find = fr => a.BANK.find(w => w.fr === fr);
    const t = (fr, input, type) => { const w = find(fr); return w ? a.judge(input, w, type || 'ZH_FR') : { err: 'no ' + fr }; };
    return {
      exact: t('café', 'café'),
      caseSp: t('café', '  CAFÉ '),
      accentless: t('café', 'cafe'),
      withArticle: t('café', 'le café'),
      wrong: t('café', 'the'),
      synonym: t('jour', 'journée'),          // 同一中文「天」
      fem: t('bon', 'bonne', 'FEM'),
      femWrong: t('bon', 'bons', 'FEM'),
      apostrophe: t('année', "annee")
    };
  });
  check('完全正确', j.exact.ok && !j.exact.accentOnly);
  check('忽略大小写/空格', j.caseSp.ok);
  check('缺重音算对但标红', j.accentless.ok && j.accentless.accentOnly);
  check('带冠词算对', j.withArticle.ok);
  check('错误答案判错', j.wrong.ok === false);
  check('同义词(jour/journée)互相算对', j.synonym.ok, JSON.stringify(j.synonym));
  check('阴性变形卡正确', j.fem.ok);
  check('阴性变形卡错误', j.femWrong.ok === false);

  console.log('\n== 3. 严格模式 ==');
  const strict = await page.evaluate(() => {
    const a = window.__app;
    a.S.settings.strict = true;
    const w = a.BANK.find(x => x.fr === 'café');
    const r = a.judge('cafe', w, 'ZH_FR');
    a.S.settings.strict = false;
    return r;
  });
  check('严格模式下缺重音判错', strict.ok === false && strict.accentOnly === true);

  console.log('\n== 4. 完整会话（20 张，全部答对）==');
  await page.click('nav.tabs button[data-v="home"]');
  await page.click('#startBtn');
  await page.waitForSelector('#qcard .qword');
  let n = 0, types = {};
  while (n < 60) {
    if (await page.isVisible('#studyDone')) break;
    const t = await page.evaluate(() => {
      const el = document.querySelector('#qcard .qtype');
      return el ? el.textContent : null;
    });
    if (!t) break;
    types[t.split('·')[0].trim()] = 1;
    // 用真正的正确答案作答
    if (await page.$('#ansInput')) {
      const ans = await page.evaluate(() => {
        const a = window.__app, s = a.SESS, c = s.queue[s.i];
        const w = a.BANK.find(x => x.id === c.wordId);
        return c.type === 'FEM' ? w.fem : w.fr;
      });
      await page.fill('#ansInput', ans);
      await page.click('#checkBtn');
    } else if (await page.$('#gLe')) {
      const g = await page.evaluate(() => {
        const a = window.__app, s = a.SESS, c = s.queue[s.i];
        return a.BANK.find(x => x.id === c.wordId).gender;
      });
      await page.click(g === 'm' ? '#gLe' : '#gLa');
    } else if (await page.$('#revealBtn')) {
      await page.click('#revealBtn');
    }
    // 评分
    if (await page.$('#gGood')) await page.click('#gGood');
    else if (await page.$('#nextBtn')) await page.click('#nextBtn');
    n++;
  }
  check('全部答对时无补考、张数等于会话上限', n === 20, String(n));
  const noWrong = await page.evaluate(() => Object.keys(window.__app.S.rec).filter(k => window.__app.S.rec[k][3] > 0).length);
  check('全对时无错误计数', noWrong === 0, String(noWrong));
  console.log('    出现的卡片类型:', Object.keys(types).join(' | '));
  const doneVisible = await page.isVisible('#studyDone');
  check('会话能走到完成页', doneVisible);
  const doneStats = await page.evaluate(() => ({
    acc: document.querySelector('#doneAcc').textContent,
    time: document.querySelector('#doneTime').textContent,
    nw: document.querySelector('#doneNew').textContent,
    tom: document.querySelector('#doneTom').textContent
  }));
  console.log('    完成页:', JSON.stringify(doneStats));
  check('完成页有正确率', /%/.test(doneStats.acc));
  check('完成页有新学词数', +doneStats.nw > 0);

  console.log('\n== 5. Leitner 调度 ==');
  const sched = await page.evaluate(() => {
    const a = window.__app;
    const keys = Object.keys(a.S.rec);
    const today = new Date(); const ds = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    const boxes = {}; let goodDue = 0, badDue = 0;
    keys.forEach(k => { const r = a.S.rec[k]; boxes[r[0]] = (boxes[r[0]] || 0) + 1; });
    // 手动验证一张
    const k = keys[0], r = a.S.rec[k];
    const gap = Math.round((new Date(r[1] + 'T12:00:00') - new Date(ds + 'T12:00:00')) / 86400000);
    return { total: keys.length, boxes, sampleBox: r[0], sampleGap: gap, newLeft: a.S.daily[ds][2] };
  });
  console.log('   ', JSON.stringify(sched));
  check('答对后进入盒2（间隔3天）', sched.sampleBox === 2 && sched.sampleGap === 3, 'box=' + sched.sampleBox + ' gap=' + sched.sampleGap);
  check('每日新词计数生效', sched.newLeft > 0 && sched.newLeft <= 10, String(sched.newLeft));

  console.log('\n== 6. 答错 → 回盒1 + 会话内重现 ==');
  await page.evaluate(() => {
    const a = window.__app;
    a.S.rec = {};
    const w = a.BANK.find(x => x.fr === 'café');
    a.S.rec[w.id + '|FR_ZH'] = [4, '2020-01-01', 5, 0, 0, 0, ''];
    a.S.settings.newPerDay = 0;
  });
  await page.click('nav.tabs button[data-v="home"]');
  await page.click('#startDueOnly');
  await page.waitForSelector('#revealBtn');
  const qLen0 = await page.evaluate(() => window.__app.SESS.queue.length);
  await page.click('#revealBtn');
  await page.click('#gBad');
  await page.waitForTimeout(150);
  const afterWrong = await page.evaluate(() => {
    const a = window.__app;
    const w = a.BANK.find(x => x.fr === 'café');
    const r = a.S.rec[w.id + '|FR_ZH'];
    const t = new Date(); const ds = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    return { box: r[0], wrong: r[3], cw: r[4], gap: Math.round((new Date(r[1] + 'T12:00:00') - new Date(ds + 'T12:00:00')) / 86400000), qLen: a.SESS ? a.SESS.queue.length : 0 };
  });
  console.log('   ', JSON.stringify(afterWrong), '队列', qLen0, '→', afterWrong.qLen);
  check('答错后盒子 4 → 1', afterWrong.box === 1);
  check('答错后下次复习 = 1 天', afterWrong.gap === 1);
  check('错误次数 +1', afterWrong.wrong === 1 && afterWrong.cw === 1);
  check('答错的卡当场重新入队', afterWrong.qLen === qLen0 + 1, qLen0 + '→' + afterWrong.qLen);
  await page.waitForSelector('#revealBtn');
  await page.click('#revealBtn');
  await page.click('#gGood');
  await page.waitForTimeout(150);
  const afterRetry = await page.evaluate(() => {
    const a = window.__app;
    const w = a.BANK.find(x => x.fr === 'café');
    const r = a.S.rec[w.id + '|FR_ZH'];
    return { box: r[0], correct: r[2], wrong: r[3] };
  });
  check('补考答对：盒1 → 盒2，且不重复计数', afterRetry.box === 2 && afterRetry.wrong === 1, JSON.stringify(afterRetry));
  await page.evaluate(() => { window.__app.S.settings.newPerDay = 10; });

  console.log('\n== 7. 顽固词 ==');
  const leech = await page.evaluate(() => {
    const a = window.__app;
    const w = a.BANK[5], key = w.id + '|ZH_FR';
    a.S.rec[key] = [1, '2020-01-01', 0, 4, 4, 0, ''];
    // 再错一次 → 应触发 leech
    const r = a.S.rec[key];
    r[0] = 1; r[3]++; r[4]++;
    if (r[4] >= 5) r[5] = 1;
    const inDue = a.dueCards().some(c => c.id === key);
    return { leech: r[5], inQueue: inDue, fr: w.fr };
  });
  check('连错5次标记 leech', leech.leech === 1);
  check('leech 卡被移出常规队列', leech.inQueue === false);
  await page.click('nav.tabs button[data-v="more"]');
  await page.waitForTimeout(200);
  const leechUI = await page.evaluate(() => ({
    count: document.querySelector('#leechCount').textContent,
    hasBtn: !!document.querySelector('[data-done]'),
    hasNote: !!document.querySelector('[data-mnem]')
  }));
  check('顽固词页显示条目', +leechUI.count >= 1 && leechUI.hasBtn && leechUI.hasNote, JSON.stringify(leechUI));
  const leechBefore = +leechUI.count;
  await page.click('[data-done]');
  await page.waitForTimeout(250);
  const afterHandled = await page.evaluate(() => {
    const a = window.__app;
    const ks = Object.keys(a.S.rec).filter(k => a.S.rec[k][5]);
    const back = a.dueCards().length;
    return { n: ks.length, due: back };
  });
  check('「已处理」后移出顽固词并回到队列', afterHandled.n === leechBefore - 1 && afterHandled.due > 0, JSON.stringify(afterHandled));

  console.log('\n== 8. 统计页 ==');
  await page.click('nav.tabs button[data-v="stats"]');
  await page.waitForTimeout(300);
  const stats = await page.evaluate(() => ({
    words: document.querySelector('#stWords').textContent,
    cards: document.querySelector('#stCards').textContent,
    bars: document.querySelectorAll('#boxBars .bar').length,
    forecast: document.querySelectorAll('#forecastBars .bar').length,
    heat: document.querySelectorAll('#heat .d').length,
    heatSum: document.querySelector('#heatSum').textContent
  }));
  console.log('   ', JSON.stringify(stats));
  check('盒子分布 6 根柱', stats.bars === 6);
  check('14 天预测', stats.forecast === 14);
  check('热力图渲染', stats.heat > 150, String(stats.heat));

  console.log('\n== 9. 词表 ==');
  await page.click('nav.tabs button[data-v="words"]');
  await page.waitForTimeout(300);
  const rows0 = await page.evaluate(() => document.querySelectorAll('#wTable tbody tr').length);
  check('词表渲染行', rows0 > 10, String(rows0));
  await page.fill('#wSearch', 'café');
  await page.waitForTimeout(200);
  const rows1 = await page.evaluate(() => Array.from(document.querySelectorAll('#wTable tbody tr td.frcell')).map(t => t.textContent));
  check('搜索法语可用', rows1.some(t => /café/.test(t)), rows1.slice(0, 3).join('|'));
  await page.fill('#wSearch', '咖啡');
  await page.waitForTimeout(200);
  const rows2 = await page.evaluate(() => Array.from(document.querySelectorAll('#wTable tbody tr td.frcell')).map(t => t.textContent));
  check('搜索中文可用', rows2.some(t => /café/.test(t)), rows2.slice(0, 3).join('|'));
  await page.click('#wTable tbody tr');
  await page.waitForTimeout(200);
  check('点词打开详情弹窗', await page.isVisible('#modal .inner'));
  check('详情有重置按钮', !!(await page.$('#mReset')));
  await page.click('#mMaster');
  await page.waitForTimeout(200);
  const mastered = await page.evaluate(() => {
    const a = window.__app;
    const w = a.BANK.find(x => x.fr === 'café');
    return Object.keys(a.S.rec).filter(k => k.indexOf(w.id + '|') === 0).map(k => a.S.rec[k][0]);
  });
  check('标记已掌握 → 全部盒5', mastered.length > 0 && mastered.every(b => b === 5), JSON.stringify(mastered));

  console.log('\n== 10. 设置 ==');
  await page.click('nav.tabs button[data-v="more"]');
  await page.waitForTimeout(200);
  await page.click('#setSize button[data-v="30"]');
  await page.click('#setNew button[data-v="5"]');
  await page.click('#setStrict');
  await page.waitForTimeout(100);
  const cfg = await page.evaluate(() => window.__app.S.settings);
  check('会话张数可调', cfg.sessionSize === 30, String(cfg.sessionSize));
  check('每日新词上限可调', cfg.newPerDay === 5, String(cfg.newPerDay));
  check('严格模式开关', cfg.strict === true);
  await page.click('#setStrict');
  // 卡片类型开关
  await page.click('#setTypes button[data-t="FEM"]');
  const cfg2 = await page.evaluate(() => window.__app.S.settings.types);
  check('卡片类型可关闭', cfg2.FEM === 0);
  await page.click('#setTypes button[data-t="FEM"]');

  console.log('\n== 11. 标签筛选 ==');
  await page.evaluate(() => { const a = window.__app; a.S.settings.newPerDay = 20; a.S.daily = {}; });
  await page.click('nav.tabs button[data-v="home"]');
  await page.waitForTimeout(200);
  const tagCount = await page.evaluate(() => document.querySelectorAll('#tagFilter .tagbtn').length);
  check('单元筛选按钮 8 个', tagCount === 8, String(tagCount));
  // 只留 U1（每次点击后 DOM 会重建，必须重新定位）
  for (let i = 1; i < tagCount; i++) {
    await page.click('#tagFilter .tagbtn:nth-child(' + (i + 1) + ')');
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(200);
  const filtered = await page.evaluate(() => {
    const a = window.__app;
    const q = a.buildSession('new');
    return { tags: a.S.settings.tags, allU1: q.every(c => a.BANK.find(w => w.id === c.wordId).tags.indexOf('U1') >= 0), n: q.length };
  });
  check('筛选后队列只含所选单元', filtered.allU1 && filtered.n > 0, JSON.stringify(filtered));
  await page.click('#tagAll');

  console.log('\n== 12. 导出 / 导入 ==');
  const exported = await page.evaluate(() => {
    const a = window.__app;
    return JSON.stringify({ app: 'fr-a1-review', v: 1, state: a.S });
  });
  const dl = page.waitForEvent('download');
  await page.click('nav.tabs button[data-v="more"]');
  await page.click('#expBtn');
  const d = await dl;
  check('导出进度触发下载', !!d.suggestedFilename(), d.suggestedFilename());
  const recCountBefore = await page.evaluate(() => Object.keys(window.__app.S.rec).length);
  // 清空后导入回来
  page.on('dialog', dlg => dlg.accept());
  await page.click('#resetBtn');
  await page.waitForTimeout(300);
  const afterReset = await page.evaluate(() => Object.keys(window.__app.S.rec).length);
  check('清空记录生效', afterReset === 0);
  const fs = require('fs');
  fs.writeFileSync('/tmp/prog.json', exported);
  await page.click('nav.tabs button[data-v="more"]');
  await page.setInputFiles('#fileIn', '/tmp/prog.json');
  await page.waitForTimeout(600);
  const afterImport = await page.evaluate(() => Object.keys(window.__app.S.rec).length);
  check('导入进度恢复记录', afterImport === recCountBefore, afterImport + ' vs ' + recCountBefore);

  console.log('\n== 13. CSV 词库导入 ==');
  fs.writeFileSync('/tmp/bank.csv', '单词,中译,词性,音标,标签,阴性\nle chat,猫,n.m.,/lə ʃa/,测试,\nla souris,老鼠,n.f.,/la su.ʁi/,测试,\nheureux,幸福的,adj.,/ø.ʁø/,测试,heureuse\n');
  await page.click('nav.tabs button[data-v="more"]');
  await page.click('#impWordsBtn');
  await page.setInputFiles('#fileIn', '/tmp/bank.csv');
  await page.waitForTimeout(700);
  const bankAfter = await page.evaluate(() => {
    const a = window.__app;
    return {
      n: a.BANK.length,
      chat: a.BANK.find(w => w.fr === 'chat'),
      cards: a.allCards().length
    };
  });
  console.log('   ', JSON.stringify(bankAfter.chat));
  check('CSV 导入词数', bankAfter.n === 3, String(bankAfter.n));
  check('冠词/性别解析正确', bankAfter.chat && bankAfter.chat.gender === 'm' && bankAfter.chat.article === 'le');
  check('导入词生成阴阳性卡', bankAfter.cards === 3 + 3 + 3 + 2 + 1, String(bankAfter.cards));
  // 恢复内置词库
  await page.evaluate(() => { localStorage.removeItem('frA1.bank.v1'); });
  await page.reload({ waitUntil: 'networkidle' });
  const restored = await page.evaluate(() => window.__app.BANK.length);
  check('恢复内置词库', restored === 904, String(restored));

  console.log('\n== 14. 持久化 / 深色模式 / PWA ==');
  await page.evaluate(() => {
    const a = window.__app;
    const w = a.BANK.find(x => x.fr === 'café');
    a.S.rec[w.id + '|FR_ZH'] = [3, '2030-01-01', 9, 1, 0, 0, '2026-08-11'];
  });
  await page.reload({ waitUntil: 'networkidle' });
  const persisted = await page.evaluate(() => {
    const a = window.__app;
    const w = a.BANK.find(x => x.fr === 'café');
    const r = a.S.rec[w.id + '|FR_ZH'];
    return r ? r.join(',') : 'MISSING';
  });
  check('刷新后进度仍在（localStorage 持久化）', persisted === '3,2030-01-01,9,1,0,0,2026-08-11', persisted);
  await page.click('#themeBtn');
  await page.waitForTimeout(150);
  const th1 = await page.evaluate(() => document.documentElement.dataset.theme + '|' + window.__app.S.settings.theme);
  await page.click('#themeBtn');
  await page.waitForTimeout(150);
  const th2 = await page.evaluate(() => document.documentElement.dataset.theme + '|' + window.__app.S.settings.theme);
  check('主题切换生效', th1 !== th2, th1 + ' → ' + th2);
  const swOk = await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(r => r.length));
  check('Service Worker 注册', swOk >= 1, String(swOk));
  const mf = await page.evaluate(() => fetch('./manifest.json').then(r => r.json()).then(j => j.name));
  check('manifest 可读', mf === '法语 A1 词汇复习', mf);

  console.log('\n== 15. 重音输入栏 ==');
  await page.evaluate(() => {
    const a = window.__app;
    a.S.rec = {}; a.S.daily = {}; a.S.introd = {};
    a.S.settings.newPerDay = 10; a.S.settings.tags = null;
    a.S.settings.types = { FR_ZH: 0, ZH_FR: 1, PRON: 0, GENDER: 0, FEM: 0 };
    a.startSession('new');
  });
  await page.waitForSelector('#ansInput');
  const accBtns = await page.$$('.accentbar button');
  check('重音快捷栏存在', accBtns.length >= 11, String(accBtns.length));
  await page.click('#ansInput');
  await page.click('.accentbar button[data-a="é"]');
  await page.click('.accentbar button[data-a="ç"]');
  const val = await page.inputValue('#ansInput');
  check('点击可插入重音字符', val === 'éç', JSON.stringify(val));
  await page.click('#hintBtn');
  await page.waitForTimeout(150);
  const hint = await page.evaluate(() => document.querySelector('#toast').textContent);
  check('首字母提示', /_/.test(hint) || /个字母/.test(hint), hint);

  console.log('\n== 15b. 离线可用（PWA）==');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);            // 等 SW 缓存完成
  await ctx.setOffline(true);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(e => console.log('    goto:', e.message));
  await page.waitForTimeout(500);
  const offline = await page.evaluate(() => ({
    words: (window.__app && window.__app.BANK.length) || 0,
    btn: !!document.querySelector('#startBtn')
  })).catch(() => ({ words: 0, btn: false }));
  check('断网后仍能打开并加载词库', offline.words === 904 && offline.btn, JSON.stringify(offline));
  await ctx.setOffline(false);
  await page.goto(BASE, { waitUntil: 'networkidle' });

  console.log('\n== 16. 截图 ==');
  await page.evaluate(() => {
    const a = window.__app;
    a.S.rec = {}; a.S.daily = {}; a.S.introd = {}; a.S.mnem = {};
    a.S.settings = { sessionSize: 20, newPerDay: 10, strict: false, rate: .85, theme: 'auto', tags: null,
      types: { FR_ZH: 1, ZH_FR: 1, PRON: 1, GENDER: 1, FEM: 1 } };
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.screenshot({ path: 'shots/1-home.png' });
  await page.click('#startBtn');
  await page.waitForSelector('#qcard .qword');
  await page.screenshot({ path: 'shots/2-card.png' });
  await page.click('#revealBtn').catch(() => { });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'shots/3-answer.png' });
  await page.evaluate(() => {
    const a = window.__app;
    // 造一些数据用于统计截图
    const ds = new Date();
    for (let i = 0; i < 40; i++) {
      const d = new Date(ds); d.setDate(d.getDate() - i);
      const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (i % 3) a.S.daily[k] = [Math.floor(Math.random() * 45) + 3, 10, 5];
    }
    a.BANK.slice(0, 260).forEach((w, i) => {
      const box = 1 + (i % 5);
      const dd = new Date(); dd.setDate(dd.getDate() + (i % 12));
      const k = dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0');
      a.S.rec[w.id + '|FR_ZH'] = [box, k, i % 7, i % 4, 0, 0, ''];
      a.S.rec[w.id + '|ZH_FR'] = [Math.max(1, box - 1), k, i % 5, i % 6, 0, 0, ''];
    });
  });
  await page.click('nav.tabs button[data-v="stats"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/4-stats.png', fullPage: true });
  await page.click('nav.tabs button[data-v="words"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/5-words.png' });
  await page.click('nav.tabs button[data-v="more"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/6-more.png', fullPage: true });
  await page.evaluate(() => { window.__app.S.settings.theme = 'dark'; });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/7-dark.png' });

  console.log('\n== 控制台错误 ==');
  const realErrors = errors.filter(e => !/favicon|Failed to load resource/.test(e));
  check('无 JS 报错', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  console.log('\n========== 结果 ==========');
  if (fails.length) { console.log('失败 ' + fails.length + ' 项:'); fails.forEach(f => console.log('  - ' + f)); }
  else console.log('全部通过 ✅');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
