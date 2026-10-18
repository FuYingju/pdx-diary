/**
 * 主逻辑
 * 负责四个功能页的交互：今日记录(血压/体重/不适)、用药清单、腹透超滤、统计图表。
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
    $('symDate').value = TODAY; $('symTime').value = nowTime();
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
      <button class="item-del" data-id="${x.id}">删</button>`);
    onDelete($('bpList'), 'bp', loadDaily);

    weight.sort((a, b) => a.time.localeCompare(b.time));
    renderList($('weightList'), weight, (x) => `
      <div class="item-main">
        <div class="item-title">${esc(x.weight)} kg</div>
        <div class="item-sub">${esc(x.time)}</div>
      </div>
      <button class="item-del" data-id="${x.id}">删</button>`);
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

  // ---- 身体不适（记录页）----
  async function loadSymptoms() {
    // 列表跟随日期选择器：切到哪天就看哪天的记录
    const d = $('symDate').value || TODAY;
    const list = await DB.getByDate('symptom', d);
    list.sort((a, b) => a.time.localeCompare(b.time));
    renderList($('symList'), list, (x) => `
      <div class="item-main">
        <div class="item-title">${esc(x.desc)}</div>
        <div class="item-sub">${esc(x.date)} ${esc(x.time)}${x.note ? '　' + esc(x.note) : ''}</div>
      </div>
      <button class="item-del" data-id="${x.id}">删</button>`);
    onDelete($('symList'), 'symptom', loadSymptoms);
  }
  // 保存不适后自动刷新列表
  $('symptomForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await DB.add('symptom', { date: $('symDate').value, time: $('symTime').value, desc: $('symDesc').value.trim(), note: $('symNote').value.trim() });
    toast('不适已记录');
    $('symptomForm').reset(); fillDefaults();
    $('symNote').value = '';
    loadSymptoms();
  });

  // 切换日期时重新加载对应日期的记录
  $('symDate').addEventListener('change', loadSymptoms);

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
        <div class="item-title">入 ${esc(x.in)} / 出 ${esc(x.out)} ml　超滤 <b>${esc(x.net)}</b> ml</div>
        <div class="item-sub">${esc(x.time)}</div>
      </div>
      <button class="item-del" data-id="${x.id}">删</button>`);
    onDelete($('pdList'), 'pd', loadPd);
  }
  // 保存本袋后自动刷新列表与今日合计
  $('pdForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inV = +$('pdIn').value, outV = +$('pdOut').value;
    if (outV < inV && !confirm(`本次出液(${outV}ml)小于入液(${inV}ml)，超滤为负数，确定保存吗？`)) return;
    await DB.add('pd', { date: $('pdDate').value, time: $('pdTime').value, in: inV, out: outV, net: outV - inV });
    toast('本袋已保存');
    $('pdForm').reset(); fillDefaults();
    loadPd();
  });

  // 切换日期时重新加载对应日期的记录与合计
  $('pdDate').addEventListener('change', loadPd);

  // ---- 用药清单 ----
  const MED_TITLE_KEY = 'medTitle';
  // 用药清单标题可自定义，默认提示文字，用户可改为"降压药""降磷药"等
  function loadMedTitle() {
    $('medTitleInput').value = localStorage.getItem(MED_TITLE_KEY) || '我的用药';
  }
  $('medTitleInput').addEventListener('change', () => {
    const v = $('medTitleInput').value.trim();
    if (!v) { loadMedTitle(); toast('标题不能为空'); return; }
    localStorage.setItem(MED_TITLE_KEY, v);
    toast('标题已更新');
  });

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

  // 新增药品：展开/收起添加表单
  $('medAddBtn').addEventListener('click', () => {
    const f = $('medForm');
    f.hidden = !f.hidden;
    if (!f.hidden) $('medName').focus();
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
    const ctx = $('statChart').getContext('2d');

    // x 轴标签：当天显示 时:分；其他范围按 年-月-日，取每日最新一条
    const xLabel = (r) => (isToday ? r.time : r.date);
    let points;
    if (isToday) {
      points = rows;
    } else {
      const byDay = new Map();
      rows.forEach((r) => byDay.set(r.date, r));
      points = [...byDay.values()];
    }

    if (metric === 'bp') {
      if (!points.length) { $('statNote').textContent = '该范围内暂无血压记录'; return; }
      const hasPulse = points.some((r) => r.pulse != null);
      const highs = points.map((r) => r.high);
      const lows = points.map((r) => r.low);
      const pulses = hasPulse ? points.map((r) => r.pulse) : [];
      // 双 y 轴：高压/低压共用左侧 mmHg 轴，心率用右侧 次/分 轴，均按数据范围自动缩放
      const yScale = autoScale([...highs, ...lows], 10);
      const y1Scale = hasPulse ? autoScale(pulses, 5) : {};
      chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: points.map(xLabel),
          datasets: [
            { label: '高压', data: highs, borderColor: '#e53935', backgroundColor: 'transparent', tension: 0.3, spanGaps: true },
            { label: '低压', data: lows, borderColor: '#1e88e5', backgroundColor: 'transparent', tension: 0.3, spanGaps: true },
            ...(hasPulse ? [{ label: '心率', data: pulses, borderColor: '#8e24aa', backgroundColor: 'transparent', tension: 0.3, spanGaps: true, yAxisID: 'y1' }] : []),
          ],
        },
        options: {
          responsive: true, spanGaps: true,
          scales: {
            y: Object.assign({}, yScale),
            y1: Object.assign({ position: 'right', grid: { drawOnChartArea: false } }, y1Scale),
            x: { ticks: { maxTicksLimit: isToday ? 12 : 10, maxRotation: 45, autoSkip: true } },
          },
          plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14 } } },
        },
      });
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
    } else { // pd 每日超滤合计
      const map = new Map();
      rows.forEach((r) => map.set(r.date, (map.get(r.date) || 0) + (r.net || 0)));
      if (!map.size) { $('statNote').textContent = '该范围内暂无腹透记录'; return; }
      const labels = [...map.keys()].sort();
      chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{ label: '每日超滤 (ml)', data: labels.map((d) => map.get(d)), backgroundColor: '#1e88e5' }],
        },
        options: {
          responsive: true,
          scales: { y: {}, x: { ticks: { maxTicksLimit: 10, maxRotation: 45, autoSkip: true } } },
          plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14 } } },
        },
      });
    }
  }

  $('statMetric').addEventListener('change', renderStat);
  $('statRange').addEventListener('change', renderStat);

  // ---- 启动 ----
  fillDefaults();
  loadDaily();
  loadPd();
  loadMeds();
  loadMedTitle();
  loadSymptoms();
})();
