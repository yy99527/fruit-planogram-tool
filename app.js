/* 水果陈列棚格图工具（实物化版） */
'use strict';

const $ = (id) => document.getElementById(id);
const canvasEl = $('canvas');
const STORAGE_KEY = 'fruit-planogram-v1';
const DB_NAME = 'fruit-planogram-images';
const STORE = 'images';

/* ---------------- 工具函数 ---------------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (min, max, v) => Math.max(min, Math.min(max, v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#888888');
  if (!m) return `rgba(136,136,136,${alpha})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

/* ---------------- IndexedDB 图片存储 ---------------- */
let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
async function idbPut(id, blob) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const rq = tx.objectStore(STORE).get(id);
    rq.onsuccess = () => resolve(rq.result || null);
    rq.onerror = () => reject(rq.error);
  });
}
async function idbDelete(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const imgUrlCache = new Map();
const imgUrlPending = new Map();
function imageUrl(imageId) {
  if (!imageId) return Promise.resolve(null);
  if (imgUrlCache.has(imageId)) return Promise.resolve(imgUrlCache.get(imageId));
  if (imgUrlPending.has(imageId)) return imgUrlPending.get(imageId);
  const p = idbGet(imageId).then((blob) => {
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    imgUrlCache.set(imageId, url);
    return url;
  });
  imgUrlPending.set(imageId, p);
  return p;
}

function setImgUrl(imgEl, imageId) {
  if (!imageId) return;
  imageUrl(imageId).then((u) => { if (u && imgEl.isConnected) imgEl.src = u; });
}

/* 图片压缩：最长边 600px，白底 JPEG */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const srcUrl = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const maxSide = 600;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        c.toBlob((b) => {
          URL.revokeObjectURL(srcUrl);
          if (b) resolve(b); else reject(new Error('blob failed'));
        }, 'image/jpeg', 0.85);
      } catch (e) { URL.revokeObjectURL(srcUrl); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(srcUrl); reject(new Error('load failed')); };
    img.src = srcUrl;
  });
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
function dataUrlToBlob(dataUrl) {
  const [head, data] = dataUrl.split(',');
  const mime = (head.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
  const bin = atob(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img load failed')); };
    img.src = url;
  });
}

/* ---------------- 默认示例 ---------------- */
function defaultState() {
  return {
    name: '门店A 水果区',
    grid: { cols: 12, rows: 8, cellSize: 36, cellCm: 10 },
    devices: [
      { id: 'd1', type: '货架', name: '货架A', x: 1, y: 1, w: 4, h: 3, color: '#3b82f6' },
      { id: 'd2', type: '水果柜', name: '水果柜B', x: 6, y: 1, w: 4, h: 2, color: '#10b981' },
      { id: 'd3', type: '堆头', name: '堆头C', x: 1, y: 5, w: 3, h: 2, color: '#f59e0b' },
    ],
    fruits: [
      { id: 'f1', name: '苹果', w: 1, h: 1, color: '#ef4444', emoji: '🍎' },
      { id: 'f2', name: '橙子', w: 1, h: 1, color: '#f97316', emoji: '🍊' },
      { id: 'f3', name: '葡萄盒', w: 1, h: 2, color: '#8b5cf6', emoji: '🍇' },
      { id: 'f4', name: '整箱苹果', w: 2, h: 2, color: '#dc2626', emoji: '📦' },
    ],
    placements: [
      { id: 'p1', fruitId: 'f1', x: 1, y: 1 },
      { id: 'p2', fruitId: 'f1', x: 2, y: 1 },
      { id: 'p3', fruitId: 'f1', x: 3, y: 1 },
      { id: 'p4', fruitId: 'f2', x: 1, y: 2 },
      { id: 'p5', fruitId: 'f2', x: 2, y: 2 },
      { id: 'p6', fruitId: 'f3', x: 3, y: 2 },
      { id: 'p7', fruitId: 'f4', x: 6, y: 1 },
      { id: 'p8', fruitId: 'f1', x: 8, y: 1 },
      { id: 'p9', fruitId: 'f3', x: 1, y: 5 },
    ],
  };
}

