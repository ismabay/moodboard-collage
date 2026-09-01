// ---------- state ----------
const state = {
  images: [],           // {id, fileURL, w, h, folders}
  cols: 4,
  rows: 3,
  ratio: '3:4',
  layout: 'grid',
  gutter: 6,
  bg: '#ffffff',
  fmt: 'jpg',
  randomTilt: false,
  fitMode: 'cover',
  arrangeMode: 'free',
  freeLocked: false,
  gridCellSize: 220,
  selectedUids: new Set(),
  lastScaleVal: 100,
  canvasItems: [],       // {id, x, y, w, h, rot, z, fileURL, natW, natH}
  zCounter: 1,
  pageW: 1600,
  pageH: 1200,
  currentBoardId: null,
  currentBoardName: '',
  sourceFolderId: null,
  penMode: false,
  penTool: 'line',
  lastLine: { strokeWidth: 3, color: '#1a1a1a', dashed: false, arrow: false, arrowStart: false },
  recentLineColors: [],
  undoStack: []
};

const BOARDS_INDEX_KEY = 'mbc_boards_index';
const BOARD_KEY_PREFIX = 'mbc_board_';
const COVER_MAX_W = 480;
// Only one floating toolbar (text or line) is ever meant to be open at a
// time; tracking the current outside-click handler here means a new
// toolbar always replaces the previous listener instead of stacking one on
// top of another — a leaked stale listener was closing the active toolbar
// on unrelated clicks.
let activeOutsideClickHandler = null;
function registerOutsideClickHandler(handler) {
  if (activeOutsideClickHandler) {
    document.removeEventListener('mousedown', activeOutsideClickHandler);
  }
  activeOutsideClickHandler = handler;
  setTimeout(() => {
    if (activeOutsideClickHandler === handler) {
      document.addEventListener('mousedown', handler);
    }
  }, 0);
}

const RATIOS = { '1:1': 1, '3:4': 4 / 3, '4:3': 3 / 4, '2:3': 3 / 2, 'free': null };

// ---------- init ----------
eagle.onPluginCreate(async () => {
  renderThumbs();
  setupGridPicker();
  setupToggleGroup('ratio-group', 'ratio');
  setupToggleGroup('layout-group', 'layout');
  setupToggleGroup('fmt-group', 'fmt');
  setupToggleGroup('fit-group', 'fitMode');
  document.querySelectorAll('#layout-group .opt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('grid-square-row').classList.toggle('hidden', state.layout !== 'grid');
    });
  });
  setupBgSwatches();
  document.getElementById('gutter-input').addEventListener('input', (e) => {
    state.gutter = parseInt(e.target.value, 10);
    document.getElementById('gutter-out').textContent = state.gutter + 'px';
  });
  document.getElementById('cols-input').addEventListener('change', (e) => {
    state.cols = Math.max(1, parseInt(e.target.value, 10) || 1);
    syncGridPickerFromInputs();
  });
  document.getElementById('rows-input').addEventListener('change', (e) => {
    state.rows = Math.max(1, parseInt(e.target.value, 10) || 1);
    syncGridPickerFromInputs();
  });
  document.getElementById('rotate-toggle').addEventListener('change', (e) => {
    state.randomTilt = e.target.checked;
  });
  document.getElementById('continue-btn').addEventListener('click', goToCanvas);
  document.getElementById('back-btn').addEventListener('click', goToSetup);
  document.getElementById('boards-btn').addEventListener('click', exitToBoards);
  document.getElementById('undo-btn').addEventListener('click', undo);

  const arrangeBtns = document.querySelectorAll('#arrange-group .opt-btn');
  arrangeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const newMode = btn.dataset.arrange;
      if (newMode === state.arrangeMode) return;
      cancelZigzag();
      syncPositionsFromDOM(); // capture whatever is on screen right now

      arrangeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (newMode === 'grid' || newMode === 'flow') {
        state.penMode = false;
        document.getElementById('pen-btn').classList.remove('active');
        document.getElementById('stage').classList.remove('pen-mode');
        // Reading order carries over: top-to-bottom, left-to-right.
        const rowTolerance = 40;
        state.canvasItems.sort((a, b) => {
          if (Math.abs(a.y - b.y) > rowTolerance) return a.y - b.y;
          return a.x - b.x;
        });
        state.selectedUids.clear();
        if (state.arrangeMode === 'free') {
          // Coming from Free: base the cell/column size on whatever size the
          // images were already shown at, so switching doesn't suddenly
          // shrink or enlarge everything.
          const sizes = state.canvasItems.map(it => (newMode === 'grid' ? Math.min(it.w, it.h) : it.w));
          const avg = sizes.reduce((a, b) => a + b, 0) / (sizes.length || 1);
          state.gridCellSize = Math.max(60, avg || 220);
          state.lastScaleVal = 100;
          document.getElementById('global-scale-input').value = 100;
          document.getElementById('global-scale-out').textContent = '100%';
        }
      }
      state.arrangeMode = newMode;
      document.getElementById('lock-toggle-row').classList.toggle('hidden', newMode !== 'free');
      document.getElementById('scale-whole-row').classList.toggle('hidden', newMode !== 'free');
      updateArrangeHint();
      renderStage();
    });
  });

  document.getElementById('lock-toggle').addEventListener('change', (e) => {
    syncPositionsFromDOM();
    state.freeLocked = e.target.checked;
    state.selectedUids.clear();
    updateArrangeHint();
    renderStage();
  });

  document.getElementById('export-btn').addEventListener('click', exportCollage);
  document.getElementById('add-images-btn').addEventListener('click', openImagePicker);
  document.getElementById('add-text-btn').addEventListener('click', addTextBox);
  document.getElementById('pen-btn').addEventListener('click', () => {
    cancelZigzag();
    state.penMode = !state.penMode;
    document.getElementById('pen-btn').classList.toggle('active', state.penMode);
    document.getElementById('stage').classList.toggle('pen-mode', state.penMode);
    if (state.penMode && (state.arrangeMode !== 'free' || state.freeLocked)) {
      syncPositionsFromDOM();
      state.arrangeMode = 'free';
      state.freeLocked = false;
      document.getElementById('lock-toggle').checked = false;
      document.querySelectorAll('#arrange-group .opt-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('#arrange-group [data-arrange="free"]').classList.add('active');
      document.getElementById('lock-toggle-row').classList.remove('hidden');
      document.getElementById('scale-whole-row').classList.remove('hidden');
      updateArrangeHint();
    }
    if (state.penMode) showPenDefaultsToolbar();
    else hideItemToolbar();
    renderStage();
  });
  document.getElementById('picker-cancel-btn').addEventListener('click', () => {
    document.getElementById('picker-modal').classList.add('hidden');
  });
  document.addEventListener('keydown', (e) => {
    if (document.getElementById('canvas-view').classList.contains('hidden')) return;

    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      // Let native text-editing undo work while actively typing in a text
      // card; only step back the board when nothing is being edited.
      if (document.activeElement && document.activeElement.isContentEditable) return;
      e.preventDefault();
      undo();
      return;
    }

    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (state.arrangeMode !== 'free' || state.freeLocked) return;
    if (state.selectedUids.size === 0) return;
    e.preventDefault();
    state.canvasItems = state.canvasItems.filter(it => !state.selectedUids.has(it.uid));
    state.selectedUids.clear();
    renderStage();
    recordChange();
  });

  document.addEventListener('paste', async (e) => {
    if (document.getElementById('canvas-view').classList.contains('hidden')) return;
    if (!e.clipboardData) return;
    const imageItems = Array.from(e.clipboardData.items).filter(it => it.type && it.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    for (const clipItem of imageItems) {
      const file = clipItem.getAsFile();
      if (!file) continue;
      try {
        const dataUrl = await fileToDataURL(file);
        const dims = await getImageDimensions(dataUrl);
        const fakeId = 'pasted-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        addItemsToCanvas([{
          id: fakeId, fileURL: dataUrl, thumbnailURL: dataUrl,
          width: dims.w, height: dims.h, folders: null
        }]);
      } catch (err) {
        console.error(err);
      }
    }
  });

  let scaleAnchor = null;
  const scaleInput = document.getElementById('global-scale-input');
  scaleInput.addEventListener('pointerdown', () => {
    if (state.arrangeMode !== 'free' || !document.getElementById('scale-whole-toggle').checked) { scaleAnchor = null; return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    state.canvasItems.forEach(it => {
      minX = Math.min(minX, it.x); minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x + it.w); maxY = Math.max(maxY, it.y + it.h);
    });
    scaleAnchor = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  });
  scaleInput.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    document.getElementById('global-scale-out').textContent = val + '%';

    if (state.arrangeMode === 'grid' || state.arrangeMode === 'flow') {
      // Grid/Flow: the slider is the shared cell/column size — the layout's
      // own reflow does the rest (grow past what fits and it spills over,
      // shrink and later images pull back to fill the gap).
      state.gridCellSize = 220 * (val / 100);
      state.lastScaleVal = val;
      renderStage();
      return;
    }

    // Free: scales each image's own w/h by the same ratio, keeping each
    // image's own proportions. Nothing else moves unless "scale whole
    // composition" is checked.
    const ratio = val / state.lastScaleVal;
    const wholeMode = document.getElementById('scale-whole-toggle').checked && scaleAnchor;
    state.canvasItems.forEach(it => {
      it.w *= ratio; it.h *= ratio;
      if (wholeMode) {
        it.x = scaleAnchor.x + (it.x - scaleAnchor.x) * ratio;
        it.y = scaleAnchor.y + (it.y - scaleAnchor.y) * ratio;
      }
    });
    state.lastScaleVal = val;
    if (!wholeMode) {
      const maxBottom = Math.max(...state.canvasItems.map(it => it.y + it.h), 0);
      state.pageH = maxBottom + state.gutter;
    }
    renderStage();
  });

  document.getElementById('name-modal-cancel').addEventListener('click', () => {
    document.getElementById('name-modal').classList.add('hidden');
  });
  document.getElementById('name-modal-confirm').addEventListener('click', confirmNameModal);
  document.getElementById('name-modal-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmNameModal();
  });

  document.getElementById('delete-modal-cancel').addEventListener('click', closeDeleteModal);
  document.getElementById('delete-modal-confirm').addEventListener('click', () => {
    if (deleteModalTargetId) deleteBoard(deleteModalTargetId);
    closeDeleteModal();
  });
  document.getElementById('delete-modal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDeleteModal();
  });

  document.addEventListener('pointerup', recordChange);

  const stageEl = document.getElementById('stage');
  stageEl.addEventListener('dragover', (e) => { e.preventDefault(); });
  stageEl.addEventListener('drop', onStageDrop);

  renderBoardsView();
});

function updateArrangeHint() {
  const hint = document.getElementById('arrange-hint');
  if (state.arrangeMode === 'grid') {
    hint.textContent = 'Drag to swap, Size slider resizes cells';
  } else if (state.arrangeMode === 'flow') {
    hint.textContent = 'Drag to swap, Size slider resizes columns';
  } else if (state.freeLocked) {
    hint.textContent = 'Drag to swap, resize pushes neighbors';
  } else {
    hint.textContent = 'Drag freely, resize from corner';
  }
}

// ---------- boards list & persistence ----------
function loadBoardsIndex() {
  try {
    return JSON.parse(localStorage.getItem(BOARDS_INDEX_KEY) || '[]');
  } catch (e) {
    return [];
  }
}
function saveBoardsIndex(list) {
  localStorage.setItem(BOARDS_INDEX_KEY, JSON.stringify(list));
}

function renderBoardsView() {
  document.getElementById('canvas-view').classList.add('hidden');
  document.getElementById('setup-view').classList.add('hidden');
  document.getElementById('boards-view').classList.remove('hidden');

  const grid = document.getElementById('boards-grid');
  grid.innerHTML = '';
  const boards = loadBoardsIndex().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const newCard = document.createElement('div');
  newCard.className = 'board-card new-board-card';
  newCard.innerHTML = '<div class="plus-icon">+</div><div>New board</div>';
  newCard.addEventListener('click', openNewBoardModal);
  grid.appendChild(newCard);

  boards.forEach(b => {
    const card = document.createElement('div');
    card.className = 'board-card';

    const cover = document.createElement('div');
    cover.className = 'board-card-cover';
    if (b.cover) {
      const img = document.createElement('img');
      img.src = b.cover;
      cover.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'placeholder';
      ph.textContent = 'No preview yet';
      cover.appendChild(ph);
    }
    card.appendChild(cover);

    const meta = document.createElement('div');
    meta.className = 'board-card-meta';
    const nameWrap = document.createElement('div');
    const nameEl = document.createElement('div');
    nameEl.className = 'board-card-name';
    nameEl.textContent = b.name || 'Untitled';
    const dateEl = document.createElement('div');
    dateEl.className = 'board-card-date';
    dateEl.textContent = b.updatedAt ? new Date(b.updatedAt).toLocaleDateString() : '';
    nameWrap.appendChild(nameEl); nameWrap.appendChild(dateEl);

    const actions = document.createElement('div');
    actions.className = 'board-card-actions';
    const renameBtn = document.createElement('button');
    renameBtn.textContent = '✎'; renameBtn.title = 'Rename';
    renameBtn.addEventListener('click', (e) => { e.stopPropagation(); openRenameModal(b.id, b.name); });
    const delBtn = document.createElement('button');
    delBtn.textContent = '✕'; delBtn.title = 'Delete';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeleteModal(b.id, b.name);
    });
    actions.appendChild(renameBtn); actions.appendChild(delBtn);

    meta.appendChild(nameWrap); meta.appendChild(actions);
    card.appendChild(meta);

    card.addEventListener('click', () => openExistingBoard(b.id));
    grid.appendChild(card);
  });
}

let nameModalMode = 'create';
let nameModalTargetId = null;

function openNewBoardModal() {
  nameModalMode = 'create';
  document.getElementById('name-modal-title').textContent = 'New board';
  document.getElementById('name-modal-confirm').textContent = 'Create';
  document.getElementById('name-modal-input').value = '';
  document.getElementById('name-modal').classList.remove('hidden');
  document.getElementById('name-modal-input').focus();
}
function openRenameModal(id, currentName) {
  nameModalMode = 'rename';
  nameModalTargetId = id;
  document.getElementById('name-modal-title').textContent = 'Rename board';
  document.getElementById('name-modal-confirm').textContent = 'Save';
  document.getElementById('name-modal-input').value = currentName || '';
  document.getElementById('name-modal').classList.remove('hidden');
  document.getElementById('name-modal-input').focus();
}
function confirmNameModal() {
  const name = document.getElementById('name-modal-input').value.trim() || 'Untitled';
  document.getElementById('name-modal').classList.add('hidden');
  if (nameModalMode === 'create') {
    startNewBoardFlow(name);
  } else {
    const boards = loadBoardsIndex();
    const b = boards.find(x => x.id === nameModalTargetId);
    if (b) { b.name = name; saveBoardsIndex(boards); }
    renderBoardsView();
  }
}

async function startNewBoardFlow(name) {
  state.currentBoardId = 'board_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  state.currentBoardName = name;
  document.getElementById('back-btn').style.display = '';
  await loadImages();
  renderThumbs();
  document.getElementById('boards-view').classList.add('hidden');
  document.getElementById('setup-view').classList.remove('hidden');
}

