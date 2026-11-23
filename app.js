/* 水果柜陈列棚格图工具：以实拍柜子照片为底图，划格子标注水果 */
'use strict';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'fruit-cabinet-planogram-v2';
const DB_NAME = 'fruit-planogram-images';
const STORE = 'images';
const TOP_RATIO = 0.16; // 柜顶平放区占柜子高度的比例

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
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2400);
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
function idbPut(id, blob) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}
function idbGet(id) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const rq = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    rq.onsuccess = () => resolve(rq.result || null);
    rq.onerror = () => reject(rq.error);
  }));
}
function idbDelete(id) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
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

/* 图片压缩：最长边 1600px，白底 JPEG */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const srcUrl = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        c.toBlob((b) => { URL.revokeObjectURL(srcUrl); b ? resolve(b) : reject(new Error('blob')); }, 'image/jpeg', 0.88);
      } catch (e) { URL.revokeObjectURL(srcUrl); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(srcUrl); reject(new Error('load')); };
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
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img load')); };
    img.src = url;
  });
}

/* ---------------- 状态 ---------------- */
function defaultState() {
  return {
    name: '门店A 水果柜',
    photoId: null,
    structure: { bodyLayers: 2, slotsPerLayer: 10, stackCount: 3, topRow: true, topSlots: 10 },
    grid: { left: 4, top: 4, width: 92, height: 92 },
    slots: {},
    fruits: [
      { id: 'f1', name: '苹果', color: '#ef4444', emoji: '🍎' },
      { id: 'f2', name: '橙子', color: '#f97316', emoji: '🍊' },
      { id: 'f3', name: '香蕉', color: '#facc15', emoji: '🍌' },
      { id: 'f4', name: '葡萄', color: '#8b5cf6', emoji: '🍇' },
      { id: 'f5', name: '草莓', color: '#ec4899', emoji: '🍓' },
      { id: 'f6', name: '猕猴桃', color: '#84cc16', emoji: '🥝' },
    ],
  };
}

let state = loadState();
let selectedFruitId = null;
let pendingFruitImageId = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.structure && s.grid && Array.isArray(s.fruits)) return s;
    }
  } catch (e) { /* ignore */ }
  return defaultState();
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}
function fruitById(id) { return state.fruits.find((f) => f.id === id); }

/* 行的划分比例 */
function layoutRows() {
  const st = state.structure;
  const topH = st.topRow ? TOP_RATIO : 0;
  const bodyH = st.topRow ? (1 - TOP_RATIO) / Math.max(1, st.bodyLayers) : 1 / Math.max(1, st.bodyLayers);
  return { topH, bodyH };
}

/* ---------------- DOM 引用 ---------------- */
const photoStage = $('photoStage');
const bgPhoto = $('bgPhoto');
const photoEmpty = $('photoEmpty');
const overlay = $('gridOverlay');
const slotsLayer = $('slotsLayer');
const currentPick = $('currentPick');
const pickLabel = $('pickLabel');

/* ---------------- 照片 ---------------- */
function showPhoto() {
  if (state.photoId) {
    setImgUrl(bgPhoto, state.photoId);
    bgPhoto.classList.remove('hidden');
    photoEmpty.classList.add('hidden');
  } else {
    bgPhoto.classList.add('hidden');
    photoEmpty.classList.remove('hidden');
    overlay.classList.add('hidden');
  }
}

$('photoBtn').addEventListener('click', () => $('photoInput').click());
$('photoInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('请选择图片文件'); return; }
  toast('正在处理照片…');
  try {
    const blob = await compressImage(file);
    const id = uid();
    await idbPut(id, blob);
    state.photoId = id;
    save();
    showPhoto();
    renderGrid();
    toast('照片已就绪，请用网格框对齐柜子');
  } catch (err) { toast('照片处理失败，请换一张'); }
});

/* ---------------- 网格框移动 / 缩放 ---------------- */
function applyGridPos() {
  const g = state.grid;
  overlay.style.left = g.left + '%';
  overlay.style.top = g.top + '%';
  overlay.style.width = g.width + '%';
  overlay.style.height = g.height + '%';
}