let state = loadState();
let selected = null;
let placingFruitId = null;
let activeDrag = null;
let pendingFruitImageId = null;
let pendingDevImageId = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.grid && Array.isArray(s.devices) && Array.isArray(s.fruits) && Array.isArray(s.placements)) return s;
    }
  } catch (e) { /* ignore */ }
  return defaultState();
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}
function fruitById(id) { return state.fruits.find((f) => f.id === id); }

/* ---------------- 选择 ---------------- */
function select(kind, id) {
  selected = kind ? { kind, id } : null;
  canvasEl.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
  if (selected) {
    const el = canvasEl.querySelector(`[data-kind="${kind}"][data-id="${CSS.escape(id)}"]`);
    if (el) el.classList.add('selected');
  }
}

/* ---------------- 渲染 ---------------- */
function render() {
  const { cols, rows, cellSize } = state.grid;
  canvasEl.style.setProperty('--cell', cellSize + 'px');
  canvasEl.style.width = (cols * cellSize) + 'px';
  canvasEl.style.height = (rows * cellSize) + 'px';
  canvasEl.innerHTML = '';

  state.devices.forEach((dev) => canvasEl.appendChild(buildDeviceEl(dev)));
  state.placements.forEach((pl) => {
    const el = buildPlacementEl(pl);
    if (el) canvasEl.appendChild(el);
  });

  if (selected) {
    const el = canvasEl.querySelector(`[data-kind="${selected.kind}"][data-id="${CSS.escape(selected.id)}"]`);
    if (el) el.classList.add('selected');
  }

  $('planName').value = state.name;
  renderDeviceList();
  renderFruitList();
  syncGridInputs();
}

function syncGridInputs() {
  $('gridCols').value = state.grid.cols;
  $('gridRows').value = state.grid.rows;
  $('cellSize').value = state.grid.cellSize;
  $('cellCm').value = state.grid.cellCm;
}

function buildDeviceEl(dev) {
  const cell = state.grid.cellSize;
  const el = document.createElement('div');
  el.className = 'device';
  el.dataset.kind = 'device';
  el.dataset.id = dev.id;
  el.style.left = (dev.x * cell) + 'px';
  el.style.top = (dev.y * cell) + 'px';
  el.style.width = (dev.w * cell) + 'px';
  el.style.height = (dev.h * cell) + 'px';
  el.style.borderColor = dev.color;
  if (!dev.imageId) el.style.background = hexToRgba(dev.color, 0.22);
  let inner = '';
  if (dev.imageId) inner += '<img class="dev-img" alt="">';
  inner += `<span class="dev-label">${esc(dev.name)}<br><span class="dev-size">${dev.w}×${dev.h} 格</span></span>`;
  inner += '<span class="resizer" title="拖动调整大小"></span>';
  el.innerHTML = inner;
  if (dev.imageId) setImgUrl(el.querySelector('.dev-img'), dev.imageId);
  bindDevice(el, dev);
  return el;
}

function buildPlacementEl(pl) {
  const fruit = fruitById(pl.fruitId);
  if (!fruit) return null;
  const cell = state.grid.cellSize;
  const el = document.createElement('div');
  el.className = 'placement';
  if (fruit.w <= 1 || fruit.h <= 1 || cell < 40) el.classList.add('small');
  el.dataset.kind = 'placement';
  el.dataset.id = pl.id;
  el.style.left = (pl.x * cell) + 'px';
  el.style.top = (pl.y * cell) + 'px';
  el.style.width = (fruit.w * cell) + 'px';
  el.style.height = (fruit.h * cell) + 'px';
  el.style.borderColor = fruit.color;
  const cm = state.grid.cellCm;
  const sizeText = `${fruit.w}×${fruit.h}格${cm ? ` · ${fruit.w * cm}×${fruit.h * cm}cm` : ''}`;
  if (fruit.imageId) {
    el.style.background = '#fff';
    el.innerHTML =
      `<img class="pl-img" alt="">` +
      `<span class="pl-cap"><span class="pl-name">${esc(fruit.name)}</span><span class="pl-size">${esc(sizeText)}</span></span>`;
    setImgUrl(el.querySelector('.pl-img'), fruit.imageId);
  } else {
    el.style.background = hexToRgba(fruit.color, 0.25);
    el.innerHTML =
      `<span class="emoji">${esc(fruit.emoji || '🍏')}</span>` +
      `<span class="pl-name">${esc(fruit.name)}</span>` +
      `<span class="pl-size">${esc(sizeText)}</span>`;
  }
  bindPlacement(el, pl);
  return el;
}