function openExistingBoard(id) {
  const raw = localStorage.getItem(BOARD_KEY_PREFIX + id);
  if (!raw) return;
  let data;
  try { data = JSON.parse(raw); } catch (e) { return; }

  state.currentBoardId = id;
  state.currentBoardName = data.name || 'Untitled';
  state.canvasItems = data.canvasItems || [];
  state.bg = data.bg || '#ffffff';
  state.gutter = typeof data.gutter === 'number' ? data.gutter : 6;
  state.fmt = data.fmt || 'jpg';
  state.pageW = data.pageW || 1600;
  state.pageH = data.pageH || 1200;
  state.arrangeMode = data.arrangeMode || 'free';
  state.gridCellSize = data.gridCellSize || 220;
  state.zCounter = data.zCounter || 1;
  state.sourceFolderId = data.sourceFolderId || null;
  state.freeLocked = false;
  state.selectedUids.clear();
  state.lastScaleVal = 100;

  document.getElementById('back-btn').style.display = 'none';
  document.getElementById('global-scale-input').value = 100;
  document.getElementById('global-scale-out').textContent = '100%';
  document.querySelectorAll('#arrange-group .opt-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector('#arrange-group [data-arrange="' + state.arrangeMode + '"]');
  if (activeBtn) activeBtn.classList.add('active');
  document.getElementById('lock-toggle').checked = false;
  document.getElementById('lock-toggle-row').classList.toggle('hidden', state.arrangeMode !== 'free');
  document.getElementById('scale-whole-row').classList.toggle('hidden', state.arrangeMode !== 'free');
  updateArrangeHint();

  document.getElementById('boards-view').classList.add('hidden');
  document.getElementById('canvas-view').classList.remove('hidden');
  delete document.getElementById('stage-wrap').dataset.centered;
  state.undoStack = [];
  renderStage();
  pushUndo();
}

async function exitToBoards() {
  await saveCurrentBoardState(true);
  renderBoardsView();
}

// Autosave: any pointerup while working in the canvas (end of a drag, resize,
// swap, marquee, draw, etc.) schedules a save a short moment later, so an
// accidental close never loses more than a fraction of a second of work.
// Debounced so a burst of quick interactions only writes once.
let autoSaveTimer = null;
function scheduleAutoSave() {
  if (!state.currentBoardId) return;
  if (document.getElementById('canvas-view').classList.contains('hidden')) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => { saveCurrentBoardState(false); }, 600);
}

// Undo: keeps up to 20 snapshots of the board (positions, sizes, styles,
// arrange mode, background — everything that visibly changes). Every
// completed action pushes one, so a move, resize, delete, style change, or
// even switching Free/Grid/Flow can all be stepped back.
const UNDO_LIMIT = 20;
function captureSnapshot() {
  return JSON.stringify({
    canvasItems: state.canvasItems, arrangeMode: state.arrangeMode, gridCellSize: state.gridCellSize,
    bg: state.bg, gutter: state.gutter, pageW: state.pageW, pageH: state.pageH, fmt: state.fmt
  });
}
function pushUndo() {
  if (!state.currentBoardId) return;
  if (document.getElementById('canvas-view').classList.contains('hidden')) return;
  const snap = captureSnapshot();
  if (state.undoStack.length && state.undoStack[state.undoStack.length - 1] === snap) return;
  state.undoStack.push(snap);
  if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
}
function recordChange() {
  pushUndo();
  scheduleAutoSave();
}
function undo() {
  if (state.undoStack.length < 2) return; // nothing before the current state
  state.undoStack.pop(); // discard current state
  const data = JSON.parse(state.undoStack[state.undoStack.length - 1]);
  state.canvasItems = data.canvasItems;
  state.arrangeMode = data.arrangeMode;
  state.gridCellSize = data.gridCellSize;
  state.bg = data.bg;
  state.gutter = data.gutter;
  state.pageW = data.pageW;
  state.pageH = data.pageH;
  state.fmt = data.fmt;
  state.selectedUids.clear();
  hideItemToolbar();
  document.querySelectorAll('#arrange-group .opt-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector('#arrange-group [data-arrange="' + state.arrangeMode + '"]');
  if (activeBtn) activeBtn.classList.add('active');
  document.getElementById('lock-toggle-row').classList.toggle('hidden', state.arrangeMode !== 'free');
  document.getElementById('scale-whole-row').classList.toggle('hidden', state.arrangeMode !== 'free');
  updateArrangeHint();
  renderStage();
  scheduleAutoSave();
}

async function saveCurrentBoardState(withCover) {
  if (!state.currentBoardId) return;
  syncPositionsFromDOM();

  const data = {
    name: state.currentBoardName,
    canvasItems: state.canvasItems,
    bg: state.bg, gutter: state.gutter, fmt: state.fmt,
    pageW: state.pageW, pageH: state.pageH,
    arrangeMode: state.arrangeMode, gridCellSize: state.gridCellSize,
    zCounter: state.zCounter, sourceFolderId: state.sourceFolderId
  };
  try {
    localStorage.setItem(BOARD_KEY_PREFIX + state.currentBoardId, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save board', e);
  }

  const boards = loadBoardsIndex();
  let entry = boards.find(b => b.id === state.currentBoardId);
  if (!entry) {
    entry = { id: state.currentBoardId };
    boards.push(entry);
  }
  entry.name = state.currentBoardName;
  entry.updatedAt = Date.now();
  // The cover thumbnail redraws every image, so skip it for the frequent
  // autosave and only regenerate it when actually leaving to the Boards
  // list — the saved item data (positions, lines, text) is what matters for
  // not losing work, and that's written every time regardless.
  if (withCover) {
    entry.cover = await generateCoverThumbnail();
  }
  saveBoardsIndex(boards);
}

function deleteBoard(id) {
  const boards = loadBoardsIndex().filter(b => b.id !== id);
  saveBoardsIndex(boards);
  localStorage.removeItem(BOARD_KEY_PREFIX + id);
  renderBoardsView();
}

let deleteModalTargetId = null;
function openDeleteModal(id, name) {
  deleteModalTargetId = id;
  document.getElementById('delete-modal-text').textContent =
    'Permanently delete "' + (name || 'Untitled') + '"? This removes all images, text, drawings, layout, and settings saved in this board. This action cannot be undone.';
  document.getElementById('delete-modal').classList.remove('hidden');
  // Focus lands on Cancel, not the destructive action, so an accidental
  // Enter press doesn't delete anything.
  document.getElementById('delete-modal-cancel').focus();
}
function closeDeleteModal() {
  deleteModalTargetId = null;
  document.getElementById('delete-modal').classList.add('hidden');
}

async function generateCoverThumbnail() {
  try {
    const scale = Math.min(1, COVER_MAX_W / state.pageW);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(state.pageW * scale));
    canvas.height = Math.max(1, Math.round(state.pageH * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = state.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const sorted = [...state.canvasItems].sort((a, b) => a.z - b.z);
    for (const item of sorted) {
      const x = item.x * scale, y = item.y * scale, w = item.w * scale, h = item.h * scale;
      if (item.type === 'text') {
        drawTextItem(ctx, item, x, y, w, h, scale);
        continue;
      }
      if (item.type === 'line') {
        drawLineItem(ctx, item, x, y, w, h, scale);
        continue;
      }
      if (item.type === 'freehand') {
        drawFreehandItem(ctx, item, x, y, w, h, scale);
        continue;
      }
      try {
        const bmp = await loadImageWithFallback(item.fileURL, item.thumbURL);
        ctx.save();
        ctx.beginPath();
        ctx.translate(x + w / 2, y + h / 2);
        ctx.rotate(item.rot * Math.PI / 180);
        ctx.rect(-w / 2, -h / 2, w, h);
        ctx.clip();
        const srcRatio = bmp.width / bmp.height, dstRatio = w / h;
        let sx, sy, sw, sh;
        if (srcRatio > dstRatio) { sh = bmp.height; sw = sh * dstRatio; sx = (bmp.width - sw) / 2; sy = 0; }
        else { sw = bmp.width; sh = sw / dstRatio; sx = 0; sy = (bmp.height - sh) / 2; }
        ctx.drawImage(bmp, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
        ctx.restore();
        if (item.borderStyle && item.borderStyle !== 'none') {
          ctx.save();
          ctx.translate(x + w / 2, y + h / 2);
          ctx.rotate(item.rot * Math.PI / 180);
          drawItemBorder(ctx, item, w, h, scale);
          ctx.restore();
        }
      } catch (e) { /* skip broken image in thumbnail */ }
    }
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch (e) {
    console.error('cover thumbnail failed', e);
    return null;
  }
}

async function loadImages() {
  let items = await eagle.item.getSelected();
  let folderId = null;
  if (!items || items.length === 0) {
    const folders = await eagle.folder.getSelected();
    if (folders && folders.length > 0) {
      folderId = folders[0].id;
      items = await eagle.item.get({ folders: [folderId] });
    }
  } else {
    folderId = (items[0].folders && items[0].folders[0]) || null;
  }
  items = items || [];

  // PSD, vector (ai/eps), and some other formats may not have a ready thumbnail
  // even though Eagle's own UI renders a live preview for them. Force-generate
  // the thumbnail so our plain <img> tags have something raster to display.
  await Promise.all(items.map(async (it) => {
    if (it.noThumbnail || !it.thumbnailURL) {
      try { await it.refreshThumbnail(); } catch (e) { /* best effort */ }
    }
  }));

  state.images = items.map(it => ({
    id: it.id, fileURL: it.fileURL, thumbURL: it.thumbnailURL || it.fileURL,
    w: it.width, h: it.height, folders: it.folders
  }));
  state.sourceFolderId = folderId;
  document.getElementById('image-count').textContent = state.images.length + ' images loaded';
}

// Opens an in-plugin picker: thumbnails of everything in the source folder
// that isn't already on the canvas. Click to toggle a pick, then confirm.
const PICKER_PAGE_SIZE = 60;

async function openImagePicker() {
  const modal = document.getElementById('picker-modal');
  const addBtn = document.getElementById('picker-add-btn');
  const searchInput = document.getElementById('picker-search');
  const loadMoreBtn = document.getElementById('picker-load-more-btn');
  modal.classList.remove('hidden');
  searchInput.value = '';

  const picked = new Map();   // id -> eagle item, kept across searches/pages
  let matches = [];           // full filtered result set for the current query
  let shownCount = 0;

  const updateAddBtn = () => {
    addBtn.textContent = 'Add selected (' + picked.size + ')';
    addBtn.disabled = picked.size === 0;
  };
  updateAddBtn();

  let lastDiagnostic = 'No matches.';
  const renderPage = (reset) => {
    const grid = document.getElementById('picker-grid');
    if (reset) { grid.innerHTML = ''; shownCount = 0; }
    const next = matches.slice(shownCount, shownCount + PICKER_PAGE_SIZE);
    next.forEach(it => grid.appendChild(buildPickerCell(it, picked, updateAddBtn)));
    shownCount += next.length;
    document.getElementById('picker-load-more-row').classList.toggle('hidden', shownCount >= matches.length);
    if (matches.length === 0) {
      grid.innerHTML = '<p class="muted">' + lastDiagnostic + '</p>';
    }
  };

  const runQuery = async (query) => {
    const grid = document.getElementById('picker-grid');
    grid.innerHTML = '<p class="muted">Loading…</p>';
    const result = await fetchPickerMatches(query.trim());
    matches = result.matches;
    lastDiagnostic = result.diagnostic;
    await Promise.all(matches.slice(0, PICKER_PAGE_SIZE).map(async (it) => {
      if (it.noThumbnail || !it.thumbnailURL) {
        try { await it.refreshThumbnail(); } catch (e) { /* best effort */ }
      }
    }));
    renderPage(true);
  };

  let debounceTimer = null;
  searchInput.oninput = (e) => {
    clearTimeout(debounceTimer);
    const query = e.target.value;
    debounceTimer = setTimeout(() => runQuery(query), 250);
  };
  loadMoreBtn.onclick = async () => {
    const next = matches.slice(shownCount, shownCount + PICKER_PAGE_SIZE);
    await Promise.all(next.map(async (it) => {
      if (it.noThumbnail || !it.thumbnailURL) {
        try { await it.refreshThumbnail(); } catch (e) { /* best effort */ }
      }
    }));
    renderPage(false);
  };
  addBtn.onclick = () => {
    addItemsToCanvas(Array.from(picked.values()));
    modal.classList.add('hidden');
  };

  await runQuery('');
}

// Fetches candidates from Eagle, then only keeps ones that genuinely match
// the query by name, tags, or notes — Eagle's own keyword search can be
// broader than that, which felt like it was "matching everything". Returns
// a diagnostic string too, so a genuinely empty result can say why.
async function fetchPickerMatches(query) {
  let items = [];
  let diagnostic = 'No matches.';
  try {
    if (query) {
      items = await eagle.item.get({ keywords: [query] });
    } else if (state.sourceFolderId) {
      items = await eagle.item.get({ folders: [state.sourceFolderId] });
    } else {
      items = await eagle.item.getSelected();
    }
  } catch (err) {
    console.error(err);
    diagnostic = 'Error reading from Eagle: ' + (err && err.message ? err.message : err);
  }
  items = items || [];

  const existingIds = new Set(state.canvasItems.map(it => it.id));
  let result = items.filter(it => !existingIds.has(it.id));

  if (query) {
    const q = query.toLowerCase();
    result = result.filter(it =>
      (it.name && it.name.toLowerCase().includes(q)) ||
      (it.annotation && it.annotation.toLowerCase().includes(q)) ||
      (Array.isArray(it.tags) && it.tags.some(t => t.toLowerCase().includes(q)))
    );
  }
  return { matches: result, diagnostic };
}

function buildPickerCell(it, picked, updateAddBtn) {
  const cell = document.createElement('div');
  cell.className = 'picker-cell' + (picked.has(it.id) ? ' picked' : '');
  const img = document.createElement('img');
  img.src = it.thumbnailURL || it.fileURL;
  img.draggable = false;
  img.onerror = () => { img.src = it.fileURL; };
  cell.appendChild(img);
  const check = document.createElement('div');
  check.className = 'picker-check';
  cell.appendChild(check);
  cell.addEventListener('click', () => {
    if (picked.has(it.id)) { picked.delete(it.id); cell.classList.remove('picked'); }
    else { picked.set(it.id, it); cell.classList.add('picked'); }
    updateAddBtn();
  });
  return cell;
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getImageDimensions(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = reject;
    img.src = src;
  });
}

// ---------- text boxes ----------
const TEXT_FONTS = {
  sans: '-apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif'
};

function addTextBox() {
  const cascade = state.canvasItems.length * 18;
  state.canvasItems.push({
    type: 'text',
    uid: 'ci-text-' + Date.now(),
    text: 'Text',
    fontFamily: 'sans',
    bold: false,
    fontSize: 32,
    align: 'left',
    color: '#1a1a1a',
    x: 40 + (cascade % 300), y: 40 + (cascade % 300),
    w: 320, h: 120,
    natW: 320, natH: 120,
    rot: 0,
    fitMode: 'cover',
    z: ++state.zCounter
  });
  if (state.arrangeMode !== 'free') {
    state.arrangeMode = 'free';
    document.querySelectorAll('#arrange-group .opt-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('#arrange-group [data-arrange="free"]').classList.add('active');
    document.getElementById('lock-toggle-row').classList.remove('hidden');
    document.getElementById('scale-whole-row').classList.remove('hidden');
    updateArrangeHint();
  }
  renderStage();
  recordChange();
}

// Fills a cell element with either an image or an editable text block. Used
// by every layout mode (Free/Grid/Flow) so a text card behaves exactly like
// an image card for dragging, swapping, and resizing purposes.
function buildCellContent(el, item) {
  if (item.type === 'text') {
    el.classList.add('is-text');
    el.style.fontFamily = TEXT_FONTS[item.fontFamily] || TEXT_FONTS.sans;
    el.style.fontSize = item.fontSize + 'px';
    el.style.fontWeight = item.bold ? '700' : '400';
    el.style.textAlign = item.align || 'left';
    el.style.color = item.color || '#1a1a1a';
    if (item.html) el.innerHTML = item.html;
    else el.textContent = item.text;
    applyItemStyle(el, item);

    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (el.isContentEditable) return; // already editing — let native double-click word-select happen
      el.contentEditable = 'true';
      el.focus();
      document.execCommand('selectAll', false, null);
      showTextToolbar(item, el);
    });
    el.addEventListener('blur', () => {
      item.text = el.textContent;
      item.html = el.innerHTML;
      recordChange();
    });
    el.addEventListener('keydown', (e) => { e.stopPropagation(); }); // don't trigger Delete-key canvas shortcut while typing
  } else if (item.type === 'line') {
    el.classList.add('is-line');
    renderLineSVG(el, item);
  } else if (item.type === 'freehand') {
    el.classList.add('is-line');
    renderFreehandSVG(el, item);
  } else {
    const img = document.createElement('img');
    img.src = item.thumbURL;
    img.draggable = false;
    img.onerror = () => {
      if (img.src !== item.fileURL) { img.src = item.fileURL; }
      else { el.style.background = 'var(--bg-elevated)'; }
    };
    el.appendChild(img);
    applyItemStyle(el, item);
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Lines and freehand drawings always render above every image and text
// card, no matter what order things were clicked in — they're annotations
// meant to sit on top of the board, not compete for stacking order.
const LINE_Z_TIER = 1000000;
function zIndexFor(item) {
  return (item.type === 'line' || item.type === 'freehand') ? item.z + LINE_Z_TIER : item.z;
}

function lineEndpoints(item) {
  return item.flipY
    ? { p1: { x: 0, y: item.h }, p2: { x: item.w, y: 0 } }
    : { p1: { x: 0, y: 0 }, p2: { x: item.w, y: item.h } };
}

const ARROW_LEN_MULT = 7;

const LINE_COLOR_PRESETS = ['#1a1a1a', '#e0473e', '#378add', '#e8b23d', '#3aa15b'];

// Shared color control set for every line-type tool (pen defaults, and a
// drawn line/freehand/zigzag's own toolbar): 5 quick preset swatches, a
// custom color wheel, and small "recently used" droplets that fill in as
// custom colors get picked. `setColor` is called with the new color;
// `redraw` (optional) repaints whatever needs to reflect it live.
function buildLineColorControls(setColor, redraw) {
  const els = [];
  LINE_COLOR_PRESETS.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'color-swatch-btn';
    btn.style.background = c;
    btn.title = c;
    btn.onmousedown = (e) => { e.preventDefault(); setColor(c); if (redraw) redraw(); };
    els.push(btn);
  });

  const customWrap = document.createElement('span');
  customWrap.className = 'color-swatch-btn custom-color-label';
  customWrap.title = 'Custom color';
  customWrap.style.cursor = 'pointer';
  customWrap.style.display = 'inline-block';
  const customInput = document.createElement('input');
  customInput.type = 'color';
  customInput.value = state.lastLine.color;
  customWrap.appendChild(customInput);
  customInput.addEventListener('mousedown', (e) => e.stopPropagation());
  customInput.addEventListener('input', () => {
    setColor(customInput.value);
    if (redraw) redraw();
  });
  customInput.addEventListener('change', () => rememberLineColor(customInput.value));
  els.push(customWrap);

  state.recentLineColors.forEach(c => {
    const drop = document.createElement('button');
    drop.className = 'color-swatch-btn color-droplet';
    drop.style.background = c;
    drop.title = c;
    drop.onmousedown = (e) => { e.preventDefault(); setColor(c); if (redraw) redraw(); };
    els.push(drop);
  });

  return els;
}

function rememberLineColor(c) {
  state.recentLineColors = [c, ...state.recentLineColors.filter(x => x !== c)].slice(0, 5);
}

function arrowHeadPoints(fromX, fromY, toX, toY, strokeWidth) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const len = strokeWidth * ARROW_LEN_MULT, wid = strokeWidth * 5;
  const backX = toX - len * Math.cos(angle), backY = toY - len * Math.sin(angle);
  const perp = angle + Math.PI / 2;
  return {
    tip: { x: toX, y: toY },
    b1: { x: backX + (wid / 2) * Math.cos(perp), y: backY + (wid / 2) * Math.sin(perp) },
    b2: { x: backX - (wid / 2) * Math.cos(perp), y: backY - (wid / 2) * Math.sin(perp) }
  };
}

// Shortens a stroke so its rounded end sits back inside the wide base of the
// arrowhead instead of poking out past the sharp tip.
function pullBackForArrow(from, to, strokeWidth) {
  const dist = strokeWidth * ARROW_LEN_MULT;
  const totalLen = Math.hypot(to.x - from.x, to.y - from.y);
  if (totalLen <= dist) return { x: from.x, y: from.y };
  const t = dist / totalLen;
  return { x: to.x - (to.x - from.x) * t, y: to.y - (to.y - from.y) * t };
}

function renderLineSVG(el, item) {
  el.style.pointerEvents = 'none'; // only the stroke itself (below) is clickable, not the whole box
  let svg = el.querySelector('svg');
  if (!svg) {
    svg = document.createElementNS(SVG_NS, 'svg');
    svg.style.cssText = 'width:100%;height:100%;overflow:visible;display:block;';
    el.appendChild(svg);
  } else {
    svg.innerHTML = ''; // clear only the SVG's own content — never touch el's other children (the resize handles)
  }
  svg.setAttribute('viewBox', '0 0 ' + Math.max(1, item.w) + ' ' + Math.max(1, item.h));
  svg.setAttribute('preserveAspectRatio', 'none');

  const { p1, p2 } = lineEndpoints(item);

  // Invisible, slightly wider stroke purely for click/drag hit-testing — a
  // click anywhere in the box's empty corners passes through to whatever
  // is underneath; only near the line itself grabs it.
  const hitLine = document.createElementNS(SVG_NS, 'line');
  hitLine.setAttribute('x1', p1.x); hitLine.setAttribute('y1', p1.y);
  hitLine.setAttribute('x2', p2.x); hitLine.setAttribute('y2', p2.y);
  hitLine.setAttribute('stroke', 'rgba(0,0,0,0.01)');
  hitLine.setAttribute('stroke-width', item.strokeWidth + 14);
  hitLine.setAttribute('stroke-linecap', 'round');
  hitLine.style.pointerEvents = 'stroke';
  svg.appendChild(hitLine);

  const lineEl = document.createElementNS(SVG_NS, 'line');
  const visP1 = item.arrowStart ? pullBackForArrow(p2, p1, item.strokeWidth) : p1;
  const visP2 = item.arrow ? pullBackForArrow(p1, p2, item.strokeWidth) : p2;
  lineEl.setAttribute('x1', visP1.x); lineEl.setAttribute('y1', visP1.y);
  lineEl.setAttribute('x2', visP2.x); lineEl.setAttribute('y2', visP2.y);
  lineEl.setAttribute('stroke', item.color);
  lineEl.setAttribute('stroke-width', item.strokeWidth);
  lineEl.setAttribute('stroke-linecap', 'round');
  if (item.dashed) lineEl.setAttribute('stroke-dasharray', (item.strokeWidth * 2.6) + ',' + (item.strokeWidth * 2.2));
  lineEl.style.pointerEvents = 'none';
  svg.appendChild(lineEl);

  const addArrow = (from, to) => {
    const a = arrowHeadPoints(from.x, from.y, to.x, to.y, item.strokeWidth);
    const tri = document.createElementNS(SVG_NS, 'polygon');
    tri.setAttribute('points', a.tip.x + ',' + a.tip.y + ' ' + a.b1.x + ',' + a.b1.y + ' ' + a.b2.x + ',' + a.b2.y);
    tri.setAttribute('fill', item.color);
    tri.style.pointerEvents = 'fill';
    svg.appendChild(tri);
  };
  if (item.arrow) addArrow(p1, p2);
  if (item.arrowStart) addArrow(p2, p1);
}

function freehandActualPt(item, p) {
  return { x: p.x * item.w, y: p.y * item.h };
}

// Builds an SVG path that gently rounds each interior corner (cuts a small
// piece off each vertex and bridges it with a curve) instead of a sharp
// angle — subtle on an already-smooth freehand stroke, but takes the edge
// off a zigzag's sharp points.
function roundedPathD(pts, radius) {
  if (pts.length < 3) return 'M ' + pts.map(p => p.x + ',' + p.y).join(' L ');
  let d = 'M ' + pts[0].x + ',' + pts[0].y;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1], cur = pts[i], next = pts[i + 1];
    const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const d2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    if (d1 < 0.01 || d2 < 0.01) { d += ' L ' + cur.x + ',' + cur.y; continue; }
    const r = Math.min(radius, d1 / 2, d2 / 2);
    const a = { x: cur.x + (prev.x - cur.x) / d1 * r, y: cur.y + (prev.y - cur.y) / d1 * r };
    const b = { x: cur.x + (next.x - cur.x) / d2 * r, y: cur.y + (next.y - cur.y) / d2 * r };
    d += ' L ' + a.x + ',' + a.y + ' Q ' + cur.x + ',' + cur.y + ' ' + b.x + ',' + b.y;
  }
  d += ' L ' + pts[pts.length - 1].x + ',' + pts[pts.length - 1].y;
  return d;
}