function startMove(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const rect = photoStage.getBoundingClientRect();
  const sx = e.clientX, sy = e.clientY;
  const g0 = { ...state.grid };
  const onMove = (ev) => {
    const dx = (ev.clientX - sx) / rect.width * 100;
    const dy = (ev.clientY - sy) / rect.height * 100;
    state.grid = {
      left: clamp(0, 100 - g0.width, g0.left + dx),
      top: clamp(0, 100 - g0.height, g0.top + dy),
      width: g0.width,
      height: g0.height,
    };
    applyGridPos();
  };
  const onUp = () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); save(); };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function startResize(dir, e) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const rect = photoStage.getBoundingClientRect();
  const sx = e.clientX, sy = e.clientY;
  const g0 = { ...state.grid };
  const onMove = (ev) => {
    const dx = (ev.clientX - sx) / rect.width * 100;
    const dy = (ev.clientY - sy) / rect.height * 100;
    const g = { ...g0 };
    if (dir.includes('e')) g.width = clamp(2, 100 - g0.left, g0.width + dx);
    if (dir.includes('s')) g.height = clamp(2, 100 - g0.top, g0.height + dy);
    if (dir.includes('w')) {
      const nl = clamp(0, g0.left + g0.width - 2, g0.left + dx);
      g.width = g0.left + g0.width - nl;
      g.left = nl;
    }
    if (dir.includes('n')) {
      const nt = clamp(0, g0.top + g0.height - 2, g0.top + dy);
      g.height = g0.top + g0.height - nt;
      g.top = nt;
    }
    state.grid = g;
    applyGridPos();
  };
  const onUp = () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); save(); };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

$('gridOverlay').querySelector('.move-bar').addEventListener('pointerdown', startMove);
$('gridOverlay').querySelectorAll('.handle').forEach((h) =>
  h.addEventListener('pointerdown', (e) => startResize(h.dataset.dir, e)));

/* ---------------- 网格渲染 ---------------- */
function renderGrid() {
  slotsLayer.innerHTML = '';
  if (!state.photoId) { overlay.classList.add('hidden'); return; }
  overlay.classList.remove('hidden');
  applyGridPos();

  const st = state.structure;
  const { topH, bodyH } = layoutRows();

  function addRowTag(topPct, hPct, text) {
    const tag = document.createElement('span');
    tag.className = 'row-tag';
    tag.style.top = topPct + '%';
    tag.style.height = hPct + '%';
    tag.textContent = text;
    slotsLayer.appendChild(tag);
  }

  function addSlot(key, leftPct, topPct, wPct, hPct) {
    const el = document.createElement('div');
    el.className = 'slot';
    el.style.left = leftPct + '%';
    el.style.top = topPct + '%';
    el.style.width = wPct + '%';
    el.style.height = hPct + '%';
    el.dataset.key = key;

    const s = state.slots[key];
    if (s && s.fruitId) {
      const f = fruitById(s.fruitId);
      if (f) {
        el.classList.add('filled');
        if (f.imageId) { el.innerHTML = '<img class="s-img" alt="">'; setImgUrl(el.querySelector('.s-img'), f.imageId); }
        const cap = '<span class="s-cap">' +
          (f.imageId ? '' : `<span class="s-emoji">${esc(f.emoji || '🍏')}</span>`) +
          `<span>${esc(f.name)}</span><span class="s-count">×${s.count || 1}</span></span>`;
        el.insertAdjacentHTML('beforeend', cap);
      }
    }
    el.addEventListener('click', () => fillSlot(key));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); clearSlot(key); });
    el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('drop-target'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-target');
      const fruitId = e.dataTransfer.getData('text/plain');
      if (!fruitId) return;
      selectedFruitId = fruitId;
      updatePickLabel();
      renderFruitList();
      renderQuickFruits();
      fillSlot(key, fruitId);
    });
    slotsLayer.appendChild(el);
  }

  if (st.topRow) {
    addRowTag(0, topH, '柜顶');
    const tw = 100 / Math.max(1, st.topSlots);
    for (let s = 0; s < st.topSlots; s++) addSlot(`T${s}`, s * tw, 0, tw, topH);
  }
  for (let l = 0; l < st.bodyLayers; l++) {
    const base = (st.topRow ? TOP_RATIO : 0) + l * bodyH;
    addRowTag(base, bodyH, `第${l + 1}层`);
    const sw = 100 / Math.max(1, st.slotsPerLayer);
    for (let s = 0; s < st.slotsPerLayer; s++) addSlot(`L${l}-S${s}`, s * sw, base, sw, bodyH);
  }
}

function fillSlot(key, fruitId) {
  const fid = fruitId || selectedFruitId;
  if (!fid) { toast('请先到「②水果预设」点选，或直接把水果拖到格子上'); return; }
  if (!fruitById(fid)) { toast('该水果已不存在，请重新添加'); return; }
  const isTop = key.charAt(0) === 'T';
  const count = isTop ? 1 : state.structure.stackCount;
  state.slots[key] = { fruitId: fid, count };
  save();
  renderGrid();
}
function clearSlot(key) {
  delete state.slots[key];
  save();
  renderGrid();
}