/* ---------------- 拖动：设备 / 水果块 ---------------- */
function bindDevice(el, dev) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select('device', dev.id);
    el.setPointerCapture(e.pointerId);
    activeDrag = { kind: 'device', id: dev.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origX: dev.x, origY: dev.y };
  });
  el.addEventListener('pointermove', (e) => {
    if (!activeDrag || activeDrag.id !== dev.id) return;
    const cell = state.grid.cellSize;
    if (activeDrag.kind === 'device') {
      const dx = e.clientX - activeDrag.startX;
      const dy = e.clientY - activeDrag.startY;
      dev.x = clamp(0, state.grid.cols - dev.w, Math.round((activeDrag.origX * cell + dx) / cell));
      dev.y = clamp(0, state.grid.rows - dev.h, Math.round((activeDrag.origY * cell + dy) / cell));
      el.style.left = (dev.x * cell) + 'px';
      el.style.top = (dev.y * cell) + 'px';
    } else if (activeDrag.kind === 'resize') {
      const dx = e.clientX - activeDrag.startX;
      const dy = e.clientY - activeDrag.startY;
      dev.w = clamp(1, state.grid.cols - dev.x, activeDrag.origW + Math.round(dx / cell));
      dev.h = clamp(1, state.grid.rows - dev.y, activeDrag.origH + Math.round(dy / cell));
      el.style.width = (dev.w * cell) + 'px';
      el.style.height = (dev.h * cell) + 'px';
      el.querySelector('.dev-size').textContent = `${dev.w}×${dev.h} 格`;
    }
  });
  const endDrag = () => { if (activeDrag && activeDrag.id === dev.id) { activeDrag = null; save(); } };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  el.querySelector('.resizer').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    e.target.setPointerCapture(e.pointerId);
    activeDrag = { kind: 'resize', id: dev.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origW: dev.w, origH: dev.h };
  });
}

function bindPlacement(el, pl) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select('placement', pl.id);
    el.setPointerCapture(e.pointerId);
    activeDrag = { kind: 'placement', id: pl.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origX: pl.x, origY: pl.y };
  });
  el.addEventListener('pointermove', (e) => {
    if (!activeDrag || activeDrag.kind !== 'placement' || activeDrag.id !== pl.id) return;
    const fruit = fruitById(pl.fruitId);
    if (!fruit) return;
    const cell = state.grid.cellSize;
    const dx = e.clientX - activeDrag.startX;
    const dy = e.clientY - activeDrag.startY;
    pl.x = clamp(0, state.grid.cols - fruit.w, Math.round((activeDrag.origX * cell + dx) / cell));
    pl.y = clamp(0, state.grid.rows - fruit.h, Math.round((activeDrag.origY * cell + dy) / cell));
    el.style.left = (pl.x * cell) + 'px';
    el.style.top = (pl.y * cell) + 'px';
  });
  const endDrag = () => { if (activeDrag && activeDrag.id === pl.id) { activeDrag = null; save(); } };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
}

/* ---------------- 放置水果 ---------------- */
function cellFromEvent(e) {
  const rect = canvasEl.getBoundingClientRect();
  const cell = state.grid.cellSize;
  return { col: Math.floor((e.clientX - rect.left) / cell), row: Math.floor((e.clientY - rect.top) / cell) };
}

function placeFruit(fruitId, col, row, keepPlacing) {
  const fruit = fruitById(fruitId);
  if (!fruit) { toast('请先添加水果预设'); return; }
  const x = clamp(0, state.grid.cols - fruit.w, col);
  const y = clamp(0, state.grid.rows - fruit.h, row);
  state.placements.push({ id: uid(), fruitId, x, y });
  save();
  render();
  if (!keepPlacing) {
    placingFruitId = null;
    renderFruitList();
  }
  toast(`已放置「${fruit.name}」${keepPlacing ? '（继续放置，按 Esc 退出）' : ''}`);
}