function freehandPathD(item, forVisibleStroke) {
  const pts = item.points.map(p => freehandActualPt(item, p));
  if (forVisibleStroke && pts.length >= 2) {
    if (item.arrow) pts[pts.length - 1] = pullBackForArrow(pts[pts.length - 2], pts[pts.length - 1], item.strokeWidth);
    if (item.arrowStart) pts[0] = pullBackForArrow(pts[1], pts[0], item.strokeWidth);
  }
  const radius = Math.max(8, item.strokeWidth * 2.5);
  return roundedPathD(pts, radius);
}

function renderFreehandSVG(el, item) {
  el.style.pointerEvents = 'none';
  let svg = el.querySelector('svg');
  if (!svg) {
    svg = document.createElementNS(SVG_NS, 'svg');
    svg.style.cssText = 'width:100%;height:100%;overflow:visible;display:block;';
    el.appendChild(svg);
  } else {
    svg.innerHTML = '';
  }
  svg.setAttribute('viewBox', '0 0 ' + Math.max(1, item.w) + ' ' + Math.max(1, item.h));
  svg.setAttribute('preserveAspectRatio', 'none');

  const hitPath = document.createElementNS(SVG_NS, 'path');
  hitPath.setAttribute('d', freehandPathD(item, false));
  hitPath.setAttribute('fill', 'none');
  hitPath.setAttribute('stroke', 'rgba(0,0,0,0.01)');
  hitPath.setAttribute('stroke-width', item.strokeWidth + 14);
  hitPath.setAttribute('stroke-linecap', 'round');
  hitPath.setAttribute('stroke-linejoin', 'round');
  hitPath.style.pointerEvents = 'stroke';
  svg.appendChild(hitPath);

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', freehandPathD(item, true));
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', item.color);
  path.setAttribute('stroke-width', item.strokeWidth);
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  if (item.dashed) path.setAttribute('stroke-dasharray', (item.strokeWidth * 2.6) + ',' + (item.strokeWidth * 2.2));
  path.style.pointerEvents = 'none';
  svg.appendChild(path);

  const addFreehandArrow = (fromPt, toPt) => {
    const a = arrowHeadPoints(fromPt.x, fromPt.y, toPt.x, toPt.y, item.strokeWidth);
    const tri = document.createElementNS(SVG_NS, 'polygon');
    tri.setAttribute('points', a.tip.x + ',' + a.tip.y + ' ' + a.b1.x + ',' + a.b1.y + ' ' + a.b2.x + ',' + a.b2.y);
    tri.setAttribute('fill', item.color);
    tri.style.pointerEvents = 'fill';
    svg.appendChild(tri);
  };
  if (item.arrow && item.points.length >= 2) {
    addFreehandArrow(freehandActualPt(item, item.points[item.points.length - 2]), freehandActualPt(item, item.points[item.points.length - 1]));
  }
  if (item.arrowStart && item.points.length >= 2) {
    addFreehandArrow(freehandActualPt(item, item.points[1]), freehandActualPt(item, item.points[0]));
  }
}

