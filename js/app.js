/**
 * 主逻辑
 * 负责四个功能页的交互：今日记录(血压/体重/腹透)、用药清单、身体不适、统计图表。
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
    const [bp, weight, pd] = await Promise.all([
      DB.getByDate('bp', TODAY),
      DB.getByDate('weight', TODAY),
      DB.getByDate('pd', TODAY),
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

    pd.sort((a, b) => a.time.localeCompare(b.time));
    const total = pd.reduce((s, x) => s + (x.net ?? 0), 0);
    $('pdTotalText').textContent = total;
    renderList($('pdList'), pd, (x) => `
      <div class="item-main">
        <div class="item-title">入 ${esc(x.in)} / 出 ${esc(x.out)} ml　超滤 <b>${esc(x.net)}</b> ml</div>
        <div class="item-sub">${esc(x.time)}</div>
      </div>
      <button class="item-del" data-id="${x.id}">删</button>`);
    onDelete($('pdList'), 'pd', loadDaily);
  }

  // 血压保存
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
  });

  // 体重保存
  $('weightForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await DB.add('weight', { date: $('weightDate').value, time: $('weightTime')?.value || nowTime(), weight: +$('weightValue').value });
    toast('体重已保存');
    $('weightForm').reset(); fillDefaults();
  });

  // 腹透每袋保存（超滤=出-入，自动算）
  $('pdForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inV = +$('pdIn').value, outV = +$('pdOut').value;
    if (outV < inV && !confirm(`本次出液(${outV}ml)小于入液(${inV}ml)，超滤为负数，确定保存吗？`)) return;
    await DB.add('pd', { date: $('pdDate').value, time: $('pdTime').value, in: inV, out: outV, net: outV - inV });
    toast('本袋已保存');
    $('pdForm').reset(); fillDefaults();
  });

  // ---- 用药清单 ----
  async function loadMeds() {
    const meds = await DB.getAll('meds');
    renderList($('medList'), meds, (x) => `
      <div class="item-main">
        <div class="item-title">${esc(x.name)} <span style="font-weight:normal;color:${esc(x.dose) ? '' : 'var(--muted)'}">${esc(x.dose)}</span></div>
        <div class="item-sub">${esc(x.times) || '次数待定'}</div>
      </div>
      <button class="item-del" data-id="${x.id}">删</button>`);
    onDelete($('medList'), 'meds', loadMeds);
  }
  $('medForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await DB.add('meds', { name: $('medName').value.trim(), dose: $('medDose').value.trim(), times: $('medTimes').value.trim() });
    toast('已添加药物');
    $('medForm').reset();
    loadMeds();
  });

  // ---- 身体不适 ----
  async function loadSymptoms() {
    const list = await DB.getAll('symptom');
    list.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    renderList($('symList'), list, (x) => `
      <div class="item-main">
        <div class="item-title">${esc(x.desc)}</div>
        <div class="item-sub">${esc(x.date)} ${esc(x.time)}${x.note ? '　' + esc(x.note) : ''}</div>
      </div>
      <button class="item-del" data-id="${x.id}">删</button>`);
    onDelete($('symList'), 'symptom', loadSymptoms);
  }
  $('symptomForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await DB.add('symptom', { date: $('symDate').value, time: $('symTime').value, desc: $('symDesc').value.trim(), note: $('symNote').value.trim() });
    toast('不适已记录');
    $('symptomForm').reset(); fillDefaults();
    $('symNote').value = '';
  });

  // ---- 统计报表 ----
  const storeOf = { bp: 'bp', weight: 'weight', pd: 'pd' };
  let chart = null;

  function rangeStart(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return fmtDate(d);
  }

  async function renderStat() {
    if (!window.Chart) { $('statNote').textContent = '图表组件未加载，请联网后重试'; return; }
    const metric = $('statMetric').value;
    const range = $('statRange').value;
    const all = await DB.getAll(storeOf[metric]);
    const start = range === 'all' ? null : rangeStart(Number(range));
    const rows = all.filter((r) => !start || r.date >= start);
    rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

    if (chart) { chart.destroy(); chart = null; }
    $('statNote').textContent = '';
    const ctx = $('statChart').getContext('2d');

    if (metric === 'bp') {
      if (!rows.length) { $('statNote').textContent = '该范围内暂无血压记录'; return; }
      chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: rows.map((r) => r.date.slice(5) + ' ' + r.time),
          datasets: [
            { label: '高压', data: rows.map((r) => r.high), borderColor: '#e53935', backgroundColor: 'transparent', tension: 0.3, spanGaps: true },
            { label: '低压', data: rows.map((r) => r.low), borderColor: '#1e88e5', backgroundColor: 'transparent', tension: 0.3, spanGaps: true },
            ...(rows.some((r) => r.pulse != null) ? [{ label: '心率', data: rows.map((r) => r.pulse), borderColor: '#8e24aa', backgroundColor: 'transparent', tension: 0.3, spanGaps: true, yAxisID: 'y1' }] : []),
          ],
        },
        options: {
          responsive: true, spanGaps: true,
          scales: {
            y: { title: { display: true, text: 'mmHg' } },
            y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: rows.some((r) => r.pulse != null), text: '次/分' } },
            x: { ticks: { maxTicksLimit: 10, maxRotation: 45 } },
          },
          plugins: { legend: { labels: { usePointStyle: true } } },
        },
      });
    } else if (metric === 'weight') {
      const map = new Map();
      rows.forEach((r) => map.set(r.date, r.weight)); // 同一天取最后一条
      if (!map.size) { $('statNote').textContent = '该范围内暂无体重记录'; return; }
      const labels = [...map.keys()];
      chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels.map((d) => d.slice(5)),
          datasets: [{ label: '体重(kg)', data: labels.map((d) => map.get(d)), borderColor: '#1e88e5', backgroundColor: 'transparent', tension: 0.3 }],
        },
        options: { responsive: true, spanGaps: true, scales: { y: { title: { display: true, text: 'kg' } } }, plugins: { legend: { display: false } } },
      });
    } else { // pd 每日超滤合计
      const map = new Map();
      rows.forEach((r) => map.set(r.date, (map.get(r.date) || 0) + (r.net || 0)));
      if (!map.size) { $('statNote').textContent = '该范围内暂无腹透记录'; return; }
      const labels = [...map.keys()];
      chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels.map((d) => d.slice(5)),
          datasets: [{ label: '每日超滤(ml)', data: labels.map((d) => map.get(d)), backgroundColor: '#1e88e5' }],
        },
        options: { responsive: true, scales: { y: { title: { display: true, text: 'ml' } } }, plugins: { legend: { display: false } } },
      });
    }
  }

  $('statMetric').addEventListener('change', renderStat);
  $('statRange').addEventListener('change', renderStat);

  // ---- 启动 ----
  fillDefaults();
  loadDaily();
  loadMeds();
  loadSymptoms();
})();