canvasEl.addEventListener('pointerdown', (e) => {
  if (e.target !== canvasEl) return;
  if (placingFruitId) {
    const { col, row } = cellFromEvent(e);
    placeFruit(placingFruitId, col, row, e.shiftKey);
  } else {
    select(null, null);
  }
});
canvasEl.addEventListener('dragover', (e) => e.preventDefault());
canvasEl.addEventListener('drop', (e) => {
  e.preventDefault();
  const fruitId = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('application/x-fruit-id');
  if (!fruitId) return;
  const { col, row } = cellFromEvent(e);
  placeFruit(fruitId, col, row, false);
});

/* ---------------- 侧栏列表 ---------------- */
function renderDeviceList() {
  const ul = $('deviceList');
  ul.innerHTML = '';
  state.devices.forEach((dev) => {
    const li = document.createElement('li');
    let icon = `<span class="swatch" style="background:${esc(dev.color)}"></span>`;
    if (dev.imageId) icon = '<img class="thumb" alt="">';
    li.innerHTML = icon +
      `<span class="name">${esc(dev.name)}</span>` +
      `<span class="size">${dev.type} ${dev.w}×${dev.h}格</span>` +
      '<button class="del" title="删除">✕</button>';
    if (dev.imageId) setImgUrl(li.querySelector('img.thumb'), dev.imageId);
    li.addEventListener('click', (e) => {
      if (e.target.classList.contains('del')) {
        state.devices = state.devices.filter((d) => d.id !== dev.id);
        if (dev.imageId) idbDelete(dev.imageId);
        if (selected && selected.kind === 'device' && selected.id === dev.id) selected = null;
        save(); render();
        return;
      }
      select('device', dev.id);
    });
    ul.appendChild(li);
  });
}

function renderFruitList() {
  const ul = $('fruitList');
  ul.innerHTML = '';
  const cm = state.grid.cellCm;
  state.fruits.forEach((fruit) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.classList.toggle('placing', placingFruitId === fruit.id);
    let icon = `<span class="swatch" style="background:${esc(fruit.color)}"></span>`;
    if (fruit.imageId) icon = '<img class="thumb" alt="">';
    li.innerHTML = icon +
      `<span class="name">${esc(fruit.emoji || '🍏')} ${esc(fruit.name)}</span>` +
      `<span class="size">${fruit.w}×${fruit.h}格${cm ? ` · ${fruit.w * cm}×${fruit.h * cm}cm` : ''}</span>` +
      '<button class="del" title="删除">✕</button>';
    if (fruit.imageId) setImgUrl(li.querySelector('img.thumb'), fruit.imageId);

    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', fruit.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    li.addEventListener('click', (e) => {
      if (e.target.classList.contains('del')) {
        state.fruits = state.fruits.filter((f) => f.id !== fruit.id);
        state.placements = state.placements.filter((p) => p.fruitId !== fruit.id);
        if (fruit.imageId) idbDelete(fruit.imageId);
        if (placingFruitId === fruit.id) placingFruitId = null;
        save(); render();
        return;
      }
      placingFruitId = placingFruitId === fruit.id ? null : fruit.id;
      renderFruitList();
      toast(placingFruitId ? `放置模式：点击画布放置「${fruit.name}」（Shift 连续放，Esc 退出）` : '已退出放置模式');
    });
    ul.appendChild(li);
  });
}

/* ---------------- 图片上传 ---------------- */
function bindImageInput(btnId, inputId, previewId, clearId, onDone) {
  const btn = $(btnId), input = $(inputId), preview = $(previewId), clear = $(clearId);
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('请选择图片文件'); return; }
    try {
      const blob = await compressImage(file);
      const id = uid();
      await idbPut(id, blob);
      const url = URL.createObjectURL(blob);
      imgUrlCache.set(id, url);
      preview.src = url;
      preview.classList.remove('hidden');
      clear.classList.remove('hidden');
      onDone(id);
      toast('图片已就绪，点击「添加」生效');
    } catch (err) {
      toast('图片处理失败，请换一张试试');
    }
  });
  clear.addEventListener('click', () => {
    preview.classList.add('hidden');
    clear.classList.add('hidden');
    onDone(null);
  });
}