function showTextToolbar(item, el) {
  const bar = document.getElementById('item-toolbar-bar');
  bar.innerHTML = '';
  bar.classList.remove('hidden');

  const sansBtn = document.createElement('button');
  sansBtn.textContent = 'Sans';
  sansBtn.className = item.fontFamily === 'sans' ? 'active' : '';
  const serifBtn = document.createElement('button');
  serifBtn.textContent = 'Serif';
  serifBtn.className = item.fontFamily === 'serif' ? 'active' : '';
  const boldBtn = document.createElement('button');
  boldBtn.textContent = 'B';
  boldBtn.className = 'bold-btn';
  boldBtn.title = 'Bold selected text';

  const sizeMinusBtn = document.createElement('button');
  sizeMinusBtn.textContent = '−'; sizeMinusBtn.title = 'Smaller (selected text, or default)';
  const sizeLabel = document.createElement('span');
  sizeLabel.style.cssText = 'font-size:12px;color:var(--text-secondary);min-width:24px;text-align:center;';
  sizeLabel.textContent = Math.round(item.fontSize);
  const sizePlusBtn = document.createElement('button');
  sizePlusBtn.textContent = '+'; sizePlusBtn.title = 'Bigger (selected text, or default)';

  const alignLeftBtn = document.createElement('button');
  alignLeftBtn.textContent = '⇤';
  alignLeftBtn.title = 'Align left';
  alignLeftBtn.className = item.align === 'left' ? 'active' : '';
  const alignCenterBtn = document.createElement('button');
  alignCenterBtn.textContent = '↔';
  alignCenterBtn.title = 'Align center';
  alignCenterBtn.className = item.align === 'center' ? 'active' : '';
  const alignRightBtn = document.createElement('button');
  alignRightBtn.textContent = '⇥';
  alignRightBtn.title = 'Align right';
  alignRightBtn.className = item.align === 'right' ? 'active' : '';

  const colorCustomWrap = document.createElement('span');
  colorCustomWrap.className = 'color-swatch-btn custom-color-label';
  colorCustomWrap.title = 'Text color (selected text, or type-ahead)';
  colorCustomWrap.style.cursor = 'pointer';
  colorCustomWrap.style.display = 'inline-block';
  const colorCustomInput = document.createElement('input');
  colorCustomInput.type = 'color';
  colorCustomInput.value = '#3378dd';
  colorCustomWrap.appendChild(colorCustomInput);

  const setFont = (f) => {
    item.fontFamily = f;
    el.style.fontFamily = TEXT_FONTS[f];
    sansBtn.classList.toggle('active', f === 'sans');
    serifBtn.classList.toggle('active', f === 'serif');
  };
  sansBtn.onmousedown = (e) => { e.preventDefault(); setFont('sans'); };
  serifBtn.onmousedown = (e) => { e.preventDefault(); setFont('serif'); };
  boldBtn.onmousedown = (e) => {
    e.preventDefault();
    const sel = window.getSelection();
    const hasSelection = sel && sel.rangeCount > 0 && !sel.isCollapsed && el.contains(sel.anchorNode) && el.isContentEditable;
    if (hasSelection) {
      document.execCommand('bold');
      boldBtn.classList.toggle('active', document.queryCommandState('bold'));
    } else {
      item.bold = !item.bold;
      el.style.fontWeight = item.bold ? '700' : '400';
      boldBtn.classList.toggle('active', item.bold);
    }
  };

  // Applies to just the current text selection when there is one (same
  // execCommand trick used for bold/color); otherwise sets the box's
  // default size for whatever gets typed next.
  let sizeDisplay = item.fontSize;
  const applyFontSize = (px) => {
    const sel = window.getSelection();
    const hasSelection = sel && sel.rangeCount > 0 && !sel.isCollapsed && el.contains(sel.anchorNode);
    if (hasSelection && el.isContentEditable) {
      document.execCommand('fontSize', false, '7');
      el.querySelectorAll('font[size="7"]').forEach(f => {
        const span = document.createElement('span');
        span.style.fontSize = px + 'px';
        while (f.firstChild) span.appendChild(f.firstChild);
        f.parentNode.replaceChild(span, f);
      });
    } else {
      item.fontSize = px;
      el.style.fontSize = px + 'px';
    }
  };
  sizeMinusBtn.onmousedown = (e) => {
    e.preventDefault();
    sizeDisplay = Math.max(6, sizeDisplay - 2);
    sizeLabel.textContent = Math.round(sizeDisplay);
    applyFontSize(sizeDisplay);
  };
  sizePlusBtn.onmousedown = (e) => {
    e.preventDefault();
    sizeDisplay = Math.min(200, sizeDisplay + 2);
    sizeLabel.textContent = Math.round(sizeDisplay);
    applyFontSize(sizeDisplay);
  };

  const setAlign = (a) => {
    item.align = a;
    el.style.textAlign = a;
    alignLeftBtn.classList.toggle('active', a === 'left');
    alignCenterBtn.classList.toggle('active', a === 'center');
    alignRightBtn.classList.toggle('active', a === 'right');
  };
  alignLeftBtn.onmousedown = (e) => { e.preventDefault(); setAlign('left'); };
  alignCenterBtn.onmousedown = (e) => { e.preventDefault(); setAlign('center'); };
  alignRightBtn.onmousedown = (e) => { e.preventDefault(); setAlign('right'); };

  // Color applies to whatever text is currently selected (or to text typed
  // next, if nothing is selected) — not the whole box, unless nothing is
  // being edited, in which case it sets the box's own default color.
  const applyColor = (c) => {
    const sel = window.getSelection();
    const hasSelection = sel && sel.rangeCount > 0 && !sel.isCollapsed && el.contains(sel.anchorNode) && el.isContentEditable;
    if (hasSelection) document.execCommand('foreColor', false, c);
    else { item.color = c; el.style.color = c; }
  };
  colorCustomInput.addEventListener('mousedown', (e) => e.stopPropagation());
  colorCustomInput.addEventListener('input', () => applyColor(colorCustomInput.value));

  const sep1 = document.createElement('div'); sep1.className = 'item-toolbar-sep';
  const sep2 = document.createElement('div'); sep2.className = 'item-toolbar-sep';

  const { solidBtn, dashedBtn, widthMinusBtn, widthLabel, widthPlusBtn, borderColorCustomWrap, borderColorCustomInput }
    = buildBorderControls(item, () => { applyItemStyle(el, item); });

  const bgNoneBtn = document.createElement('button');
  bgNoneBtn.textContent = 'None'; bgNoneBtn.title = 'No background';
  bgNoneBtn.className = !item.bgColor ? 'active' : '';
  const bgCustomWrap = document.createElement('span');
  bgCustomWrap.className = 'color-swatch-btn custom-color-label';
  bgCustomWrap.title = 'Background color';
  bgCustomWrap.style.cursor = 'pointer';
  bgCustomWrap.style.display = 'inline-block';
  const bgCustomInput = document.createElement('input');
  bgCustomInput.type = 'color';
  bgCustomInput.value = '#f4e9c8';
  bgCustomWrap.appendChild(bgCustomInput);
  const setBg = (c) => { item.bgColor = c; applyItemStyle(el, item); bgNoneBtn.classList.toggle('active', !c); };
  bgNoneBtn.onmousedown = (e) => { e.preventDefault(); setBg(null); };
  bgCustomInput.addEventListener('mousedown', (e) => e.stopPropagation());
  bgCustomInput.addEventListener('input', () => setBg(bgCustomInput.value));

  const delBtn = document.createElement('button');
  delBtn.textContent = '✕';
  delBtn.title = 'Delete text box';
  delBtn.onmousedown = (e) => {
    e.preventDefault();
    state.canvasItems = state.canvasItems.filter(i => i.uid !== item.uid);
    hideTextToolbar();
    renderStage();
    recordChange();
  };

  [sansBtn, serifBtn, boldBtn, sizeMinusBtn, sizeLabel, sizePlusBtn, alignLeftBtn, alignCenterBtn, alignRightBtn,
    colorCustomWrap, sep1,
    solidBtn, dashedBtn, widthMinusBtn, widthLabel, widthPlusBtn, borderColorCustomWrap, sep2,
    bgNoneBtn, bgCustomWrap, delBtn]
    .forEach(el2 => bar.appendChild(el2));

  // Any click outside the box or the toolbar itself ends the editing
  // session — clicking a toolbar control (like the size field) must NOT
  // close it.
  setTimeout(() => {
    document.addEventListener('selectionchange', onSelectionChange);
  }, 0);
  registerOutsideClickHandler(onOutsideClick);
  function onSelectionChange() {
    if (!el.isContentEditable) return;
    boldBtn.classList.toggle('active', document.queryCommandState('bold'));
  }
  function onOutsideClick(e) {
    if (bar.contains(e.target) || el.contains(e.target)) return;
    document.removeEventListener('mousedown', onOutsideClick);
    document.removeEventListener('selectionchange', onSelectionChange);
    if (activeOutsideClickHandler === onOutsideClick) activeOutsideClickHandler = null;
    el.contentEditable = 'false';
    item.text = el.textContent;
    item.html = el.innerHTML;
    hideTextToolbar();
    recordChange();
  }
}

// Shared border style (none/solid/dashed) + border color controls, used by
// text boxes and images alike.
function buildBorderControls(item, onChange) {
  const solidBtn = document.createElement('button');
  solidBtn.textContent = '―'; solidBtn.title = 'Solid border (click again to remove)';
  solidBtn.className = item.borderStyle === 'solid' ? 'active' : '';
  const dashedBtn = document.createElement('button');
  dashedBtn.textContent = '┄'; dashedBtn.title = 'Dashed border (click again to remove)';
  dashedBtn.className = item.borderStyle === 'dashed' ? 'active' : '';

  const widthMinusBtn = document.createElement('button');
  widthMinusBtn.textContent = '−'; widthMinusBtn.title = 'Thinner border';
  const widthLabel = document.createElement('span');
  widthLabel.style.cssText = 'font-size:12px;color:var(--text-secondary);min-width:18px;text-align:center;';
  widthLabel.textContent = item.borderWidth || 2;
  const widthPlusBtn = document.createElement('button');
  widthPlusBtn.textContent = '+'; widthPlusBtn.title = 'Thicker border';

  const borderColorCustomWrap = document.createElement('span');
  borderColorCustomWrap.className = 'color-swatch-btn custom-color-label';
  borderColorCustomWrap.title = 'Border color';
  borderColorCustomWrap.style.cursor = 'pointer';
  borderColorCustomWrap.style.display = 'inline-block';
  const borderColorCustomInput = document.createElement('input');
  borderColorCustomInput.type = 'color';
  borderColorCustomInput.value = item.borderColor || '#1a1a1a';
  borderColorCustomWrap.appendChild(borderColorCustomInput);

  const setStyle = (s) => {
    item.borderStyle = s;
    if (s !== 'none' && !item.borderColor) item.borderColor = '#1a1a1a';
    if (s !== 'none' && !item.borderWidth) item.borderWidth = 2;
    solidBtn.classList.toggle('active', s === 'solid');
    dashedBtn.classList.toggle('active', s === 'dashed');
    onChange();
  };
  solidBtn.onmousedown = (e) => { e.preventDefault(); setStyle(item.borderStyle === 'solid' ? 'none' : 'solid'); };
  dashedBtn.onmousedown = (e) => { e.preventDefault(); setStyle(item.borderStyle === 'dashed' ? 'none' : 'dashed'); };
  widthMinusBtn.onmousedown = (e) => {
    e.preventDefault();
    item.borderWidth = Math.max(1, (item.borderWidth || 2) - 1);
    widthLabel.textContent = item.borderWidth;
    onChange();
  };
  widthPlusBtn.onmousedown = (e) => {
    e.preventDefault();
    item.borderWidth = Math.min(30, (item.borderWidth || 2) + 1);
    widthLabel.textContent = item.borderWidth;
    onChange();
  };
  const setColor = (c) => { item.borderColor = c; onChange(); };
  borderColorCustomInput.addEventListener('mousedown', (e) => e.stopPropagation());
  borderColorCustomInput.addEventListener('input', () => setColor(borderColorCustomInput.value));

  return {
    solidBtn, dashedBtn, widthMinusBtn, widthLabel, widthPlusBtn,
    borderColorCustomWrap, borderColorCustomInput
  };
}

// Applies an item's border/background styling directly to its rendered
// element (used for both text boxes and images).
function applyItemStyle(el, item) {
  if (item.borderStyle && item.borderStyle !== 'none') {
    el.style.border = (item.borderWidth || 2) + 'px ' + (item.borderStyle === 'dashed' ? 'dashed ' : 'solid ') + (item.borderColor || '#1a1a1a');
  } else {
    el.style.border = 'none';
  }
  if (item.type === 'text') {
    el.style.background = item.bgColor || 'transparent';
  }
}

function hideTextToolbar() {
  hideItemToolbar();
}

// ---------- drag & drop onto the canvas ----------
// External files (Finder, browser) always work via the standard HTML5 File
// API. Dragging straight from Eagle's own library grid isn't a documented
// API — Eagle only exposes eagle.drag for dragging *out* of a plugin — but
// if Eagle's internal drag happens to use native OS drag-and-drop under the
// hood, the same drop handler picks it up for free. Untested on Eagle's
// side; falls back to doing nothing if no usable file data is present.
async function onStageDrop(e) {
  e.preventDefault();
  if (state.arrangeMode !== 'free') return;

  const stage = document.getElementById('stage');
  const stageBox = stage.getBoundingClientRect();
  const scale = stageBox.width / state.pageW;
  const dropX = (e.clientX - stageBox.left) / scale;
  const dropY = (e.clientY - stageBox.top) / scale;

  const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter(f => f.type.startsWith('image/'));
  if (files.length === 0) return; // nothing usable (e.g. an internal Eagle drag with no file data)

  const dropped = [];
  for (const file of files) {
    try {
      const dataUrl = await fileToDataURL(file);
      const dims = await getImageDimensions(dataUrl);
      dropped.push({
        id: 'dropped-' + Date.now() + '-' + Math.random().toString(36).slice(2),
        fileURL: dataUrl, thumbnailURL: dataUrl, width: dims.w, height: dims.h
      });
    } catch (err) { console.error(err); }
  }
  if (dropped.length) placeDroppedImages(dropped, dropX, dropY);
}

// Arranges a batch of dropped images into a compact block that's 3 rows
// tall, growing sideways as needed — instead of just cascading diagonally.
function placeDroppedImages(items, dropX, dropY) {
  const ROWS = 3;
  const gap = 14;
  const baseSize = state.canvasItems.length
    ? state.canvasItems.reduce((s, it) => s + Math.min(it.w, it.h), 0) / state.canvasItems.length
    : 200;

  items.forEach((it, i) => {
    const row = i % ROWS;
    const col = Math.floor(i / ROWS);
    const w = it.width, h = it.height;
    state.canvasItems.push({
      uid: 'ci-drop-' + Date.now() + '-' + i,
      id: it.id, fileURL: it.fileURL, thumbURL: it.thumbnailURL || it.fileURL,
      natW: w, natH: h,
      x: dropX + col * (baseSize + gap),
      y: dropY + row * (baseSize + gap),
      w: baseSize, h: baseSize * (h / w),
      colSpan: 1, rowSpan: 1, rot: 0, fitMode: 'cover',
      z: ++state.zCounter
    });
  });
  renderStage();
  recordChange();
}

function addItemsToCanvas(items) {
  if (!items.length) return;
  const baseSize = state.canvasItems.length
    ? state.canvasItems.reduce((s, it) => s + Math.min(it.w, it.h), 0) / state.canvasItems.length
    : 220;

  items.forEach((it, i) => {
    const w = it.width, h = it.height;
    const cascade = (state.canvasItems.length + i) * 18;
    state.canvasItems.push({
      uid: 'ci-add-' + Date.now() + '-' + i,
      id: it.id, fileURL: it.fileURL, thumbURL: it.thumbnailURL || it.fileURL,
      natW: w, natH: h,
      x: 20 + (cascade % 400), y: 20 + (cascade % 400),
      w: baseSize, h: baseSize * (h / w),
      colSpan: 1, rowSpan: 1, rot: 0, fitMode: 'cover',
      z: ++state.zCounter
    });
  });
  renderStage();
  recordChange();
}

function renderThumbs() {
  const strip = document.getElementById('thumb-strip');
  strip.innerHTML = '';
  state.images.forEach(img => {
    const el = document.createElement('img');
    el.src = img.thumbURL;
    el.onerror = () => {
      if (el.src !== img.fileURL) { el.src = img.fileURL; }
      else { el.style.background = 'var(--bg-elevated)'; el.style.opacity = '0.4'; }
    };
    strip.appendChild(el);
  });
}

// ---------- setup panel widgets ----------
function setupGridPicker() {
  const picker = document.getElementById('grid-picker');
  const label = document.getElementById('grid-label');
  const maxR = 8, maxC = 8;
  const cells = [];
  for (let r = 0; r < maxR; r++) {
    for (let c = 0; c < maxC; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = r; cell.dataset.c = c;
      cell.addEventListener('mouseenter', () => paint(r, c));
      cell.addEventListener('click', () => {
        state.rows = r + 1; state.cols = c + 1;
        document.getElementById('rows-input').value = state.rows;
        document.getElementById('cols-input').value = state.cols;
        label.textContent = state.rows + ' × ' + state.cols;
      });
      picker.appendChild(cell);
      cells.push(cell);
    }
  }
  function paint(r, c) {
    cells.forEach(cell => {
      const cr = +cell.dataset.r, cc = +cell.dataset.c;
      cell.classList.toggle('active', cr <= r && cc <= c);
    });
    label.textContent = (r + 1) + ' × ' + (c + 1);
  }
  picker.addEventListener('mouseleave', () => paint(state.rows - 1, state.cols - 1));
  paint(state.rows - 1, state.cols - 1);
}
function syncGridPickerFromInputs() {
  document.getElementById('grid-label').textContent = state.rows + ' × ' + state.cols;
}

function setupToggleGroup(groupId, stateKey) {
  const group = document.getElementById(groupId);
  const btns = group.querySelectorAll('.opt-btn');
  const customRow = document.getElementById('custom-ratio-inputs');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state[stateKey] = btn.dataset.ratio || btn.dataset.layout || btn.dataset.fmt || btn.dataset.fit;
      if (customRow) customRow.classList.toggle('hidden', state.ratio !== 'custom');
    });
  });
  if (btns.length) btns[0].click();
}

function getRatioFactor() {
  if (state.ratio === 'custom') {
    const w = parseFloat(document.getElementById('ratio-w-input').value) || 1;
    const h = parseFloat(document.getElementById('ratio-h-input').value) || 1;
    return h / w;
  }
  return RATIOS[state.ratio] || 1;
}

function setupBgSwatches() {
  const swatches = document.querySelectorAll('#bg-group .color-swatch');
  const customWrap = document.getElementById('custom-bg-wrap');
  swatches.forEach(sw => {
    sw.addEventListener('click', () => {
      swatches.forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      state.bg = sw.dataset.bg || sw.value;
    });
  });
  const custom = document.getElementById('custom-bg');
  custom.addEventListener('input', () => {
    swatches.forEach(s => s.classList.remove('selected'));
    customWrap.classList.add('selected');
    state.bg = custom.value;
  });
  if (swatches.length) swatches[0].click();
}

// ---------- layout algorithms ----------
// all algorithms return array of {x,y,w,h} in pageW x pageH virtual units, same order as state.images

function computeGrid() {
  const g = state.gutter;
  const n = state.images.length || 1;
  let cols, rows, cellSize, offsetX = 0, offsetY = 0;

  if (state.ratio === 'free') {
    // Free mode: manual column count, page grows downward to fit all rows.
    cols = state.cols;
    rows = Math.ceil(n / cols) || 1;
    cellSize = (state.pageW - g * (cols + 1)) / cols;
    state.pageH = rows * (cellSize + g) + g;
  } else {
    // Fixed page shape: the page size never changes. Auto-search the column
    // count that packs all N images as the largest possible square cells
    // inside that fixed frame, no matter how many images there are.
    const pageH = state.pageW * getRatioFactor();
    let bestCols = 1, bestSize = 0, bestRows = 1;
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      const sizeW = (state.pageW - g * (c + 1)) / c;
      const sizeH = (pageH - g * (r + 1)) / r;
      const size = Math.min(sizeW, sizeH);
      if (size > bestSize) { bestSize = size; bestCols = c; bestRows = r; }
    }
    cols = bestCols; rows = bestRows; cellSize = bestSize;
    const contentW = cols * cellSize + g * (cols + 1);
    const contentH = rows * cellSize + g * (rows + 1);
    offsetX = (state.pageW - contentW) / 2;
    offsetY = (pageH - contentH) / 2;
    state.pageH = pageH;
  }

  const positions = [];
  state.images.forEach((img, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    positions.push({
      x: offsetX + g + c * (cellSize + g),
      y: offsetY + g + r * (cellSize + g),
      w: cellSize, h: cellSize
    });
  });
  return positions;
}

