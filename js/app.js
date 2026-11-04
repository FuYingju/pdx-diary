/**
 * 主逻辑
 * 负责四个功能页的交互：记录(血压/体重/腹透超滤)、用药清单、记事本、统计图表。
 * 所有数据读写都通过 DB（IndexedDB）完成，仅存本机。
 */

(() => {
  const $ = (id) => document.getElementById(id);

  // ---- 工具函数 ----
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => fmtDate(new Date());
  const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 超滤浓度标识：1.5% 黄色，2.5% 绿色（图表取亮色，文字取深色保证可读）
  const CONC_COLOR = { '1.5': '#f9a825', '2.5': '#43a047' };
  const concClass = (c) => (c === 1.5 ? 'net-15' : c === 2.5 ? 'net-25' : '');

  // 行内操作图标：铅笔=编辑，垃圾桶=删除
  const ICON_EDIT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  const ICON_DEL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  const TODAY = todayStr();
  $('todayText').textContent = TODAY;

  // ---- 底部导航切换 ----
  const navItems = document.querySelectorAll('.nav-item');
  function switchPage(name) {
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + name));
    navItems.forEach((b) => b.classList.toggle('active', b.dataset.page === name));
    if (name === 'stats') renderStat();
    if (name === 'notes') loadNotes();
  }
  navItems.forEach((b) => b.addEventListener('click', () => switchPage(b.dataset.page)));

  // 通用：向一个 ul 填充列表项
  function renderList(el, items, buildFn) {
    el.innerHTML = '';
    if (!items.length) {
      el.innerHTML = '<li class="empty">暂无记录</li>';
      return;
    }
    items.forEach((item) => {
      const li = document.createElement('li');
      li.innerHTML = buildFn(item);
      el.appendChild(li);
    });
  }
  // 列表项删除（事件委托）
  function onDelete(listEl, store, reload) {
    listEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('.item-del');
      if (!btn) return;
      await DB.remove(store, Number(btn.dataset.id));
      toast('已删除');
      reload();
    });
  }

  // ---- 今日记录 ----
  function fillDefaults() {
    $('bpDate').value = TODAY; $('bpTime').value = nowTime();
    $('weightDate').value = TODAY;
    $('pdDate').value = TODAY; $('pdTime').value = nowTime();
  }

  async function loadDaily() {
    // 列表跟随各自日期选择器：切到哪天就看哪天的记录
    const bpD = $('bpDate').value || TODAY;
    const wD = $('weightDate').value || TODAY;
    const [bp, weight] = await Promise.all([
      DB.getByDate('bp', bpD),
      DB.getByDate('weight', wD),
    ]);

    bp.sort((a, b) => a.time.localeCompare(b.time));
    renderList($('bpList'), bp, (x) => `
      <div class="item-main">
        <div class="item-title">${esc(x.high)}/<span class="low">${esc(x.low)}</span> mmHg ${x.pulse != null ? `｜ 心率 ${esc(x.pulse)}` : ''}</div>
        <div class="item-sub">${esc(x.time)}</div>
      </div>
      <button class="item-del" data-id="${x.id}" aria-label="删除" title="删除">${ICON_DEL}</button>`);
    onDelete($('bpList'), 'bp', loadDaily);

    weight.sort((a, b) => a.time.localeCompare(b.time));
    renderList($('weightList'), weight, (x) => `
      <div class="item-main">
        <div class="item-title">${esc(x.weight)} kg</div>
        <div class="item-sub">${esc(x.time)}</div>
      </div>
      <button class="item-del" data-id="${x.id}" aria-label="删除" title="删除">${ICON_DEL}</button>`);
    onDelete($('weightList'), 'weight', loadDaily);
  }

  // 血压保存后自动刷新列表
  $('bpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pulse = $('bpPulse').value;
    await DB.add('bp', {
      date: $('bpDate').value, time: $('bpTime').value,
      high: +$('bpHigh').value, low: +$('bpLow').value,
      pulse: pulse !== '' ? +pulse : null,
    });
    toast('血压已保存');
    $('bpForm').reset(); fillDefaults();
    loadDaily();
  });

  // 体重保存后自动刷新列表
  $('weightForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await DB.add('weight', { date: $('weightDate').value, time: $('weightTime')?.value || nowTime(), weight: +$('weightValue').value });
    toast('体重已保存');
    $('weightForm').reset(); fillDefaults();
    loadDaily();
  });

  // 切换日期时重新加载对应日期的记录
  $('bpDate').addEventListener('change', loadDaily);
  $('weightDate').addEventListener('change', loadDaily);

  // ---- 腹透超滤（独立页）----
  async function loadPd() {
    // 列表与合计跟随日期选择器
    const d = $('pdDate').value || TODAY;
    const pd = await DB.getByDate('pd', d);
    pd.sort((a, b) => a.time.localeCompare(b.time));
    const total = pd.reduce((s, x) => s + (x.net ?? 0), 0);
    $('pdTotalText').textContent = total;
    renderList($('pdList'), pd, (x) => `
      <div class="item-main">
        <div class="item-title">入 ${esc(x.in)} / 出 ${esc(x.out)} ml　超滤 <b class="${concClass(x.conc)}">${esc(x.net)}</b> ml</div>
        <div class="item-sub">${esc(x.time)}${x.conc ? '　' + esc(x.conc) + '%' : ''}</div>
      </div>
      <button class="item-del" data-id="${x.id}" aria-label="删除" title="删除">${ICON_DEL}</button>`);
    onDelete($('pdList'), 'pd', loadPd);
  }
  // 保存本袋后自动刷新列表与今日合计
  $('pdForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inV = +$('pdIn').value, outV = +$('pdOut').value;
    if (outV < inV && !confirm(`本次出液(${outV}ml)小于入液(${inV}ml)，超滤为负数，确定保存吗？`)) return;
    await DB.add('pd', { date: $('pdDate').value, time: $('pdTime').value, conc: +$('pdConc').value, in: inV, out: outV, net: outV - inV });
    toast('本袋已保存');
    $('pdForm').reset(); fillDefaults();
    loadPd();
  });

  // 切换日期时重新加载对应日期的记录与合计
  $('pdDate').addEventListener('change', loadPd);

  // ---- 用药清单 ----
  // 用药详情视图当前查看的药物
  let curMed = null;

  // 主界面：一页一个药的大卡片
  async function loadMeds() {
    const meds = await DB.getAll('meds');
    const grid = $('medGrid');
    grid.innerHTML = '';
    if (!meds.length) {
      grid.innerHTML = '<div class="empty">还没有药，先在上方添加一个吧</div>';
      return;
    }
    meds.forEach((x) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'med-card';
      card.innerHTML = x.cover
        ? `<img class="med-card-img" src="${x.cover}" alt="药盒">`
        : `<div class="med-card-img med-card-noimg">${esc(x.name.trim().slice(0, 1))}</div>`;
      card.innerHTML += `<div class="med-card-name">${esc(x.name)}</div>${x.category ? `<div class="med-card-tag">${esc(x.category)}</div>` : ''}`;
      card.addEventListener('click', () => showMedDetail(x));
      grid.appendChild(card);
    });
  }

  // 点击药卡片，进入详情视图
  function showMedDetail(x) {
    curMed = x;
    $('medDetailCover').innerHTML = x.cover
      ? `<img src="${x.cover}" alt="药盒">`
      : `<div class="med-detail-noimg">${esc(x.name.trim().slice(0, 1))}</div>`;
    $('medDetailName').textContent = x.name;
    $('medDetailCat').innerHTML = x.category ? `<span class="med-detail-tag">${esc(x.category)}</span>` : '';
    $('medDetailInfo').innerHTML = `
      <div class="med-detail-row"><span>剂量</span><b>${esc(x.dose) || '未填写'}</b></div>
      <div class="med-detail-row"><span>怎么吃</span><b>${esc(x.times) || '未填写'}</b></div>
      <div class="med-detail-row"><span>价格</span><b>${x.price !== '' ? esc(x.price) + ' 元' : '未填写'}</b></div>`;
    $('medDetailInfo').hidden = false;
    $('medEditForm').hidden = true;
    $('medGrid').hidden = true;
    $('medForm').closest('.card').hidden = true;
    $('medDetail').hidden = false;
  }

  function hideMedDetail() {
    $('medDetail').hidden = true;
    $('medGrid').hidden = false;
    $('medForm').closest('.card').hidden = false;
  }

  $('medBackBtn').addEventListener('click', hideMedDetail);

  // 详情页的编辑/删除按钮用图标
  $('medEditBtn').innerHTML = ICON_EDIT;
  $('medDelBtn').innerHTML = ICON_DEL;

  // 新增药品：展开/收起添加表单
  $('medAddBtn').addEventListener('click', () => {
    const f = $('medForm');
    f.hidden = !f.hidden;
    if (!f.hidden) $('medName').focus();
  });

  // 取消新增：收起表单并清空已填内容
  $('medCancelBtn').addEventListener('click', () => {
    $('medForm').reset();
    $('medForm').hidden = true;
  });

  // 编辑：把当前药的信息预填进编辑表单
  $('medEditBtn').addEventListener('click', () => {
    if (!curMed) return;
    $('medEName').value = curMed.name;
    $('medECategory').value = curMed.category || '';
    $('medEDose').value = curMed.dose || '';
    $('medEPrice').value = curMed.price !== '' ? curMed.price : '';
    $('medETimes').value = curMed.times || '';
    $('medECover').value = '';
    $('medDetailInfo').hidden = true;
    $('medEditForm').hidden = false;
  });

  // 保存修改
  $('medEditForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = $('medECover').files[0];
    let cover = curMed.cover || '';
    if (file) {
      cover = await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.readAsDataURL(file);
      });
    }
    const price = $('medEPrice').value;
    await DB.update('meds', {
      id: curMed.id,
      name: $('medEName').value.trim(),
      category: $('medECategory').value.trim(),
      dose: $('medEDose').value.trim(),
      times: $('medETimes').value.trim(),
      price: price !== '' ? price : '',
      cover,
    });
    toast('已保存修改');
    hideMedDetail();
    loadMeds();
  });

  // 删除当前药
  $('medDelBtn').addEventListener('click', async () => {
    if (!curMed) return;
    if (!confirm(`确定删除「${curMed.name}」吗？`)) return;
    await DB.remove('meds', curMed.id);
    toast('已删除');
    hideMedDetail();
    loadMeds();
  });

  $('medForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = $('medCover').files[0];
    let cover = '';
    if (file) {
      cover = await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.readAsDataURL(file);
      });
    }
    const price = $('medPrice').value;
    await DB.add('meds', {
      name: $('medName').value.trim(),
      category: $('medCategory').value.trim(),
      dose: $('medDose').value.trim(),
      times: $('medTimes').value.trim(),
      price: price !== '' ? price : '',
      cover,
    });
    toast('已添加药物');
    $('medForm').reset();
    $('medForm').hidden = true;
    loadMeds();
  });

  // ---- 记事本 ----
  // 当前筛选的分类 id，null 表示看全部
  let curCat = null;
  // 最近一次读取的分类与记事，编辑时直接从这里取原始数据
  let noteCache = { cats: [], notes: [] };

  const fmtDateTime = (ts) => {
    const d = new Date(ts);
    return `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  async function loadNotes() {
    const [cats, notes] = await Promise.all([DB.getAll('noteCats'), DB.getAll('notes')]);
    cats.sort((a, b) => a.createdAt - b.createdAt);
    notes.sort((a, b) => b.createdAt - a.createdAt);
    noteCache = { cats, notes };

    // 分类筛选条：全部 + 各分类
    $('catBar').innerHTML =
      `<button class="cat-chip${curCat === null ? ' active' : ''}" data-cat="">全部</button>` +
      cats.map((c) => `<button class="cat-chip${curCat === c.id ? ' active' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`).join('');

    // 新增记事的分类下拉
    $('noteCat').innerHTML = cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

    // 记事列表：按当前分类筛选，最新的在最上面
    const list = curCat === null ? notes : notes.filter((n) => n.catId === curCat);
    const box = $('noteList');
    if (!list.length) {
      box.innerHTML = `<div class="empty">${cats.length ? '这个分类下还没有记事' : '还没有分类，先新建一个分类吧'}</div>`;
      return;
    }
    const catName = (id) => (cats.find((c) => c.id === id) || {}).name || '';
    box.innerHTML = list.map((n) => `
      <div class="note-card" data-id="${n.id}">
        <div class="note-head">
          <div class="note-title">${esc(n.title)}</div>
          <div class="note-actions">
            <button class="item-edit" data-id="${n.id}" aria-label="编辑" title="编辑">${ICON_EDIT}</button>
            <button class="item-del" data-id="${n.id}" aria-label="删除" title="删除">${ICON_DEL}</button>
          </div>
        </div>
        ${n.body ? `<div class="note-body">${esc(n.body)}</div>` : ''}
        <div class="note-meta"><span class="note-cat">${esc(catName(n.catId))}</span>${esc(fmtDateTime(n.createdAt))}</div>
      </div>`).join('');
  }

  // 点击分类只看该类记事
  $('catBar').addEventListener('click', (e) => {
    const chip = e.target.closest('.cat-chip');
    if (!chip) return;
    curCat = chip.dataset.cat ? Number(chip.dataset.cat) : null;
    loadNotes();
  });

  // 删除记事 / 展开编辑表单
  $('noteList').addEventListener('click', async (e) => {
    const delBtn = e.target.closest('.item-del');
    if (delBtn) {
      if (!confirm('确定删除这条记事吗？')) return;
      await DB.remove('notes', Number(delBtn.dataset.id));
      toast('已删除');
      loadNotes();
      return;
    }

    const editBtn = e.target.closest('.item-edit');
    if (editBtn) startEditNote(Number(editBtn.dataset.id), editBtn.closest('.note-card'));
  });

  // 编辑：把卡片原地换成表单，分类、标题、正文都可改
  function startEditNote(id, card) {
    const n = noteCache.notes.find((x) => x.id === id);
    if (!n || !card) return;
    card.outerHTML = `
      <div class="card">
        <form class="entry-form note-edit" data-id="${id}">
          <label>分类<select class="ne-cat">${noteCache.cats.map((c) => `<option value="${c.id}"${c.id === n.catId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <label>标题<input type="text" class="ne-title" value="${esc(n.title)}" required></label>
          <label>正文<textarea class="ne-body" rows="5">${esc(n.body)}</textarea></label>
          <div class="med-form-actions">
            <button type="submit" class="btn">保存</button>
            <button type="button" class="btn ghost ne-cancel">取消</button>
          </div>
        </form>
      </div>`;
  }

  // 保存编辑：基于原记录整体覆盖，只改分类、标题、正文
  $('noteList').addEventListener('submit', async (e) => {
    const form = e.target.closest('.note-edit');
    if (!form) return;
    e.preventDefault();
    const orig = noteCache.notes.find((x) => x.id === Number(form.dataset.id));
    await DB.update('notes', {
      ...orig,
      catId: Number(form.querySelector('.ne-cat').value),
      title: form.querySelector('.ne-title').value.trim(),
      body: form.querySelector('.ne-body').value.trim(),
    });
    toast('已保存修改');
    loadNotes();
  });

  // 取消编辑：重新渲染卡片
  $('noteList').addEventListener('click', (e) => {
    if (e.target.closest('.ne-cancel')) loadNotes();
  });

  // 新建分类：展开/收起表单
  $('catAddBtn').addEventListener('click', () => {
    const f = $('catForm');
    f.hidden = !f.hidden;
    if (!f.hidden) $('catName').focus();
  });
  $('catCancelBtn').addEventListener('click', () => {
    $('catForm').reset();
    $('catForm').hidden = true;
  });
  $('catForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await DB.add('noteCats', { name: $('catName').value.trim(), createdAt: Date.now() });
    toast('分类已新建');
    $('catForm').reset();
    $('catForm').hidden = true;
    loadNotes();
  });

  // 管理分类：列出全部分类，可删除；有记事的分类不允许删
  $('catManageBtn').addEventListener('click', () => {
    const box = $('catManage');
    box.hidden = !box.hidden;
    if (!box.hidden) renderCatManage();
  });

  async function renderCatManage() {
    const [cats, notes] = await Promise.all([DB.getAll('noteCats'), DB.getAll('notes')]);
    cats.sort((a, b) => a.createdAt - b.createdAt);
    const box = $('catManage');
    if (!cats.length) { box.innerHTML = '<div class="empty">还没有分类</div>'; return; }
    box.innerHTML = cats.map((c) => {
      const used = notes.some((n) => n.catId === c.id);
      return `<div class="cat-manage-row"><span>${esc(c.name)}${used ? '（有记事）' : ''}</span>
        <button class="item-del cat-del" data-id="${c.id}" ${used ? 'disabled' : ''} aria-label="删除分类" title="删除分类">${ICON_DEL}</button></div>`;
    }).join('');
  }

  $('catManage').addEventListener('click', async (e) => {
    const btn = e.target.closest('.cat-del');
    if (!btn || btn.disabled) return;
    if (!confirm('确定删除这个分类吗？')) return;
    const id = Number(btn.dataset.id);
    await DB.remove('noteCats', id);
    if (curCat === id) curCat = null;
    toast('分类已删除');
    $('catManage').hidden = true;
    loadNotes();
  });

  // 新增记事：还没有分类时先提示建分类
  $('noteAddBtn').addEventListener('click', () => {
    if (!$('noteCat').options.length) { toast('请先新建分类'); return; }
    const f = $('noteForm');
    f.hidden = !f.hidden;
    if (!f.hidden) $('noteTitle').focus();
  });
  $('noteCancelBtn').addEventListener('click', () => {
    $('noteForm').reset();
    $('noteForm').hidden = true;
  });
  $('noteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await DB.add('notes', {
      catId: Number($('noteCat').value),
      title: $('noteTitle').value.trim(),
      body: $('noteBody').value.trim(),
      createdAt: Date.now(),
    });
    toast('记事已保存');
    $('noteForm').reset();
    $('noteForm').hidden = true;
    loadNotes();
  });

  // ---- 统计报表 ----
  const storeOf = { bp: 'bp', weight: 'weight', pd: 'pd' };
  let chart = null;

  function rangeStart(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return fmtDate(d);
  }

  // 按数据范围自动缩放 y 轴（不强制从 0 开始），放大波动差异
  function autoScale(values, minPad) {
    const nums = values.filter((v) => v != null);
    if (!nums.length) return {};
    const min = Math.min(...nums), max = Math.max(...nums);
    const pad = Math.max((max - min) * 0.2, minPad);
    return { min: Math.floor(min - pad), max: Math.ceil(max + pad) };
  }

  // 统计明细表格：仅日期时间、数据两列，展示统计范围内全部记录
  function buildStatTable(rows, fmt) {
    const box = $('statTable');
    if (!rows.length) { box.innerHTML = ''; return; }
    // 倒序显示：最新的记录排在最上面
    box.innerHTML = '<table class="stat-table"><thead><tr><th>日期时间</th><th>数据</th></tr></thead><tbody>' +
      [...rows].reverse().map((r) => `<tr><td>${esc(r.date)} ${esc(r.time)}</td><td>${fmt(r)}</td></tr>`).join('') +
      '</tbody></table>';
  }

  async function renderStat() {
    if (!window.Chart) { $('statNote').textContent = '图表组件未加载，请联网后重试'; return; }
    const metric = $('statMetric').value;
    const range = $('statRange').value;
    const isToday = range === 'today';
    const all = await DB.getAll(storeOf[metric]);
    const start = range === 'all' ? null : (isToday ? TODAY : rangeStart(Number(range)));
    const rows = all.filter((r) => !start || r.date >= start);
    rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

    if (chart) { chart.destroy(); chart = null; }
    $('statNote').textContent = '';
    $('statTable').innerHTML = '';
    const ctx = $('statChart').getContext('2d');

    // x 轴标签：当天显示 时:分；其他范围显示 月-日，每天取最早的一条
    const xLabel = (r) => (isToday ? r.time : r.date.slice(5));
    let points;
    if (isToday) {
      points = rows;
    } else {
      // 同一天有多条记录时取最早的一条（晨起那次记录最重要）
      const byDay = new Map();
      rows.forEach((r) => { if (!byDay.has(r.date)) byDay.set(r.date, r); });
      points = [...byDay.values()];
    }

    if (metric === 'bp') {
      if (!points.length) { $('statNote').textContent = '该范围内暂无血压记录'; return; }
      const highs = points.map((r) => r.high);
      const lows = points.map((r) => r.low);
      // 双 y 轴：左轴对应高压、右轴对应低压，各自按自身数据范围缩放，凸显两条线的波动
      const yScale = autoScale(highs, 5);
      const y1Scale = autoScale(lows, 5);
      chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: points.map(xLabel),
          datasets: [
            { label: '高压', data: highs, borderColor: '#e53935', backgroundColor: 'transparent', tension: 0.3, spanGaps: true, yAxisID: 'y' },
            { label: '低压', data: lows, borderColor: '#1e88e5', backgroundColor: 'transparent', tension: 0.3, spanGaps: true, yAxisID: 'y1' },
          ],
        },
        options: {
          responsive: true, spanGaps: true,
          scales: {
            y: Object.assign({ position: 'left', ticks: { color: '#e53935' } }, yScale),
            y1: Object.assign({ position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#1e88e5' } }, y1Scale),
            x: { ticks: { maxTicksLimit: isToday ? 12 : 10, maxRotation: 45, autoSkip: true } },
          },
          plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14 } } },
        },
      });
      // 血压明细表：高压/低压，有心率则附上
      buildStatTable(rows, (r) => `${esc(r.high)}/${esc(r.low)} mmHg${r.pulse != null ? `｜心率 ${esc(r.pulse)}` : ''}`);
    } else if (metric === 'weight') {
      if (!points.length) { $('statNote').textContent = '该范围内暂无体重记录'; return; }
      chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: points.map(xLabel),
          datasets: [{ label: '体重 (kg)', data: points.map((r) => r.weight), borderColor: '#1e88e5', backgroundColor: 'transparent', tension: 0.3, spanGaps: true }],
        },
        options: {
          responsive: true, spanGaps: true,
          scales: { y: {}, x: { ticks: { maxTicksLimit: isToday ? 12 : 10, maxRotation: 45, autoSkip: true } } },
          plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14 } } },
        },
      });
      // 体重明细表
      buildStatTable(rows, (r) => `${esc(r.weight)} kg`);
    } else { // pd 每日超滤合计
      // 按天汇总，并把超滤量按浓度拆开，便于柱状图分色
      const map = new Map();
      rows.forEach((r) => {
        const day = map.get(r.date) || { '1.5': 0, '2.5': 0, other: 0 };
        const key = r.conc === 1.5 ? '1.5' : r.conc === 2.5 ? '2.5' : 'other';
        day[key] += r.net || 0;
        map.set(r.date, day);
      });
      if (!map.size) { $('statNote').textContent = '该范围内暂无腹透记录'; return; }
      // 原始日期用于取数，X 轴显示月-日
      const dates = [...map.keys()].sort();
      const series = (key) => dates.map((d) => map.get(d)[key]);
      const datasets = [
        { label: '1.5% 超滤', data: series('1.5'), backgroundColor: CONC_COLOR['1.5'] },
        { label: '2.5% 超滤', data: series('2.5'), backgroundColor: CONC_COLOR['2.5'] },
      ];
      // 早期记录没有浓度字段，单独一层显示，避免漏算当日总量
      if (rows.some((r) => r.conc !== 1.5 && r.conc !== 2.5)) {
        datasets.push({ label: '未标注浓度', data: series('other'), backgroundColor: '#90a4ae' });
      }
      chart = new Chart(ctx, {
        type: 'bar',
        data: { labels: dates.map((d) => d.slice(5)), datasets },
        options: {
          responsive: true,
          scales: {
            x: { stacked: true, ticks: { maxTicksLimit: 10, maxRotation: 45, autoSkip: true } },
            y: { stacked: true },
          },
          plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14 } } },
        },
      });
      // 超滤明细表：每袋净超滤，正数带 + 号；数值按浓度着色
      buildStatTable(rows, (r) => `${r.net >= 0 ? '+' : ''}<span class="${concClass(r.conc)}">${esc(r.net)}</span> ml${r.conc ? `　${esc(r.conc)}%` : ''}`);
    }
  }

  $('statMetric').addEventListener('change', renderStat);
  $('statRange').addEventListener('change', renderStat);

  // ---- 启动 ----
  fillDefaults();
  loadDaily();
  loadPd();
  loadMeds();
  loadNotes();
})();