bindImageInput('fruitImgBtn', 'fruitImgInput', 'fruitImgPreview', 'fruitImgClear', (id) => { pendingFruitImageId = id; });
bindImageInput('devImgBtn', 'devImgInput', 'devImgPreview', 'devImgClear', (id) => { pendingDevImageId = id; });

/* ---------------- 按实际尺寸换算格数 ---------------- */
$('calcGrid').addEventListener('click', () => {
  const realW = parseFloat($('realW').value);
  const realH = parseFloat($('realH').value);
  const cm = state.grid.cellCm;
  if (!realW || !realH || realW <= 0 || realH <= 0) { toast('请先填写实际宽高（cm）'); return; }
  const w = clamp(1, 30, Math.round(realW / cm));
  const h = clamp(1, 30, Math.round(realH / cm));
  $('fruitW').value = w;
  $('fruitH').value = h;
  toast(`已换算：${realW}×${realH}cm ≈ ${w}×${h} 格（每格${cm}cm）`);
});

/* ---------------- 添加设备 / 水果 ---------------- */
$('addDevice').addEventListener('click', () => {
  const name = $('devName').value.trim() || '设备';
  const w = clamp(1, 30, parseInt($('devW').value, 10) || 4);
  const h = clamp(1, 30, parseInt($('devH').value, 10) || 3);
  const color = $('devColor').value;
  const type = $('devType').value;
  let x = 0, y = 0;
  outer: for (let row = 0; row <= state.grid.rows - h; row++) {
    for (let col = 0; col <= state.grid.cols - w; col++) {
      const overlap = state.devices.some((d) => col < d.x + d.w && col + w > d.x && row < d.y + d.h && row + h > d.y);
      if (!overlap) { x = col; y = row; break outer; }
    }
  }
  state.devices.push({ id: uid(), type, name, x, y, w, h, color, imageId: pendingDevImageId || undefined });
  pendingDevImageId = null;
  $('devImgPreview').classList.add('hidden');
  $('devImgClear').classList.add('hidden');
  save(); render();
  toast(`已添加「${name}」`);
});

$('addFruit').addEventListener('click', () => {
  const name = $('fruitName').value.trim() || '水果';
  const w = clamp(1, 30, parseInt($('fruitW').value, 10) || 1);
  const h = clamp(1, 30, parseInt($('fruitH').value, 10) || 1);
  state.fruits.push({
    id: uid(), name, w, h,
    color: $('fruitColor').value,
    emoji: $('fruitEmoji').value.trim() || '🍏',
    imageId: pendingFruitImageId || undefined,
  });
  pendingFruitImageId = null;
  $('fruitImgPreview').classList.add('hidden');
  $('fruitImgClear').classList.add('hidden');
  save(); render();
  toast(`已添加水果预设「${name}」`);
});

/* ---------------- 网格设置 ---------------- */
function applyGrid() {
  const cols = clamp(2, 60, parseInt($('gridCols').value, 10) || 12);
  const rows = clamp(2, 60, parseInt($('gridRows').value, 10) || 8);
  const cellSize = clamp(20, 80, parseInt($('cellSize').value, 10) || 36);
  const cellCm = clamp(1, 200, parseInt($('cellCm').value, 10) || 10);
  state.grid = { cols, rows, cellSize, cellCm };
  state.devices.forEach((d) => {
    d.x = clamp(0, cols - d.w, d.x);
    d.y = clamp(0, rows - d.h, d.y);
    d.w = clamp(1, cols, d.w);
    d.h = clamp(1, rows, d.h);
  });
  state.placements.forEach((p) => {
    const f = fruitById(p.fruitId);
    if (!f) return;
    p.x = clamp(0, cols - f.w, p.x);
    p.y = clamp(0, rows - f.h, p.y);
  });
  save(); render();
}
['gridCols', 'gridRows', 'cellSize', 'cellCm'].forEach((id) => $(id).addEventListener('change', applyGrid));