/* ---------------- 结构参数同步 ---------------- */
function readStructure() {
  state.structure = {
    bodyLayers: clamp(1, 6, parseInt($('bodyLayers').value, 10) || 2),
    slotsPerLayer: clamp(1, 24, parseInt($('slotsPerLayer').value, 10) || 10),
    stackCount: clamp(1, 6, parseInt($('stackCount').value, 10) || 3),
    topRow: $('topRow').checked,
    topSlots: clamp(1, 24, parseInt($('topSlots').value, 10) || 10),
  };
}
function syncStructureInputs() {
  const st = state.structure;
  $('bodyLayers').value = st.bodyLayers;
  $('slotsPerLayer').value = st.slotsPerLayer;
  $('stackCount').value = st.stackCount;
  $('topRow').checked = st.topRow;
  $('topSlots').value = st.topSlots;
}
['bodyLayers', 'slotsPerLayer', 'stackCount', 'topSlots'].forEach((id) =>
  $(id).addEventListener('change', () => { readStructure(); save(); renderGrid(); }));
$('topRow').addEventListener('change', () => { readStructure(); save(); renderGrid(); });

/* ---------------- 水果预设 ---------------- */
const QUICK_FRUITS = [
  { name: '苹果', emoji: '🍎', color: '#ef4444' },
  { name: '橙子', emoji: '🍊', color: '#f97316' },
  { name: '香蕉', emoji: '🍌', color: '#facc15' },
  { name: '葡萄', emoji: '🍇', color: '#8b5cf6' },
  { name: '草莓', emoji: '🍓', color: '#ec4899' },
  { name: '猕猴桃', emoji: '🥝', color: '#84cc16' },
  { name: '梨', emoji: '🍐', color: '#a3e635' },
  { name: '桃', emoji: '🍑', color: '#fb7185' },
  { name: '火龙果', emoji: '🐉', color: '#f43f5e' },
  { name: '芒果', emoji: '🥭', color: '#fbbf24' },
  { name: '柠檬', emoji: '🍋', color: '#eab308' },
  { name: '圣女果', emoji: '🍅', color: '#dc2626' },
  { name: '西瓜切块', emoji: '🍉', color: '#22c55e' },
  { name: '哈密瓜', emoji: '🍈', color: '#16a34a' },
  { name: '菠萝', emoji: '🍍', color: '#d97706' },
  { name: '牛油果', emoji: '🥑', color: '#65a30d' },
];

function updatePickLabel() {
  const f = fruitById(selectedFruitId);
  if (selectedFruitId && f) {
    currentPick.classList.remove('hidden');
    pickLabel.textContent = `${f.emoji || '🍏'} ${f.name}（点柜子格子填入）`;
  } else {
    currentPick.classList.add('hidden');
    pickLabel.textContent = '';
  }
}
function selectFruit(id) {
  selectedFruitId = id;
  updatePickLabel();
  renderFruitList();
  renderQuickFruits();
  const f = fruitById(id);
  if (f) toast(`已选中「${f.name}」→ 去画布点格子，或按住拖到格子上`);
}
function clearPick() {
  selectedFruitId = null;
  updatePickLabel();
  renderFruitList();
  renderQuickFruits();
}
$('pickClear').addEventListener('click', clearPick);