function computeJustified() {
  const g = state.gutter;
  const targetH = (state.pageW - g * (state.cols + 1)) / state.cols; // rough baseline row height
  const positions = [];
  let row = [];
  let y = g;
  const flushRow = (isLast) => {
    if (row.length === 0) return;
    const naturalWidths = row.map(img => targetH * (img.w / img.h));
    const totalNatural = naturalWidths.reduce((a, b) => a + b, 0) + g * (row.length - 1);
    const scale = isLast && totalNatural < state.pageW - g * 2 ? 1 : (state.pageW - g * (row.length + 1)) / totalNatural;
    let x = g;
    row.forEach((img, i) => {
      const w = naturalWidths[i] * scale;
      const h = targetH * scale;
      positions.push({ x, y, w, h });
      x += w + g;
    });
    y += targetH * scale + g;
  };
  let rowWidth = 0;
  state.images.forEach(img => {
    const w = targetH * (img.w / img.h);
    if (rowWidth + w > state.pageW - g * 2 && row.length > 0) {
      flushRow(false);
      row = []; rowWidth = 0;
    }
    row.push(img);
    rowWidth += w + g;
  });
  flushRow(true);
  state.pageH = y;
  return positions;
}

function computeWaterfall() {
  const g = state.gutter;
  const colW = (state.pageW - g * (state.cols + 1)) / state.cols;
  const colHeights = new Array(state.cols).fill(g);
  const positions = [];
  state.images.forEach(img => {
    let col = 0;
    for (let i = 1; i < state.cols; i++) if (colHeights[i] < colHeights[col]) col = i;
    const h = colW * (img.h / img.w);
    const x = g + col * (colW + g);
    const y = colHeights[col];
    positions.push({ x, y, w: colW, h });
    colHeights[col] = y + h + g;
  });
  state.pageH = Math.max(...colHeights);
  return positions;
}

function computeLayout() {
  if (state.layout === 'grid') return computeGrid();
  if (state.layout === 'justified') return computeJustified();
  return computeWaterfall();
}

// ---------- canvas view ----------
function goToCanvas() {
  const positions = computeLayout();
  state.canvasItems = state.images.map((img, i) => {
    const p = positions[i] || { x: 20, y: 20, w: 200, h: 200 };
    return {
      uid: 'ci' + i,
      id: img.id, fileURL: img.fileURL, thumbURL: img.thumbURL, natW: img.w, natH: img.h,
      x: p.x, y: p.y, w: p.w, h: p.h,
      colSpan: 1, rowSpan: 1,
      rot: state.randomTilt ? (Math.random() * 6 - 3) : 0,
      fitMode: state.layout === 'grid' ? state.fitMode : 'cover',
      z: ++state.zCounter
    };
  });
  document.getElementById('setup-view').classList.add('hidden');
  document.getElementById('canvas-view').classList.remove('hidden');
  state.selectedUids.clear();
  state.arrangeMode = 'free';
  state.freeLocked = false;
  state.gridCellSize = 220;
  document.getElementById('lock-toggle').checked = false;
  document.getElementById('lock-toggle-row').classList.remove('hidden');
  document.getElementById('scale-whole-row').classList.remove('hidden');
  document.querySelectorAll('#arrange-group .opt-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('#arrange-group [data-arrange="free"]').classList.add('active');
  updateArrangeHint();
  state.lastScaleVal = 100;
  const scaleInput = document.getElementById('global-scale-input');
  scaleInput.value = 100;
  document.getElementById('global-scale-out').textContent = '100%';
  delete document.getElementById('stage-wrap').dataset.centered;
  state.undoStack = [];
  renderStage();
  pushUndo();
}

function goToSetup() {
  document.getElementById('canvas-view').classList.add('hidden');
  document.getElementById('setup-view').classList.remove('hidden');
}

function renderStage() {
  const stage = document.getElementById('stage');
  const wrap = document.getElementById('stage-wrap');
  const availW = wrap.clientWidth - 48;
  const scale = Math.min(1, availW / state.pageW);
  stage.style.transform = 'scale(' + scale + ')';
  stage.style.transformOrigin = 'top left';
  stage.style.background = state.bg;
  stage.innerHTML = '';

  stage.removeEventListener('pointerdown', onStagePointerDown);
  stage.removeEventListener('pointerdown', onPenPointerDown);

  if (state.arrangeMode === 'grid') {
    renderGridStage(stage);
  } else if (state.arrangeMode === 'flow') {
    renderFlowStage(stage);
  } else {
    renderFreeStage(stage);
  }

  layoutStageCanvas(scale);
}

// Gives generous, equal scroll room on every side — not just below, which is
// what a fixed-size stage naturally allows via normal document flow. Items
// dragged above/left/right of the page (Free mode) need the same treatment,
// which requires an outer canvas sized to include them plus a comfortable
// margin, since a plain scrollable box can't scroll into negative territory.
function layoutStageCanvas(scale) {
  const stage = document.getElementById('stage');
  const stageCanvas = document.getElementById('stage-canvas');
  const wrap = document.getElementById('stage-wrap');

  const BASE_MARGIN = 500;
  let minX = 0, minY = 0, maxX = state.pageW, maxY = state.pageH;
  if (state.arrangeMode === 'free') {
    state.canvasItems.forEach(it => {
      minX = Math.min(minX, it.x);
      minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x + it.w);
      maxY = Math.max(maxY, it.y + it.h);
    });
  }
  const marginLeft = BASE_MARGIN + Math.max(0, -minX);
  const marginTop = BASE_MARGIN + Math.max(0, -minY);
  const marginRight = BASE_MARGIN + Math.max(0, maxX - state.pageW);
  const marginBottom = BASE_MARGIN + Math.max(0, maxY - state.pageH);

  const canvasW = (marginLeft + state.pageW + marginRight) * scale;
  const canvasH = (marginTop + state.pageH + marginBottom) * scale;
  stageCanvas.style.width = canvasW + 'px';
  stageCanvas.style.height = canvasH + 'px';
  stage.style.left = (marginLeft * scale) + 'px';
  stage.style.top = (marginTop * scale) + 'px';

  if (!wrap.dataset.centered) {
    wrap.dataset.centered = '1';
    requestAnimationFrame(() => {
      wrap.scrollLeft = Math.max(0, (marginLeft * scale) - (wrap.clientWidth - state.pageW * scale) / 2);
      wrap.scrollTop = Math.max(0, (marginTop * scale) - 40);
    });
  }
}

function renderFreeStage(stage) {
  stage.style.display = 'block';
  stage.style.width = state.pageW + 'px';
  stage.style.height = state.pageH + 'px';
  stage.style.padding = '0';

  const locked = state.freeLocked;
  if (!locked && state.penMode) stage.addEventListener('pointerdown', onPenPointerDown);
  else if (!locked) stage.addEventListener('pointerdown', onStagePointerDown);

  const dragAttacher = locked ? attachSwapDrag : attachSelectableDrag;

  state.canvasItems.forEach(item => {
    const el = document.createElement('div');
    el.className = 'cw-item' + (item.type !== 'text' && item.type !== 'line' && item.type !== 'freehand' && item.fitMode === 'contain' ? ' fit-contain' : '')
      + (!locked && state.selectedUids.has(item.uid) ? ' selected' : '');
    el.dataset.uid = item.uid;
    el.style.position = 'absolute';
    el.style.left = item.x + 'px';
    el.style.top = item.y + 'px';
    el.style.width = item.w + 'px';
    el.style.height = item.h + 'px';
    el.style.transform = 'rotate(' + item.rot + 'deg)';
    el.style.zIndex = zIndexFor(item);

    buildCellContent(el, item);

    const handles = {};
    ['nw', 'ne', 'sw', 'se'].forEach(corner => {
      const h = document.createElement('div');
      h.className = 'handle ' + corner;
      h.style.pointerEvents = 'auto'; // stays clickable even if the parent (a line) has pointer-events:none
      el.appendChild(h);
      handles[corner] = h;
    });

    dragAttacher(el, item, handles);
    stage.appendChild(el);
  });

  if (!locked) updateGroupHandle();
}

// Grid mode: a real fixed-track CSS grid with perfectly square cells (no
// stretching to fill leftover width). Images always fit fully inside their
// cell, never cropped, and text cards get the same treatment. The Size
// slider changes the shared cell size, and the grid's own auto-fill reflow
// does the rest — grow past what fits and rows spill down, shrink and later
// cards pull back up to fill the gap. No individual resizing; dragging one
// card onto another swaps their place.
function renderGridStage(stage) {
  const g = state.gutter;
  const cellSize = state.gridCellSize;
  stage.style.display = 'grid';
  stage.style.gridTemplateColumns = 'repeat(auto-fill, ' + cellSize + 'px)';
  stage.style.gridAutoRows = cellSize + 'px';
  stage.style.gap = g + 'px';
  stage.style.padding = g + 'px';
  stage.style.width = state.pageW + 'px';
  stage.style.height = 'auto';

  state.canvasItems.filter(it => it.type !== 'line' && it.type !== 'freehand').forEach(item => {
    const el = document.createElement('div');
    el.className = 'cw-item' + (item.type !== 'text' ? ' fit-contain' : '');
    el.dataset.uid = item.uid;
    el.style.position = 'relative';
    el.style.left = ''; el.style.top = '';
    el.style.width = ''; el.style.height = '';
    el.style.transform = '';

    buildCellContent(el, item);
    attachGridSwap(el, item);
    stage.appendChild(el);
  });
}

// Flow mode: true masonry, computed in JS — each card is assigned to
// whichever column is currently shortest (like Pinterest), so there's never
// a gap left underneath a short card. Recomputed on every render, so the
// Size slider (column width) and swapping cards both reflow it live, the
// same way Grid already does. Each card keeps its own aspect ratio at the
// shared column width — images use their real aspect, text cards use
// whatever box shape they were last resized to in Free. No individual
// resizing; dragging one card onto another swaps their place.
function renderFlowStage(stage) {
  const g = state.gutter;
  const colWidth = state.gridCellSize;
  const cols = Math.max(1, Math.floor((state.pageW + g) / (colWidth + g)));
  const colHeights = new Array(cols).fill(g);

  stage.style.display = 'block';
  stage.style.position = 'relative';
  stage.style.width = state.pageW + 'px';
  stage.style.padding = '0';

  state.canvasItems.filter(it => it.type !== 'line' && it.type !== 'freehand').forEach(item => {
    const el = document.createElement('div');
    el.className = 'cw-item';
    el.dataset.uid = item.uid;
    el.style.transform = '';

    let col = 0;
    for (let i = 1; i < cols; i++) if (colHeights[i] < colHeights[col]) col = i;
    const h = colWidth * (item.natH / item.natW);
    const x = g + col * (colWidth + g);
    const y = colHeights[col];
    el.style.position = 'absolute';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.width = colWidth + 'px';
    el.style.height = h + 'px';
    colHeights[col] = y + h + g;

    buildCellContent(el, item);
    attachGridSwap(el, item);
    stage.appendChild(el);
  });

  stage.style.height = Math.max(...colHeights) + 'px';
}