$('planName').addEventListener('change', (e) => {
  state.name = e.target.value.trim() || '未命名方案';
  save();
});

/* ---------------- 删除 / 清空 ---------------- */
function deleteSelected() {
  if (!selected) { toast('请先选中要删除的设备或水果块'); return; }
  if (selected.kind === 'device') {
    const dev = state.devices.find((d) => d.id === selected.id);
    if (dev && dev.imageId) idbDelete(dev.imageId);
    state.devices = state.devices.filter((d) => d.id !== selected.id);
  } else {
    state.placements = state.placements.filter((p) => p.id !== selected.id);
  }
  selected = null;
  save(); render();
  toast('已删除');
}
$('deleteSelected').addEventListener('click', deleteSelected);

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag && ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
  if (e.key === 'Escape') {
    placingFruitId = null;
    select(null, null);
    renderFruitList();
    toast('已退出放置模式');
  }
});

$('clearAll').addEventListener('click', () => {
  if (!confirm('确定清空画布？设备和水果预设会保留。')) return;
  state.devices = [];
  state.placements = [];
  selected = null;
  placingFruitId = null;
  save(); render();
  toast('画布已清空');
});

/* ---------------- 保存 / 导入方案（含图片打包） ---------------- */
async function collectImagesDataUrls() {
  const ids = new Set();
  state.devices.forEach((d) => d.imageId && ids.add(d.imageId));
  state.fruits.forEach((f) => f.imageId && ids.add(f.imageId));
  const map = {};
  for (const id of ids) {
    const blob = await idbGet(id);
    if (blob) map[id] = await blobToDataURL(blob);
  }
  return map;
}