function renderQuickFruits() {
  const wrap = $('quickFruits');
  wrap.innerHTML = '';
  QUICK_FRUITS.forEach((qf) => {
    const f = state.fruits.find((x) => x.name === qf.name);
    const active = f && f.id === selectedFruitId;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = active ? 'active' : '';
    b.title = '点击选中，或直接拖到柜子格子';
    b.draggable = true;
    b.innerHTML = `<span class="q-emoji">${qf.emoji}</span><span>${esc(qf.name)}</span>`;
    b.addEventListener('click', () => {
      let target = f;
      if (!target) {
        target = { id: uid(), name: qf.name, color: qf.color, emoji: qf.emoji };
        state.fruits.push(target);
        save();
      }
      selectFruit(target.id);
    });
    b.addEventListener('dragstart', (e) => {
      let target = state.fruits.find((x) => x.name === qf.name);
      if (!target) {
        target = { id: uid(), name: qf.name, color: qf.color, emoji: qf.emoji };
        state.fruits.push(target);
        save();
      }
      e.dataTransfer.setData('text/plain', target.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    wrap.appendChild(b);
  });
}

function renderFruitList() {
  const ul = $('fruitList');
  ul.innerHTML = '';
  state.fruits.forEach((fruit) => {
    const li = document.createElement('li');
    li.className = fruit.id === selectedFruitId ? 'active' : '';
    li.draggable = true;
    li.title = '点击选中，或拖到柜子格子';
    let icon = `<span class="swatch" style="background:${esc(fruit.color)}">${esc(fruit.emoji || '🍏')}</span>`;
    if (fruit.imageId) icon = '<img class="thumb" alt="">';
    li.innerHTML = icon +
      `<span class="name">${esc(fruit.name)}</span>` +
      '<button class="del" title="删除">✕</button>';
    if (fruit.imageId) setImgUrl(li.querySelector('img.thumb'), fruit.imageId);
    const del = li.querySelector('.del');
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      state.fruits = state.fruits.filter((x) => x.id !== fruit.id);
      if (fruit.imageId) idbDelete(fruit.imageId);
      if (selectedFruitId === fruit.id) clearPick();
      save(); renderGrid(); renderFruitList();
    });
    li.addEventListener('click', () => selectFruit(fruit.id));
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', fruit.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    ul.appendChild(li);
  });
}

function bindImageInput(btnId, inputId, previewId, clearId, onDone) {
  $(btnId).addEventListener('click', () => $(inputId).click());
  const input = $(inputId), preview = $(previewId), clear = $(clearId);
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
      toast('图片已就绪，点击「添加水果」生效');
    } catch (err) { toast('图片处理失败'); }
  });
  clear.addEventListener('click', () => {
    preview.classList.add('hidden');
    clear.classList.add('hidden');
    onDone(null);
  });
}
bindImageInput('fruitImgBtn', 'fruitImgInput', 'fruitImgPreview', 'fruitImgClear', (id) => { pendingFruitImageId = id; });

$('addFruit').addEventListener('click', () => {
  const name = $('fruitName').value.trim() || '水果';
  state.fruits.push({
    id: uid(), name,
    color: $('fruitColor').value,
    emoji: $('fruitEmoji').value.trim() || '🍏',
    imageId: pendingFruitImageId || undefined,
  });
  pendingFruitImageId = null;
  $('fruitImgPreview').classList.add('hidden');
  $('fruitImgClear').classList.add('hidden');
  save();
  renderFruitList();
  toast(`已添加水果「${name}」`);
});

/* ---------------- 方案名 / 清空 ---------------- */
$('planName').addEventListener('change', (e) => {
  state.name = e.target.value.trim() || '未命名方案';
  save();
});
$('clearSlots').addEventListener('click', () => {
  if (!confirm('确定清空所有格子标注？')) return;
  state.slots = {};
  save();
  renderGrid();
  toast('已清空标注');
});

/* ---------------- 保存 / 导入（含图片打包） ---------------- */
async function collectImagesDataUrls() {
  const ids = new Set();
  if (state.photoId) ids.add(state.photoId);
  state.fruits.forEach((f) => f.imageId && ids.add(f.imageId));
  const map = {};
  for (const id of ids) {
    const blob = await idbGet(id);
    if (blob) map[id] = await blobToDataURL(blob);
  }
  return map;
}