function attachGridSwap(el, item) {
  el.addEventListener('pointerdown', (e) => {
    if (el.isContentEditable) return;
    const startX = e.clientX, startY = e.clientY;
    let moved = false;
    el.classList.add('dragging');
    const onMove = (ev) => {
      if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) moved = true;
      el.style.opacity = moved ? '0.5' : '1';
    };
    const onUp = (ev) => {
      el.classList.remove('dragging');
      el.style.opacity = '1';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) return;
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      const targetEl = target && target.closest ? target.closest('.cw-item') : null;
      if (targetEl && targetEl !== el) {
        const idxA = state.canvasItems.findIndex(i => i.uid === item.uid);
        const idxB = state.canvasItems.findIndex(i => i.uid === targetEl.dataset.uid);
        if (idxA >= 0 && idxB >= 0) {
          const tmp = state.canvasItems[idxA];
          state.canvasItems[idxA] = state.canvasItems[idxB];
          state.canvasItems[idxB] = tmp;
          renderStage();
        }
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

// ---------- pen tool: click-drag to draw a straight line/arrow ----------
function onPenPointerDown(e) {
  if (state.penTool === 'freehand') { onFreehandPointerDown(e); return; }
  if (state.penTool === 'zigzag') { onZigzagPointerDown(e); return; }

  const stage = e.currentTarget;
  const stageBox = stage.getBoundingClientRect();
  const scale = stageBox.width / state.pageW;
  const startX = (e.clientX - stageBox.left) / scale;
  const startY = (e.clientY - stageBox.top) / scale;

  const preview = document.createElementNS(SVG_NS, 'svg');
  preview.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible;z-index:999999;';
  preview.setAttribute('width', state.pageW);
  preview.setAttribute('height', state.pageH);
  const previewLine = document.createElementNS(SVG_NS, 'line');
  previewLine.setAttribute('stroke', state.lastLine.color);
  previewLine.setAttribute('stroke-width', state.lastLine.strokeWidth);
  previewLine.setAttribute('x1', startX); previewLine.setAttribute('y1', startY);
  previewLine.setAttribute('x2', startX); previewLine.setAttribute('y2', startY);
  preview.appendChild(previewLine);
  stage.appendChild(preview);

  const onMove = (ev) => {
    const curX = (ev.clientX - stageBox.left) / scale;
    const curY = (ev.clientY - stageBox.top) / scale;
    previewLine.setAttribute('x2', curX);
    previewLine.setAttribute('y2', curY);
  };
  const onUp = (ev) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    preview.remove();
    const curX = (ev.clientX - stageBox.left) / scale;
    const curY = (ev.clientY - stageBox.top) / scale;
    if (Math.hypot(curX - startX, curY - startY) < 8) return; // too short, ignore stray click
    createLineItem(startX, startY, curX, curY);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// Freehand: tracks every point while the pointer moves, drawn live as an SVG
// polyline, then stored as local (0..w, 0..h) coordinates relative to the
// path's own bounding box so it resizes cleanly with the rest of the board.
function onFreehandPointerDown(e) {
  const stage = e.currentTarget;
  const stageBox = stage.getBoundingClientRect();
  const scale = stageBox.width / state.pageW;
  const points = [{ x: (e.clientX - stageBox.left) / scale, y: (e.clientY - stageBox.top) / scale }];

  const preview = document.createElementNS(SVG_NS, 'svg');
  preview.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible;z-index:999999;';
  preview.setAttribute('width', state.pageW);
  preview.setAttribute('height', state.pageH);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', state.lastLine.color);
  path.setAttribute('stroke-width', state.lastLine.strokeWidth);
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  preview.appendChild(path);
  stage.appendChild(preview);

  const buildD = () => 'M ' + points.map(p => p.x + ',' + p.y).join(' L ');
  path.setAttribute('d', buildD());

  const onMove = (ev) => {
    points.push({ x: (ev.clientX - stageBox.left) / scale, y: (ev.clientY - stageBox.top) / scale });
    path.setAttribute('d', buildD());
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    preview.remove();
    if (points.length < 2) return;
    createFreehandItem(points);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// Zigzag: click to place each point (connected by straight segments — the
// exact same data shape as a freehand drawing, just built from clicks
// instead of continuous drag sampling), Enter/right-click to finish,
// Escape to cancel. A live rubber-band segment follows the cursor between
// clicks so you can see the next segment before committing to it.
let zigzagSession = null;

// Snaps a point to the nearest 45° direction from a reference point, so
// zigzags come out straight/diagonal instead of slightly off-angle.
function snapToAngle(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return { x: to.x, y: to.y };
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + dist * Math.cos(angle), y: from.y + dist * Math.sin(angle) };
}

function onZigzagPointerDown(e) {
  const stage = document.getElementById('stage');
  const stageBox = stage.getBoundingClientRect();
  const scale = stageBox.width / state.pageW;
  const rawX = (e.clientX - stageBox.left) / scale;
  const rawY = (e.clientY - stageBox.top) / scale;

  if (!zigzagSession) {
    const preview = document.createElementNS(SVG_NS, 'svg');
    preview.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible;z-index:999999;';
    preview.setAttribute('width', state.pageW);
    preview.setAttribute('height', state.pageH);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', state.lastLine.color);
    path.setAttribute('stroke-width', state.lastLine.strokeWidth);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    preview.appendChild(path);
    stage.appendChild(preview);

    zigzagSession = { points: [{ x: rawX, y: rawY }], preview, path };
    document.addEventListener('mousemove', onZigzagMove);
    document.addEventListener('contextmenu', onZigzagContextMenu);
    document.addEventListener('dblclick', onZigzagDblClick);
    document.addEventListener('keydown', onZigzagKeydown);
    updateZigzagPreview(rawX, rawY);
  } else {
    const last = zigzagSession.points[zigzagSession.points.length - 1];
    const snapped = snapToAngle(last, { x: rawX, y: rawY });
    zigzagSession.points.push(snapped);
    updateZigzagPreview(snapped.x, snapped.y);
  }
}

function onZigzagMove(e) {
  if (!zigzagSession) return;
  const stage = document.getElementById('stage');
  const stageBox = stage.getBoundingClientRect();
  const scale = stageBox.width / state.pageW;
  const rawX = (e.clientX - stageBox.left) / scale;
  const rawY = (e.clientY - stageBox.top) / scale;
  const last = zigzagSession.points[zigzagSession.points.length - 1];
  const snapped = snapToAngle(last, { x: rawX, y: rawY });
  updateZigzagPreview(snapped.x, snapped.y);
}

function updateZigzagPreview(curX, curY) {
  const pts = zigzagSession.points.concat([{ x: curX, y: curY }]);
  zigzagSession.path.setAttribute('d', 'M ' + pts.map(p => p.x + ',' + p.y).join(' L '));
}

function onZigzagContextMenu(e) {
  e.preventDefault();
  finishZigzag();
}
function onZigzagDblClick(e) {
  e.preventDefault();
  // The second click of the double-click already added a point right on
  // top of the first — drop that duplicate before finishing.
  if (zigzagSession && zigzagSession.points.length > 1) zigzagSession.points.pop();
  finishZigzag();
}
function onZigzagKeydown(e) {
  if (e.key === 'Enter') { e.preventDefault(); finishZigzag(); }
  else if (e.key === 'Escape') { e.preventDefault(); cancelZigzag(); }
}
function cleanupZigzagListeners() {
  document.removeEventListener('mousemove', onZigzagMove);
  document.removeEventListener('contextmenu', onZigzagContextMenu);
  document.removeEventListener('dblclick', onZigzagDblClick);
  document.removeEventListener('keydown', onZigzagKeydown);
}
function finishZigzag() {
  if (!zigzagSession) return;
  const pts = zigzagSession.points;
  zigzagSession.preview.remove();
  cleanupZigzagListeners();
  zigzagSession = null;
  if (pts.length >= 2) createFreehandItem(pts);
}
function cancelZigzag() {
  if (!zigzagSession) return;
  zigzagSession.preview.remove();
  cleanupZigzagListeners();
  zigzagSession = null;
}

function createFreehandItem(points) {
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  const w = Math.max(4, maxX - minX), h = Math.max(4, maxY - minY);
  const item = {
    type: 'freehand',
    uid: 'ci-fh-' + Date.now(),
    x: minX, y: minY, w, h,
    // Stored as 0..1 fractions of the box, not absolute pixels — so the
    // whole drawing rescales correctly whenever the box is resized, instead
    // of staying pinned at its original size while the box grows around it.
    points: points.map(p => ({ x: (p.x - minX) / w, y: (p.y - minY) / h })),
    strokeWidth: state.lastLine.strokeWidth, color: state.lastLine.color, dashed: state.lastLine.dashed,
    arrow: state.lastLine.arrow, arrowStart: state.lastLine.arrowStart,
    rot: 0,
    z: ++state.zCounter
  };
  state.canvasItems.push(item);
  state.selectedUids = new Set([item.uid]);
  renderStage();
  showLineToolbar(item);
  recordChange();
}

function createLineItem(x1, y1, x2, y2) {
  const item = {
    type: 'line',
    uid: 'ci-line-' + Date.now(),
    x: Math.min(x1, x2), y: Math.min(y1, y2),
    w: Math.max(4, Math.abs(x2 - x1)), h: Math.max(4, Math.abs(y2 - y1)),
    flipY: (x2 - x1) * (y2 - y1) < 0,
    strokeWidth: state.lastLine.strokeWidth, color: state.lastLine.color,
    dashed: state.lastLine.dashed, arrow: state.lastLine.arrow, arrowStart: state.lastLine.arrowStart,
    rot: 0,
    z: ++state.zCounter
  };
  state.canvasItems.push(item);
  state.selectedUids = new Set([item.uid]);
  renderStage();
  showLineToolbar(item);
  recordChange();
}

function hideItemToolbar() {
  const bar = document.getElementById('item-toolbar-bar');
  bar.classList.add('hidden');
  bar.innerHTML = '';
}
function hideAllFloatingToolbars() {
  hideItemToolbar();
}

// Shown while Pen mode is on but nothing's been drawn yet (or nothing is
// selected): lets you pick Line vs Freehand and set the color/thickness/
// style that the *next* line will use. Once a line exists and is selected,
// showLineToolbar takes over the same panel with that line's own controls.
function showPenDefaultsToolbar() {
  const bar = document.getElementById('item-toolbar-bar');
  bar.innerHTML = '';
  bar.classList.remove('hidden');

  const lineToolBtn = document.createElement('button');
  lineToolBtn.textContent = 'Line';
  lineToolBtn.className = state.penTool === 'line' ? 'active' : '';
  const freehandToolBtn = document.createElement('button');
  freehandToolBtn.textContent = 'Freehand';
  freehandToolBtn.className = state.penTool === 'freehand' ? 'active' : '';
  const zigzagToolBtn = document.createElement('button');
  zigzagToolBtn.textContent = 'Zigzag';
  zigzagToolBtn.title = 'Click to place each point, Enter to finish, Escape to cancel';
  zigzagToolBtn.className = state.penTool === 'zigzag' ? 'active' : '';
  const setPenTool = (tool) => {
    cancelZigzag();
    state.penTool = tool;
    [lineToolBtn, freehandToolBtn, zigzagToolBtn].forEach(b => b.classList.remove('active'));
    ({ line: lineToolBtn, freehand: freehandToolBtn, zigzag: zigzagToolBtn })[tool].classList.add('active');
  };
  lineToolBtn.onmousedown = (e) => { e.preventDefault(); setPenTool('line'); };
  freehandToolBtn.onmousedown = (e) => { e.preventDefault(); setPenTool('freehand'); };
  zigzagToolBtn.onmousedown = (e) => { e.preventDefault(); setPenTool('zigzag'); };

  const sep = document.createElement('div'); sep.className = 'item-toolbar-sep';

  const thinnerBtn = document.createElement('button');
  thinnerBtn.textContent = '−'; thinnerBtn.title = 'Thinner';
  const widthLabel = document.createElement('span');
  widthLabel.style.cssText = 'font-size:12px;color:var(--text-secondary);min-width:18px;text-align:center;';
  widthLabel.textContent = state.lastLine.strokeWidth;
  const thickerBtn = document.createElement('button');
  thickerBtn.textContent = '+'; thickerBtn.title = 'Thicker';
  thinnerBtn.onmousedown = (e) => { e.preventDefault(); state.lastLine.strokeWidth = Math.max(1, state.lastLine.strokeWidth - 1); widthLabel.textContent = state.lastLine.strokeWidth; };
  thickerBtn.onmousedown = (e) => { e.preventDefault(); state.lastLine.strokeWidth = Math.min(40, state.lastLine.strokeWidth + 1); widthLabel.textContent = state.lastLine.strokeWidth; };

  const solidBtn = document.createElement('button');
  solidBtn.textContent = '―'; solidBtn.title = 'Solid';
  solidBtn.className = !state.lastLine.dashed ? 'active' : '';
  const dashedBtn = document.createElement('button');
  dashedBtn.textContent = '┄'; dashedBtn.title = 'Dashed';
  dashedBtn.className = state.lastLine.dashed ? 'active' : '';
  solidBtn.onmousedown = (e) => { e.preventDefault(); state.lastLine.dashed = false; solidBtn.classList.add('active'); dashedBtn.classList.remove('active'); };
  dashedBtn.onmousedown = (e) => { e.preventDefault(); state.lastLine.dashed = true; dashedBtn.classList.add('active'); solidBtn.classList.remove('active'); };

  const arrowStartBtn = document.createElement('button');
  arrowStartBtn.textContent = '←'; arrowStartBtn.title = 'Arrowhead at start';
  arrowStartBtn.className = state.lastLine.arrowStart ? 'active' : '';
  const arrowEndBtn = document.createElement('button');
  arrowEndBtn.textContent = '→'; arrowEndBtn.title = 'Arrowhead at end';
  arrowEndBtn.className = state.lastLine.arrow ? 'active' : '';
  arrowStartBtn.onmousedown = (e) => { e.preventDefault(); state.lastLine.arrowStart = !state.lastLine.arrowStart; arrowStartBtn.classList.toggle('active', state.lastLine.arrowStart); };
  arrowEndBtn.onmousedown = (e) => { e.preventDefault(); state.lastLine.arrow = !state.lastLine.arrow; arrowEndBtn.classList.toggle('active', state.lastLine.arrow); };

  const colorEls = buildLineColorControls((c) => { state.lastLine.color = c; });

  [lineToolBtn, freehandToolBtn, zigzagToolBtn, sep, thinnerBtn, widthLabel, thickerBtn, solidBtn, dashedBtn, arrowStartBtn, arrowEndBtn, ...colorEls]
    .forEach(x => bar.appendChild(x));
}

function showLineToolbar(item) {
  const bar = document.getElementById('item-toolbar-bar');
  bar.innerHTML = '';
  bar.classList.remove('hidden');

  const el = () => document.querySelector('.cw-item[data-uid="' + item.uid + '"]');

  const thinnerBtn = document.createElement('button');
  thinnerBtn.textContent = '−'; thinnerBtn.title = 'Thinner';
  const widthLabel = document.createElement('span');
  widthLabel.style.cssText = 'font-size:12px;color:var(--text-secondary);min-width:18px;text-align:center;';
  widthLabel.textContent = item.strokeWidth;
  const thickerBtn = document.createElement('button');
  thickerBtn.textContent = '+'; thickerBtn.title = 'Thicker';

  const solidBtn = document.createElement('button');
  solidBtn.textContent = '―'; solidBtn.title = 'Solid';
  solidBtn.className = !item.dashed ? 'active' : '';
  const dashedBtn = document.createElement('button');
  dashedBtn.textContent = '┄'; dashedBtn.title = 'Dashed';
  dashedBtn.className = item.dashed ? 'active' : '';

  const arrowStartBtn = document.createElement('button');
  arrowStartBtn.textContent = '←'; arrowStartBtn.title = 'Arrowhead at start';
  arrowStartBtn.className = item.arrowStart ? 'active' : '';
  const arrowEndBtn = document.createElement('button');
  arrowEndBtn.textContent = '→'; arrowEndBtn.title = 'Arrowhead at end';
  arrowEndBtn.className = item.arrow ? 'active' : '';

  const redraw = () => {
    const e2 = el();
    if (e2) { if (item.type === 'freehand') renderFreehandSVG(e2, item); else renderLineSVG(e2, item); }
    syncLastLine();
  };
  const syncLastLine = () => {
    state.lastLine = { strokeWidth: item.strokeWidth, color: item.color, dashed: item.dashed, arrow: item.arrow || false, arrowStart: item.arrowStart || false };
  };

  thinnerBtn.onmousedown = (e) => { e.preventDefault(); item.strokeWidth = Math.max(1, item.strokeWidth - 1); widthLabel.textContent = item.strokeWidth; redraw(); };
  thickerBtn.onmousedown = (e) => { e.preventDefault(); item.strokeWidth = Math.min(40, item.strokeWidth + 1); widthLabel.textContent = item.strokeWidth; redraw(); };
  solidBtn.onmousedown = (e) => { e.preventDefault(); item.dashed = false; solidBtn.classList.add('active'); dashedBtn.classList.remove('active'); redraw(); };
  dashedBtn.onmousedown = (e) => { e.preventDefault(); item.dashed = true; dashedBtn.classList.add('active'); solidBtn.classList.remove('active'); redraw(); };
  arrowStartBtn.onmousedown = (e) => { e.preventDefault(); item.arrowStart = !item.arrowStart; arrowStartBtn.classList.toggle('active', item.arrowStart); redraw(); };
  arrowEndBtn.onmousedown = (e) => { e.preventDefault(); item.arrow = !item.arrow; arrowEndBtn.classList.toggle('active', item.arrow); redraw(); };
  const colorEls = buildLineColorControls((c) => { item.color = c; }, redraw);

  const delBtn = document.createElement('button');
  delBtn.textContent = '✕'; delBtn.title = 'Delete';
  delBtn.onmousedown = (e) => {
    e.preventDefault();
    state.canvasItems = state.canvasItems.filter(i => i.uid !== item.uid);
    state.selectedUids.delete(item.uid);
    hideLineToolbar();
    renderStage();
    recordChange();
  };

  const controls = [thinnerBtn, widthLabel, thickerBtn, solidBtn, dashedBtn, arrowStartBtn, arrowEndBtn];
  controls.push(...colorEls, delBtn);
  controls.forEach(x => bar.appendChild(x));

  registerOutsideClickHandler(onOutsideClick);
  function onOutsideClick(e) {
    if (bar.contains(e.target) || (el() && el().contains(e.target))) return;
    document.removeEventListener('mousedown', onOutsideClick);
    if (activeOutsideClickHandler === onOutsideClick) activeOutsideClickHandler = null;
    hideLineToolbar();
  }
}

function hideLineToolbar() {
  hideItemToolbar();
}

function showImageToolbar(item, el) {
  const bar = document.getElementById('item-toolbar-bar');
  bar.innerHTML = '';
  bar.classList.remove('hidden');

  const { solidBtn, dashedBtn, widthMinusBtn, widthLabel, widthPlusBtn, borderColorCustomWrap }
    = buildBorderControls(item, () => applyItemStyle(el, item));

  [solidBtn, dashedBtn, widthMinusBtn, widthLabel, widthPlusBtn, borderColorCustomWrap]
    .forEach(x => bar.appendChild(x));

  registerOutsideClickHandler(onOutsideClick);
  function onOutsideClick(e) {
    const liveEl = document.querySelector('.cw-item[data-uid="' + item.uid + '"]');
    if (bar.contains(e.target) || (liveEl && liveEl.contains(e.target))) return;
    document.removeEventListener('mousedown', onOutsideClick);
    if (activeOutsideClickHandler === onOutsideClick) activeOutsideClickHandler = null;
    hideItemToolbar();
  }
}

// ---------- select mode: marquee + group move/resize ----------
function onStagePointerDown(e) {
  if (e.target !== e.currentTarget) return; // clicked an item, not empty stage
  const stage = e.currentTarget;
  const stageBox = stage.getBoundingClientRect();
  const scale = stageBox.width / state.pageW;
  const startX = (e.clientX - stageBox.left) / scale;
  const startY = (e.clientY - stageBox.top) / scale;

  if (!e.shiftKey && !e.ctrlKey && !e.metaKey) state.selectedUids.clear();

  const marquee = document.createElement('div');
  marquee.id = 'marquee-box';
  marquee.style.cssText = 'position:absolute;border:1.5px dashed var(--accent);background:rgba(91,159,230,0.15);pointer-events:none;';
  stage.appendChild(marquee);

  const onMove = (ev) => {
    const curX = (ev.clientX - stageBox.left) / scale;
    const curY = (ev.clientY - stageBox.top) / scale;
    const x = Math.min(startX, curX), y = Math.min(startY, curY);
    const w = Math.abs(curX - startX), h = Math.abs(curY - startY);
    marquee.style.left = x + 'px'; marquee.style.top = y + 'px';
    marquee.style.width = w + 'px'; marquee.style.height = h + 'px';
  };
  const onUp = (ev) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    const curX = (ev.clientX - stageBox.left) / scale;
    const curY = (ev.clientY - stageBox.top) / scale;
    const x = Math.min(startX, curX), y = Math.min(startY, curY);
    const w = Math.abs(curX - startX), h = Math.abs(curY - startY);
    marquee.remove();
    if (w > 3 || h > 3) {
      state.canvasItems.forEach(it => {
        const overlaps = !(it.x + it.w < x || it.x > x + w || it.y + it.h < y || it.y > y + h);
        if (overlaps) state.selectedUids.add(it.uid);
      });
    }
    refreshSelectionVisuals();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function refreshSelectionVisuals() {
  document.querySelectorAll('.cw-item').forEach(el => {
    el.classList.toggle('selected', state.selectedUids.has(el.dataset.uid));
  });
  updateGroupHandle();
}

function computeSelectionBBox() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  state.selectedUids.forEach(uid => {
    const it = state.canvasItems.find(i => i.uid === uid);
    if (!it) return;
    minX = Math.min(minX, it.x); minY = Math.min(minY, it.y);
    maxX = Math.max(maxX, it.x + it.w); maxY = Math.max(maxY, it.y + it.h);
  });
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function updateGroupHandle() {
  const stage = document.getElementById('stage');
  let box = document.getElementById('group-select-box');
  const existingHandles = {};
  ['nw', 'ne', 'sw', 'se'].forEach(c => {
    existingHandles[c] = document.getElementById('group-select-handle-' + c);
  });
  const bbox = computeSelectionBBox();

  if (!bbox || state.selectedUids.size < 2) {
    if (box) box.remove();
    Object.values(existingHandles).forEach(h => { if (h) h.remove(); });
    return;
  }

  if (!box) {
    box = document.createElement('div');
    box.id = 'group-select-box';
    box.style.position = 'absolute';
    stage.appendChild(box);
  }
  box.style.left = bbox.x + 'px'; box.style.top = bbox.y + 'px';
  box.style.width = bbox.w + 'px'; box.style.height = bbox.h + 'px';

  const corners = {
    nw: { x: bbox.x, y: bbox.y },
    ne: { x: bbox.x + bbox.w, y: bbox.y },
    sw: { x: bbox.x, y: bbox.y + bbox.h },
    se: { x: bbox.x + bbox.w, y: bbox.y + bbox.h }
  };
  Object.entries(corners).forEach(([corner, pos]) => {
    let handle = existingHandles[corner];
    if (!handle) {
      handle = document.createElement('div');
      handle.id = 'group-select-handle-' + corner;
      handle.className = 'stage-handle ' + corner;
      stage.appendChild(handle);
      attachGroupResize(handle, corner);
    }
    handle.style.left = pos.x + 'px';
    handle.style.top = pos.y + 'px';
  });
}

function attachGroupResize(handle, corner) {
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const bbox = computeSelectionBBox();
    if (!bbox) return;
    const startX = e.clientX, startY = e.clientY;
    const snapshot = new Map();
    state.selectedUids.forEach(uid => {
      const it = state.canvasItems.find(i => i.uid === uid);
      if (it) snapshot.set(uid, { x: it.x, y: it.y, w: it.w, h: it.h, strokeWidth: it.strokeWidth });
    });
    const onMove = (ev) => {
      const stage = document.getElementById('stage');
      const scale = stage.getBoundingClientRect().width / state.pageW;
      const dx = (ev.clientX - startX) / scale, dy = (ev.clientY - startY) / scale;
      const minSize = 30;

      // Anchor is the opposite corner from the one being dragged.
      let anchorX = corner.includes('e') ? bbox.x : bbox.x + bbox.w;
      let anchorY = corner.includes('s') ? bbox.y : bbox.y + bbox.h;
      let newW = corner.includes('e') ? bbox.w + dx : bbox.w - dx;
      let newH = corner.includes('s') ? bbox.h + dy : bbox.h - dy;
      newW = Math.max(minSize, newW);
      newH = Math.max(minSize, newH);
      const scaleX = newW / bbox.w, scaleY = newH / bbox.h;
      const avgScale = Math.sqrt(scaleX * scaleY);

      snapshot.forEach((s, uid) => {
        const it = state.canvasItems.find(i => i.uid === uid);
        if (!it) return;
        it.x = anchorX + (s.x - anchorX) * scaleX;
        it.y = anchorY + (s.y - anchorY) * scaleY;
        it.w = s.w * scaleX;
        it.h = s.h * scaleY;
        const el2 = document.querySelector('.cw-item[data-uid="' + uid + '"]');
        if (el2) {
          el2.style.left = it.x + 'px'; el2.style.top = it.y + 'px';
          el2.style.width = it.w + 'px'; el2.style.height = it.h + 'px';
        }
        if (it.type === 'line' || it.type === 'freehand') {
          // A group resize scales the line's thickness too, proportionally
          // to how much the group itself grew or shrank.
          it.strokeWidth = Math.max(1, s.strokeWidth * avgScale);
          if (el2) { if (it.type === 'freehand') renderFreehandSVG(el2, it); else renderLineSVG(el2, it); }
        }
      });
      updateGroupHandle();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

// Select mode: click selects (Shift/Cmd adds to selection), dragging any
// selected image moves the whole selection together. Corner handles still
// resize just that one image, independent of the group.
function attachSelectableDrag(el, item, handles) {
  attachCornerResize(el, item, handles);
  el.addEventListener('pointerdown', (e) => {
    if (Object.values(handles).includes(e.target)) return;
    if (el.isContentEditable) return;
    if (state.penMode) return;
    e.stopPropagation();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!state.selectedUids.has(item.uid)) {
      if (!additive) state.selectedUids.clear();
      state.selectedUids.add(item.uid);
      refreshSelectionVisuals();
    } else if (additive) {
      state.selectedUids.delete(item.uid);
      refreshSelectionVisuals();
      return;
    }

    if (state.selectedUids.size === 1) {
      if (item.type === 'line' || item.type === 'freehand') showLineToolbar(item);
      else if (item.type === 'text') showTextToolbar(item, el);
      else showImageToolbar(item, el);
    } else {
      hideItemToolbar();
    }

    const movingUids = new Set(state.selectedUids);
    const startPositions = new Map();
    movingUids.forEach(uid => {
      const it = state.canvasItems.find(i => i.uid === uid);
      if (it) startPositions.set(uid, { x: it.x, y: it.y });
    });
    const startX = e.clientX, startY = e.clientY;
    item.z = ++state.zCounter;
    el.style.zIndex = zIndexFor(item);

    const onMove = (ev) => {
      const stage = document.getElementById('stage');
      const scale = stage.getBoundingClientRect().width / state.pageW;
      const dx = (ev.clientX - startX) / scale, dy = (ev.clientY - startY) / scale;
      movingUids.forEach(uid => {
        const it = state.canvasItems.find(i => i.uid === uid);
        const sp = startPositions.get(uid);
        if (it && sp) {
          it.x = sp.x + dx; it.y = sp.y + dy;
          const itEl = document.querySelector('.cw-item[data-uid="' + uid + '"]');
          if (itEl) { itEl.style.left = it.x + 'px'; itEl.style.top = it.y + 'px'; }
        }
      });
      updateGroupHandle();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

// Shared corner-resize behavior: works identically whether the item can
// otherwise move freely (Free) or only swap places (Flow). Resizing one
// image never touches anyone else's size or position.
function attachCornerResize(el, item, handles) {
  Object.entries(handles).forEach(([corner, h]) => {
    h.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      const startItem = { x: item.x, y: item.y, w: item.w, h: item.h, fontSize: item.fontSize };
      item.z = ++state.zCounter;
      el.style.zIndex = zIndexFor(item);
      el.classList.add('dragging');
      const onMove = (ev) => {
        const stage = document.getElementById('stage');
        const scale = stage.getBoundingClientRect().width / state.pageW;
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        const minSize = 30;
        if (corner === 'se') {
          item.w = Math.max(minSize, startItem.w + dx);
          item.h = Math.max(minSize, startItem.h + dy);
        } else if (corner === 'sw') {
          item.w = Math.max(minSize, startItem.w - dx);
          item.h = Math.max(minSize, startItem.h + dy);
          item.x = startItem.x + startItem.w - item.w;
        } else if (corner === 'ne') {
          item.w = Math.max(minSize, startItem.w + dx);
          item.h = Math.max(minSize, startItem.h - dy);
          item.y = startItem.y + startItem.h - item.h;
        } else if (corner === 'nw') {
          item.w = Math.max(minSize, startItem.w - dx);
          item.h = Math.max(minSize, startItem.h - dy);
          item.x = startItem.x + startItem.w - item.w;
          item.y = startItem.y + startItem.h - item.h;
        }
        el.style.width = item.w + 'px';
        el.style.height = item.h + 'px';
        el.style.left = item.x + 'px';
        el.style.top = item.y + 'px';
        if (item.type === 'text') {
          item.natW = item.w; item.natH = item.h;
          if (!el.isContentEditable) {
            // Scale the font together with the box so the wrapping stays the
            // same shape while resizing, instead of the text reflowing.
            // Only when resizing "from outside" (not actively typing) —
            // while editing, resizing should only change the box.
            const scaleFactor = item.w / startItem.w;
            item.fontSize = Math.max(6, startItem.fontSize * scaleFactor);
            el.style.fontSize = item.fontSize + 'px';
          }
        } else if (item.type === 'line') {
          // Redraw with the new box every frame — the endpoints move with
          // the box, but stroke width and dash spacing stay exactly as set,
          // instead of visually stretching along with an image-like resize.
          renderLineSVG(el, item);
        } else if (item.type === 'freehand') {
          renderFreehandSVG(el, item);
        }
      };
      const onUp = () => {
        el.classList.remove('dragging');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (item.type === 'line') renderLineSVG(el, item);
        else if (item.type === 'freehand') renderFreehandSVG(el, item);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  });
}

// Locked Free: dragging one image onto another swaps their place, size and
// rotation — nothing gets aligned or normalized, whatever irregular spacing
// you built stays irregular. Resizing pushes/pulls whichever neighbors sit
// directly to its right/left/below/above, keeping the gap constant, with a
// proportional nudge for neighbors that are only partly aligned.
function overlapWeight(aStart, aLen, bStart, bLen, tol) {
  const aMin = aStart - tol, aMax = aStart + aLen + tol;
  const bMin = bStart, bMax = bStart + bLen;
  const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
  if (overlap <= 0 || Math.min(aLen, bLen) <= 0) return 0;
  return Math.min(1, overlap / Math.min(aLen, bLen));
}

function attachPushResize(el, item, handles) {
  Object.entries(handles).forEach(([corner, h]) => {
    h.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      const startRect = { x: item.x, y: item.y, w: item.w, h: item.h };
      const tol = 60;

      const rightN = [], leftN = [], bottomN = [], topN = [];
      state.canvasItems.forEach(other => {
        if (other === item) return;
        const vw = overlapWeight(startRect.y, startRect.h, other.y, other.h, tol);
        const hw = overlapWeight(startRect.x, startRect.w, other.x, other.w, tol);
        if (vw > 0 && other.x >= startRect.x + startRect.w - tol) rightN.push({ it: other, sx: other.x, w: vw });
        if (vw > 0 && other.x + other.w <= startRect.x + tol) leftN.push({ it: other, sx: other.x, w: vw });
        if (hw > 0 && other.y >= startRect.y + startRect.h - tol) bottomN.push({ it: other, sy: other.y, w: hw });
        if (hw > 0 && other.y + other.h <= startRect.y + tol) topN.push({ it: other, sy: other.y, w: hw });
      });

      item.z = ++state.zCounter;
      el.style.zIndex = zIndexFor(item);
      el.classList.add('dragging');

      const onMove = (ev) => {
        const stage = document.getElementById('stage');
        const scale = stage.getBoundingClientRect().width / state.pageW;
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        const minSize = 30;
        let newX = startRect.x, newY = startRect.y, newW = startRect.w, newH = startRect.h;

        if (corner === 'se') {
          newW = Math.max(minSize, startRect.w + dx);
          newH = Math.max(minSize, startRect.h + dy);
        } else if (corner === 'sw') {
          newW = Math.max(minSize, startRect.w - dx);
          newH = Math.max(minSize, startRect.h + dy);
          newX = startRect.x + startRect.w - newW;
        } else if (corner === 'ne') {
          newW = Math.max(minSize, startRect.w + dx);
          newH = Math.max(minSize, startRect.h - dy);
          newY = startRect.y + startRect.h - newH;
        } else if (corner === 'nw') {
          newW = Math.max(minSize, startRect.w - dx);
          newH = Math.max(minSize, startRect.h - dy);
          newX = startRect.x + startRect.w - newW;
          newY = startRect.y + startRect.h - newH;
        }

        item.x = newX; item.y = newY; item.w = newW; item.h = newH;
        el.style.left = newX + 'px'; el.style.top = newY + 'px';
        el.style.width = newW + 'px'; el.style.height = newH + 'px';

        const dRight = (newX + newW) - (startRect.x + startRect.w);
        const dLeft = newX - startRect.x;
        const dBottom = (newY + newH) - (startRect.y + startRect.h);
        const dTop = newY - startRect.y;

        if (corner === 'se' || corner === 'ne') rightN.forEach(n => { n.it.x = n.sx + dRight * n.w; movePushedEl(n.it); });
        if (corner === 'sw' || corner === 'nw') leftN.forEach(n => { n.it.x = n.sx + dLeft * n.w; movePushedEl(n.it); });
        if (corner === 'se' || corner === 'sw') bottomN.forEach(n => { n.it.y = n.sy + dBottom * n.w; movePushedEl(n.it); });
        if (corner === 'ne' || corner === 'nw') topN.forEach(n => { n.it.y = n.sy + dTop * n.w; movePushedEl(n.it); });
      };
      const onUp = () => {
        el.classList.remove('dragging');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  });
}
function movePushedEl(it) {
  const el = document.querySelector('.cw-item[data-uid="' + it.uid + '"]');
  if (el) { el.style.left = it.x + 'px'; el.style.top = it.y + 'px'; }
}

function attachSwapDrag(el, item, handles) {
  attachPushResize(el, item, handles);
  el.addEventListener('pointerdown', (e) => {
    if (Object.values(handles).includes(e.target)) return;
    if (el.isContentEditable) return;
    const startX = e.clientX, startY = e.clientY;
    item.z = ++state.zCounter;
    el.style.zIndex = zIndexFor(item);
    el.classList.add('dragging');
    const onMove = (ev) => {
      const stage = document.getElementById('stage');
      const scale = stage.getBoundingClientRect().width / state.pageW;
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      el.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(' + item.rot + 'deg)';
    };
    const onUp = (ev) => {
      el.classList.remove('dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      const targetEl = target && target.closest ? target.closest('.cw-item') : null;
      if (targetEl && targetEl !== el) {
        const other = state.canvasItems.find(i => i.uid === targetEl.dataset.uid);
        if (other) {
          const tmp = { x: item.x, y: item.y, w: item.w, h: item.h, rot: item.rot };
          item.x = other.x; item.y = other.y; item.w = other.w; item.h = other.h; item.rot = other.rot;
          other.x = tmp.x; other.y = tmp.y; other.w = tmp.w; other.h = tmp.h; other.rot = tmp.rot;
        }
      }
      renderStage();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

// Reads the images' current on-screen positions back into virtual page
// coordinates before export. Kept as a safety net in case anything ever
// drifts out of sync with the tracked state.
function syncPositionsFromDOM() {
  const stage = document.getElementById('stage');
  const stageBox = stage.getBoundingClientRect();
  const scale = stageBox.width / state.pageW;
  if (!scale) return;
  let maxBottom = 0;
  document.querySelectorAll('.cw-item').forEach(el => {
    const item = state.canvasItems.find(i => i.uid === el.dataset.uid);
    if (!item) return;
    const r = el.getBoundingClientRect();
    item.x = (r.left - stageBox.left) / scale;
    item.y = (r.top - stageBox.top) / scale;
    item.w = r.width / scale;
    item.h = r.height / scale;
    if (item.type === 'text') { item.natW = item.w; item.natH = item.h; }
    maxBottom = Math.max(maxBottom, item.y + item.h);
  });
  state.pageH = maxBottom + state.gutter;
}

// ---------- export ----------
// Hard safety cap: keep total canvas pixel area well under Chromium's practical
// 2D-canvas limits (roughly 268M px, varies by platform/GPU) and under a size that
// still produces a base64 payload Eagle's IPC can carry reliably.
const MAX_CANVAS_AREA = 40 * 1000 * 1000; // 40 megapixels

function getStatusEl() {
  let el = document.getElementById('export-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'export-status';
    el.style.cssText = 'font-size:12px;color:#e0837f;margin:0;padding:8px 0 0;max-width:600px;';
    document.querySelector('.toolbar').insertAdjacentElement('afterend', el);
  }
  return el;
}

// ---------- rich text (per-selection bold/color) rendering ----------
// Walks the saved contentEditable innerHTML into a flat list of styled runs
// (bold/color per run), with explicit line breaks where a <div> or <br>
// occurred — this is how execCommand('bold')/execCommand('foreColor')
// formatting on a partial selection gets preserved through to export.
function extractTextRuns(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  const runs = [];
  function walk(node, bold, color, fontSize) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) runs.push({ text: node.textContent, bold, color, fontSize });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') { runs.push({ text: '', bold, color, fontSize, brk: true }); return; }
    let newBold = bold, newColor = color, newFontSize = fontSize;
    if (tag === 'b' || tag === 'strong') newBold = true;
    const styleWeight = node.style && node.style.fontWeight;
    if (styleWeight && (styleWeight === 'bold' || parseInt(styleWeight, 10) >= 600)) newBold = true;
    const styleColor = node.style && node.style.color;
    if (styleColor) newColor = styleColor;
    const styleFontSize = node.style && node.style.fontSize;
    if (styleFontSize) newFontSize = parseFloat(styleFontSize);
    Array.from(node.childNodes).forEach(child => walk(child, newBold, newColor, newFontSize));
    if (tag === 'div' || tag === 'p') runs.push({ text: '', bold, color, fontSize, brk: true });
  }
  Array.from(container.childNodes).forEach(child => walk(child, false, null, null));
  return runs;
}

// Word-wraps a list of styled runs into lines of styled tokens, honoring
// explicit breaks, then draws each line with per-word bold/color/size and
// the box's own text-align. `baseFontSize` and `scale` are both in the same
// units as the run's own fontSize (virtual page px) — each token uses its
// own size if it has one, otherwise falls back to baseFontSize.
function drawRichText(ctx, runs, anchorX, startY, maxWidth, lineHeight, baseFontSize, fontFamily, defaultColor, align, scale) {
  const sizeOf = (tok) => Math.max(2, (tok.fontSize || baseFontSize) * scale);
  const font = (tok) => (tok.bold ? '700 ' : '400 ') + sizeOf(tok) + 'px ' + fontFamily;
  const lines = [[]];
  runs.forEach(run => {
    if (run.brk) { lines.push([]); return; }
    const words = run.text.split(/\s+/).filter(w => w.length > 0);
    words.forEach(word => lines[lines.length - 1].push({ word, bold: run.bold, color: run.color, fontSize: run.fontSize }));
  });

  const wrapped = [];
  lines.forEach(lineTokens => {
    let current = [];
    let curWidth = 0;
    lineTokens.forEach(tok => {
      ctx.font = font(tok);
      const spaceW = ctx.measureText(' ').width;
      const w = ctx.measureText(tok.word).width;
      const addW = w + (current.length ? spaceW : 0);
      if (curWidth + addW > maxWidth && current.length) {
        wrapped.push(current);
        current = [];
        curWidth = 0;
      }
      current.push(tok);
      ctx.font = font(tok);
      curWidth += ctx.measureText(tok.word).width + (current.length > 1 ? spaceW : 0);
    });
    wrapped.push(current);
  });

  wrapped.forEach((line, i) => {
    let totalW = 0;
    line.forEach((tok, idx) => {
      ctx.font = font(tok);
      const spaceW = ctx.measureText(' ').width;
      totalW += ctx.measureText(tok.word).width + (idx > 0 ? spaceW : 0);
    });
    let startX;
    if (align === 'center') startX = anchorX - totalW / 2;
    else if (align === 'right') startX = anchorX - totalW;
    else startX = anchorX;

    // Line vertical position accumulates using each prior line's own tallest
    // token, so a line with a bigger token gets proportionally more room.
    const y = startY + i * lineHeight;
    let curX = startX;
    line.forEach(tok => {
      ctx.font = font(tok);
      const spaceW = ctx.measureText(' ').width;
      ctx.fillStyle = tok.color || defaultColor;
      ctx.textAlign = 'left';
      ctx.fillText(tok.word, curX, y);
      curX += ctx.measureText(tok.word).width + spaceW;
    });
  });
}

function drawTextItem(ctx, item, x, y, w, h, scale) {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(item.rot * Math.PI / 180);

  if (item.bgColor) {
    ctx.fillStyle = item.bgColor;
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  drawItemBorder(ctx, item, w, h, scale);

  const fontSize = Math.max(4, item.fontSize * scale);
  const fontFamily = TEXT_FONTS[item.fontFamily] || TEXT_FONTS.sans;
  const align = item.align || 'left';
  const pad = 4 * scale;
  const anchorX = align === 'left' ? -w / 2 + pad : align === 'right' ? w / 2 - pad : 0;
  ctx.textBaseline = 'top';

  if (item.html) {
    const runs = extractTextRuns(item.html);
    drawRichText(ctx, runs, anchorX, -h / 2 + pad, w - pad * 2, fontSize * 1.25, item.fontSize, fontFamily, item.color || '#1a1a1a', align, scale);
  } else {
    ctx.font = (item.bold ? '700 ' : '400 ') + fontSize + 'px ' + fontFamily;
    ctx.fillStyle = item.color || '#1a1a1a';
    ctx.textAlign = align;
    drawWrappedText(ctx, item.text || '', anchorX, -h / 2 + pad, w - pad * 2, fontSize * 1.25);
  }
  ctx.restore();
}

function drawItemBorder(ctx, item, w, h, scale) {
  if (!item.borderStyle || item.borderStyle === 'none') return;
  const bw = Math.max(1, (item.borderWidth || 2) * scale);
  ctx.save();
  ctx.strokeStyle = item.borderColor || '#1a1a1a';
  ctx.lineWidth = bw;
  ctx.setLineDash(item.borderStyle === 'dashed' ? [bw * 3, bw * 2] : []);
  ctx.strokeRect(-w / 2 + bw / 2, -h / 2 + bw / 2, w - bw, h - bw);
  ctx.setLineDash([]);
  ctx.restore();
}

// Canvas equivalent of roundedPathD — traces the same gently-rounded corners
// so the exported image matches what's shown on screen.
function drawRoundedPathCanvas(ctx, pts, radius) {
  ctx.beginPath();
  if (pts.length < 2) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length < 3) {
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1], cur = pts[i], next = pts[i + 1];
    const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const d2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    if (d1 < 0.01 || d2 < 0.01) { ctx.lineTo(cur.x, cur.y); continue; }
    const r = Math.min(radius, d1 / 2, d2 / 2);
    const a = { x: cur.x + (prev.x - cur.x) / d1 * r, y: cur.y + (prev.y - cur.y) / d1 * r };
    const b = { x: cur.x + (next.x - cur.x) / d2 * r, y: cur.y + (next.y - cur.y) / d2 * r };
    ctx.lineTo(a.x, a.y);
    ctx.quadraticCurveTo(cur.x, cur.y, b.x, b.y);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
}

function drawArrowCanvas(ctx, fromX, fromY, toX, toY, strokeWidth, color) {
  const a = arrowHeadPoints(fromX, fromY, toX, toY, strokeWidth);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(a.tip.x, a.tip.y);
  ctx.lineTo(a.b1.x, a.b1.y);
  ctx.lineTo(a.b2.x, a.b2.y);
  ctx.closePath();
  ctx.fill();
}

function drawLineItem(ctx, item, x, y, w, h, scale) {
  const { p1, p2 } = lineEndpoints(item);
  const P1 = { x: x + p1.x * scale, y: y + p1.y * scale };
  const P2 = { x: x + p2.x * scale, y: y + p2.y * scale };
  const sw = Math.max(1, item.strokeWidth * scale);

  ctx.save();
  ctx.strokeStyle = item.color;
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';
  ctx.setLineDash(item.dashed ? [sw * 2.6, sw * 2.2] : []);
  ctx.beginPath();
  const visP1 = item.arrowStart ? pullBackForArrow(P2, P1, sw) : P1;
  const visP2 = item.arrow ? pullBackForArrow(P1, P2, sw) : P2;
  ctx.moveTo(visP1.x, visP1.y);
  ctx.lineTo(visP2.x, visP2.y);
  ctx.stroke();
  ctx.setLineDash([]);

  if (item.arrow) drawArrowCanvas(ctx, P1.x, P1.y, P2.x, P2.y, sw, item.color);
  if (item.arrowStart) drawArrowCanvas(ctx, P2.x, P2.y, P1.x, P1.y, sw, item.color);
  ctx.restore();
}
function drawFreehandItem(ctx, item, x, y, w, h, scale) {
  const sw = Math.max(1, item.strokeWidth * scale);
  ctx.save();
  ctx.strokeStyle = item.color;
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(item.dashed ? [sw * 2.6, sw * 2.2] : []);
  const actualPts = item.points.map(p => ({ x: x + p.x * item.w * scale, y: y + p.y * item.h * scale }));
  const drawPts = actualPts.slice();
  if (drawPts.length >= 2) {
    if (item.arrow) drawPts[drawPts.length - 1] = pullBackForArrow(drawPts[drawPts.length - 2], drawPts[drawPts.length - 1], sw);
    if (item.arrowStart) drawPts[0] = pullBackForArrow(drawPts[1], drawPts[0], sw);
  }
  const radius = Math.max(8 * scale, sw * 2.5);
  drawRoundedPathCanvas(ctx, drawPts, radius);
  ctx.stroke();
  ctx.setLineDash([]);

  if (actualPts.length >= 2) {
    if (item.arrow) {
      const from = actualPts[actualPts.length - 2], to = actualPts[actualPts.length - 1];
      drawArrowCanvas(ctx, from.x, from.y, to.x, to.y, sw, item.color);
    }
    if (item.arrowStart) {
      const from = actualPts[1], to = actualPts[0];
      drawArrowCanvas(ctx, from.x, from.y, to.x, to.y, sw, item.color);
    }
  }
  ctx.restore();
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
  const paragraphs = String(text).split('\n');
  let cy = y;
  paragraphs.forEach(paragraph => {
    const words = paragraph.split(' ');
    let line = '';
    for (let i = 0; i < words.length; i++) {
      const test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, cy);
        line = words[i];
        cy += lineHeight;
      } else {
        line = test;
      }
    }
    ctx.fillText(line, x, cy);
    cy += lineHeight;
  });
}

async function exportCollage() {
  const btn = document.getElementById('export-btn');
  const status = getStatusEl();
  status.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    syncPositionsFromDOM();
    const area = state.pageW * state.pageH;
    const scale = area > MAX_CANVAS_AREA ? Math.sqrt(MAX_CANVAS_AREA / area) : 1;
    if (scale < 1) {
      status.style.color = '#e0b97a';
      status.textContent = 'Board is large (' + Math.round(state.pageW) + '×' + Math.round(state.pageH) +
        'px) — exporting at ' + Math.round(scale * 100) + '% to stay within canvas limits.';
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(state.pageW * scale);
    canvas.height = Math.round(state.pageH * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = state.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const sorted = [...state.canvasItems].sort((a, b) => a.z - b.z);
    for (const item of sorted) {
      const x = item.x * scale, y = item.y * scale, w = item.w * scale, h = item.h * scale;

      if (item.type === 'text') {
        drawTextItem(ctx, item, x, y, w, h, scale);
        continue;
      }
      if (item.type === 'line') {
        drawLineItem(ctx, item, x, y, w, h, scale);
        continue;
      }
      if (item.type === 'freehand') {
        drawFreehandItem(ctx, item, x, y, w, h, scale);
        continue;
      }

      const bmp = await loadImageWithFallback(item.fileURL, item.thumbURL);
      ctx.save();
      ctx.beginPath();
      const cx = x + w / 2, cy = y + h / 2;
      ctx.translate(cx, cy);
      ctx.rotate(item.rot * Math.PI / 180);
      ctx.rect(-w / 2, -h / 2, w, h);
      ctx.clip();
      const srcRatio = bmp.width / bmp.height, dstRatio = w / h;
      let sx, sy, sw, sh, dx, dy, dw, dh;
      if (item.fitMode === 'contain') {
        // whole image visible, letterboxed inside the cell (page bg shows through)
        sx = 0; sy = 0; sw = bmp.width; sh = bmp.height;
        if (srcRatio > dstRatio) { dw = w; dh = w / srcRatio; }
        else { dh = h; dw = h * srcRatio; }
        dx = -dw / 2; dy = -dh / 2;
      } else {
        // cover-fit crop
        if (srcRatio > dstRatio) {
          sh = bmp.height; sw = sh * dstRatio;
          sx = (bmp.width - sw) / 2; sy = 0;
        } else {
          sw = bmp.width; sh = sw / dstRatio;
          sx = 0; sy = (bmp.height - sh) / 2;
        }
        dx = -w / 2; dy = -h / 2; dw = w; dh = h;
      }
      ctx.drawImage(bmp, sx, sy, sw, sh, dx, dy, dw, dh);
      ctx.restore();
      if (item.borderStyle && item.borderStyle !== 'none') {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(item.rot * Math.PI / 180);
        drawItemBorder(ctx, item, w, h, scale);
        ctx.restore();
      }
    }

    // PNG payloads scale up fast with pixel count; fall back to JPEG automatically
    // for big boards even if PNG was selected, to keep the base64 payload sane.
    const useJpeg = state.fmt === 'jpg' || canvas.width * canvas.height > 20 * 1000 * 1000;
    const mime = useJpeg ? 'image/jpeg' : 'image/png';
    const quality = useJpeg ? 0.9 : undefined;
    const dataUrl = canvas.toDataURL(mime, quality);

    const folderId = state.sourceFolderId || undefined;
    const name = 'Moodboard Collage ' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    await eagle.item.addFromBase64(dataUrl, {
      name: name,
      folders: folderId ? [folderId] : undefined
    });
    status.style.color = '#8fca7a';
    status.textContent = 'Saved to library.';
    btn.textContent = 'Saved \u2713';
    setTimeout(() => { btn.textContent = 'Export'; btn.disabled = false; }, 1500);
  } catch (err) {
    console.error(err);
    status.style.color = '#e0837f';
    status.textContent = 'Export failed: ' + (err && err.message ? err.message : String(err));
    btn.textContent = 'Error, try again';
    btn.disabled = false;
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function loadImageWithFallback(primarySrc, fallbackSrc) {
  try {
    return await loadImage(primarySrc);
  } catch (e) {
    if (fallbackSrc && fallbackSrc !== primarySrc) {
      return await loadImage(fallbackSrc);
    }
    throw e;
  }
}

window.addEventListener('resize', () => {
  if (!document.getElementById('canvas-view').classList.contains('hidden')) renderStage();
});