$('saveJson').addEventListener('click', async () => {
  toast('正在打包图片…');
  try {
    const images = await collectImagesDataUrls();
    const data = JSON.stringify({ ...state, images }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(state.name || '陈列棚格图').replace(/[\\/:*?"<>|]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('方案已导出（含图片）');
  } catch (err) {
    toast('导出失败');
  }
});

$('loadJsonBtn').addEventListener('click', () => $('loadJson').click());
$('loadJson').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const s = JSON.parse(reader.result);
      if (!s || !s.grid || !Array.isArray(s.devices) || !Array.isArray(s.fruits) || !Array.isArray(s.placements)) {
        throw new Error('bad format');
      }
      const { images, ...rest } = s;
      if (images && typeof images === 'object') {
        toast('正在导入图片…');
        await Promise.all(Object.entries(images).map(async ([id, dataUrl]) => {
          try { await idbPut(id, dataUrlToBlob(dataUrl)); } catch (err) { /* skip */ }
        }));
      }
      state = rest;
      selected = null;
      placingFruitId = null;
      save(); render();
      toast('方案已导入');
    } catch (err) {
      toast('导入失败：文件格式不正确');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ---------------- 导出 PNG ---------------- */
$('exportPng').addEventListener('click', exportPng);

async function exportPng() {
  const { cols, rows, cellSize } = state.grid;
  const scale = 2;
  const w = cols * cellSize, h = rows * cellSize;

  toast('正在生成图片…');
  const ids = new Set();
  state.devices.forEach((d) => d.imageId && ids.add(d.imageId));
  state.fruits.forEach((f) => f.imageId && ids.add(f.imageId));
  const images = new Map();
  for (const id of ids) {
    try {
      const blob = await idbGet(id);
      if (blob) images.set(id, await loadImageFromBlob(blob));
    } catch (err) { /* skip */ }
  }

  const c = document.createElement('canvas');
  c.width = w * scale;
  c.height = h * scale;
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);

  // 背景
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  // 网格线
  ctx.strokeStyle = '#d8dde4';
  ctx.lineWidth = 1;
  for (let i = 0; i <= cols; i++) {
    ctx.beginPath(); ctx.moveTo(i * cellSize + 0.5, 0); ctx.lineTo(i * cellSize + 0.5, h); ctx.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    ctx.beginPath(); ctx.moveTo(0, j * cellSize + 0.5); ctx.lineTo(w, j * cellSize + 0.5); ctx.stroke();
  }

  // 设备
  state.devices.forEach((dev) => {
    const x = dev.x * cellSize, y = dev.y * cellSize, dw = dev.w * cellSize, dh = dev.h * cellSize;
    const img = dev.imageId ? images.get(dev.imageId) : null;
    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 1.5, y + 1.5, dw - 3, dh - 3);
      ctx.clip();
      drawCover(ctx, img, x + 1.5, y + 1.5, dw - 3, dh - 3);
      ctx.restore();
    } else {
      ctx.fillStyle = hexToRgba(dev.color, 0.2);
      ctx.fillRect(x, y, dw, dh);
    }
    ctx.strokeStyle = dev.color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, dw - 3, dh - 3);
    drawTextWithBg(ctx, `${dev.name} · ${dev.w}×${dev.h}格`, x + dw / 2, y + dh / 2, dw - 10, 13, '#111827');
  });

  // 水果块
  state.placements.forEach((pl) => {
    const fruit = fruitById(pl.fruitId);
    if (!fruit) return;
    const x = pl.x * cellSize, y = pl.y * cellSize, fw = fruit.w * cellSize, fh = fruit.h * cellSize;
    const img = fruit.imageId ? images.get(fruit.imageId) : null;
    if (img) {
      ctx.drawImage(img, x + 1, y + 1, fw - 2, fh - 2);
    } else {
      ctx.fillStyle = hexToRgba(fruit.color, 0.35);
      ctx.fillRect(x, y, fw, fh);
      const emojiSize = clamp(12, cellSize * 0.6, Math.min(fw, fh) * 0.55);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${emojiSize}px sans-serif`;
      ctx.fillText(fruit.emoji || '🍏', x + fw / 2, y + fh / 2 - (fh >= cellSize * 1.6 ? 8 : 0));
      if (fw >= cellSize * 1.4 && fh >= cellSize * 1.4) {
        ctx.font = `bold ${clamp(9, 14, cellSize * 0.32)}px sans-serif`;
        ctx.fillStyle = '#111827';
        ctx.fillText(fruit.name, x + fw / 2, y + fh / 2 + emojiSize * 0.6 + 2);
      }
    }
    ctx.strokeStyle = fruit.color;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x + 1, y + 1, fw - 2, fh - 2);
    // 底部标签
    if (fw >= 28 && fh >= 18) {
      const capH = clamp(10, 16, cellSize * 0.38);
      ctx.fillStyle = 'rgba(255,255,255,.82)';
      ctx.fillRect(x + 1, y + fh - capH - 1, fw - 2, capH);
      ctx.fillStyle = '#111827';
      ctx.font = `bold ${clamp(8, 11, cellSize * 0.28)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${fruit.name} ${fruit.w}×${fruit.h}格`, x + fw / 2, y + fh - capH / 2 - 1);
    }
  });

  const a = document.createElement('a');
  a.href = c.toDataURL('image/png');
  a.download = `${(state.name || '陈列棚格图').replace(/[\\/:*?"<>|]/g, '_')}.png`;
  a.click();
  toast('图片已导出');
}

function drawCover(ctx, img, x, y, w, h) {
  const ir = img.width / img.height, r = w / h;
  let sw, sh, sx, sy;
  if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0; }
  else { sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function drawTextWithBg(ctx, text, cx, cy, maxWidth, fontSize, color) {
  ctx.font = `bold ${fontSize}px sans-serif`;
  const w = Math.min(maxWidth, ctx.measureText(text).width + 12);
  const h = fontSize + 8;
  ctx.fillStyle = 'rgba(255,255,255,.78)';
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + 0.5);
}

/* ---------------- Tab 切换 ---------------- */
$('tabDevicesBtn').addEventListener('click', () => {
  $('tabDevicesBtn').classList.add('active');
  $('tabFruitsBtn').classList.remove('active');
  $('panelDevices').classList.remove('hidden');
  $('panelFruits').classList.add('hidden');
});
$('tabFruitsBtn').addEventListener('click', () => {
  $('tabFruitsBtn').classList.add('active');
  $('tabDevicesBtn').classList.remove('active');
  $('panelFruits').classList.remove('hidden');
  $('panelDevices').classList.add('hidden');
});

/* ---------------- 启动 ---------------- */
render();