$('saveJson').addEventListener('click', async () => {
  toast('正在打包…');
  try {
    const images = await collectImagesDataUrls();
    const data = JSON.stringify({ ...state, images }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(state.name || '陈列棚格图').replace(/[\\/:*?"<>|]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('方案已导出（含照片与水果图）');
  } catch (err) { toast('导出失败'); }
});

$('loadJsonBtn').addEventListener('click', () => $('loadJson').click());
$('loadJson').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const s = JSON.parse(reader.result);
      if (!s || !s.structure || !s.grid || !Array.isArray(s.fruits)) throw new Error('bad');
      const { images, ...rest } = s;
      if (images && typeof images === 'object') {
        toast('正在导入图片…');
        await Promise.all(Object.entries(images).map(([id, du]) =>
          idbPut(id, dataUrlToBlob(du)).catch(() => {})));
      }
      state = rest;
      selectedFruitId = null;
      pendingFruitImageId = null;
      save();
      syncStructureInputs();
      showPhoto();
      renderGrid();
      renderFruitList();
      renderQuickFruits();
      clearPick();
      toast('方案已导入');
    } catch (err) { toast('导入失败：文件格式不正确'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ---------------- 导出 PNG ---------------- */
$('exportPng').addEventListener('click', exportPng);

async function exportPng() {
  if (!state.photoId) { toast('请先上传柜子照片'); return; }
  toast('正在生成图片…');
  try {
    const blob = await idbGet(state.photoId);
    const img = await loadImageFromBlob(blob);
    const W = img.naturalWidth, H = img.naturalHeight;

    // 预载水果图片
    const fImages = new Map();
    const ids = new Set(state.fruits.map((f) => f.imageId).filter(Boolean));
    for (const id of ids) {
      const b = await idbGet(id);
      if (b) fImages.set(id, await loadImageFromBlob(b));
    }

    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const st = state.structure, g = state.grid;
    const gx = W * g.left / 100, gy = H * g.top / 100;
    const gw = W * g.width / 100, gh = H * g.height / 100;
    const { topH, bodyH } = layoutRows();
    const topHpx = st.topRow ? gh * topH : 0;
    const bodyHpx = gh * bodyH;

    function drawSlotText(cx, cy, slotWpx, slotHpx, f, count) {
      const fontSize = Math.max(11, Math.min(slotWpx, slotHpx) * 0.22);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const emojiSize = Math.max(14, Math.min(slotWpx, slotHpx) * 0.4);
      if (!f.imageId) {
        ctx.font = `${emojiSize}px sans-serif`;
        ctx.fillText(f.emoji || '🍏', cx, cy - fontSize * 0.4);
      }
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      const label = `${f.name}×${count}`;
      ctx.strokeText(label, cx, cy + emojiSize * 0.5 + 4);
      ctx.fillText(label, cx, cy + emojiSize * 0.5 + 4);
    }

    const drawSlotsData = () => {
      // 顶部
      if (st.topRow && topHpx > 0) {
        const tw = gw / Math.max(1, st.topSlots);
        for (let s = 0; s < st.topSlots; s++) {
          const x = gx + s * tw, y = gy;
          const data = state.slots[`T${s}`];
          const f = data && data.fruitId ? fruitById(data.fruitId) : null;
          if (f) {
            const fi = f.imageId ? fImages.get(f.imageId) : null;
            if (fi) ctx.drawImage(fi, x, y, tw, topHpx);
            else { ctx.fillStyle = hexToRgba(f.color, 0.35); ctx.fillRect(x, y, tw, topHpx); }
            ctx.strokeStyle = f.color; ctx.lineWidth = Math.max(2, W * 0.002);
            ctx.strokeRect(x, y, tw, topHpx);
            drawSlotText(x + tw / 2, y + topHpx / 2, tw, topHpx, f, 1);
          } else {
            ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, tw - 1, topHpx - 1);
          }
        }
      }
      // 主体
      const sw = gw / Math.max(1, st.slotsPerLayer);
      for (let l = 0; l < st.bodyLayers; l++) {
        const y = gy + topHpx + l * bodyHpx;
        for (let s = 0; s < st.slotsPerLayer; s++) {
          const x = gx + s * sw;
          const data = state.slots[`L${l}-S${s}`];
          const f = data && data.fruitId ? fruitById(data.fruitId) : null;
          if (f) {
            const fi = f.imageId ? fImages.get(f.imageId) : null;
            if (fi) ctx.drawImage(fi, x, y, sw, bodyHpx);
            else { ctx.fillStyle = hexToRgba(f.color, 0.35); ctx.fillRect(x, y, sw, bodyHpx); }
            ctx.strokeStyle = f.color; ctx.lineWidth = Math.max(2, W * 0.002);
            ctx.strokeRect(x, y, sw, bodyHpx);
            drawSlotText(x + sw / 2, y + bodyHpx / 2, sw, bodyHpx, f, data.count || 1);
          } else {
            ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, sw - 1, bodyHpx - 1);
          }
        }
      }
    };
    drawSlotsData();

    // 外框（柜子范围）
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = Math.max(3, W * 0.004);
    ctx.strokeRect(gx, gy, gw, gh);

    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `${(state.name || '陈列棚格图').replace(/[\\/:*?"<>|]/g, '_')}.png`;
    a.click();
    toast('图片已导出');
  } catch (err) {
    toast('导出失败');
  }
}

/* ---------------- Tab 切换 ---------------- */
$('tabCabBtn').addEventListener('click', () => {
  $('tabCabBtn').classList.add('active');
  $('tabFruitsBtn').classList.remove('active');
  $('panelCab').classList.remove('hidden');
  $('panelFruits').classList.add('hidden');
});
$('tabFruitsBtn').addEventListener('click', () => {
  $('tabFruitsBtn').classList.add('active');
  $('tabCabBtn').classList.remove('active');
  $('panelFruits').classList.remove('hidden');
  $('panelCab').classList.add('hidden');
});

/* ---------------- 启动 ---------------- */
$('planName').value = state.name;
syncStructureInputs();
showPhoto();
renderGrid();
renderFruitList();
renderQuickFruits();