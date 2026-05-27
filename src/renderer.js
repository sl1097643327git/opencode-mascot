(function rendererModule(globalScope) {
  const DEFAULT_WIDTH = 160;
  const MIN_WIDTH = 48;
  const MAX_WIDTH = 960;
  const WIDTH_STEP = 8;
  const DEFAULT_Z_INDEX = 1;
  const MIN_Z_INDEX = 1;
  const MAX_Z_INDEX = 999;
  const DEFAULT_FPS = 8;
  const failedAssetPaths = new Set();

  const STATUS_LABELS = Object.freeze({
    idle: '空闲中',
    working: '正在工作…',
    thinking: '正在思考…',
    typing: '正在回复…',
    tool: '正在执行工具',
    permission: '等待授权',
    busy: '忙碌中',
    resting: '休息中',
    done: '完成啦',
    error: '出错了'
  });

  function shouldShowStatus(character) {
    return character?.showStatus !== false;
  }

  function getStatusLabel(character) {
    return STATUS_LABELS[character?.status] || character?.status || '';
  }

  function buildCharacterAssetPath(character, status = character.status) {
    return `../assets/mascot/${character.theme}/${status}.webp`;
  }

  function resetFailedAssetPaths() {
    failedAssetPaths.clear();
  }

  function normalizeCoordinate(value) {
    return Number.isFinite(value) ? value : 0;
  }

  function normalizeWidth(value) {
    if (!Number.isFinite(value) || value <= 0) {
      return DEFAULT_WIDTH;
    }

    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
  }

  function normalizeZIndex(value) {
    if (!Number.isFinite(value)) {
      return DEFAULT_Z_INDEX;
    }

    return Math.min(MAX_Z_INDEX, Math.max(MIN_Z_INDEX, Math.round(value)));
  }

  function getElementSize(element, fallbackWidth = DEFAULT_WIDTH) {
    const width = Number.isFinite(element?.offsetWidth) && element.offsetWidth > 0
      ? element.offsetWidth
      : fallbackWidth;
    const height = Number.isFinite(element?.offsetHeight) && element.offsetHeight > 0
      ? element.offsetHeight
      : width;

    return { width, height };
  }

  function getVisualWidth(section) {
    const visualWidth = Number.parseFloat(section?.visualNode?.style?.width);
    return Number.isFinite(visualWidth) && visualWidth > 0 ? visualWidth : DEFAULT_WIDTH;
  }

  function getCharacterClampSize(section) {
    return getElementSize(section, getVisualWidth(section));
  }

  function getStageSize(stage) {
    const width = Number.isFinite(stage?.clientWidth) && stage.clientWidth > 0
      ? stage.clientWidth
      : Number.POSITIVE_INFINITY;
    const height = Number.isFinite(stage?.clientHeight) && stage.clientHeight > 0
      ? stage.clientHeight
      : Number.POSITIVE_INFINITY;

    return { width, height };
  }

  function clampCharacterPosition(stage, section, x, y) {
    const normalizedX = normalizeCoordinate(x);
    const normalizedY = normalizeCoordinate(y);
    const stageSize = getStageSize(stage);
    const elementSize = getCharacterClampSize(section);
    const maxX = Number.isFinite(stageSize.width) ? Math.max(0, stageSize.width - elementSize.width) : normalizedX;
    const maxY = Number.isFinite(stageSize.height) ? Math.max(0, stageSize.height - elementSize.height) : normalizedY;

    return {
      x: Math.min(maxX, Math.max(0, normalizedX)),
      y: Math.min(maxY, Math.max(0, normalizedY))
    };
  }

  function getCharacterNodeMap(stage) {
    if (!stage.characterNodes) {
      stage.characterNodes = new Map();
    }

    return stage.characterNodes;
  }

  function stopFramePlayer(player) {
    if (typeof player === 'function') {
      player();
    }
  }

  function startFramePlayer({ imageNode, frames, timers = globalScope, fps = DEFAULT_FPS }) {
    if (!imageNode || !Array.isArray(frames) || frames.length <= 1) {
      return () => {};
    }

    const frameDelay = Math.max(1, Math.round(1000 / fps));
    let frameIndex = 0;
    let active = true;
    imageNode.src = frames[0];

    const intervalId = timers.setInterval(() => {
      if (!active) {
        return;
      }

      frameIndex = (frameIndex + 1) % frames.length;
      imageNode.src = frames[frameIndex];
    }, frameDelay);

    return () => {
      if (!active) {
        return;
      }

      active = false;
      timers.clearInterval(intervalId);
    };
  }

  function clearCharacterNode(section) {
    section.renderToken = (section.renderToken || 0) + 1;
    stopFramePlayer(section.framePlayerStop);
    section.framePlayerStop = null;
    section.frameSignature = null;
    section.frameStatus = null;
    section.currentAssetPath = null;
    section.usingFallback = false;
  }

  function clearStage(stage) {
    const nodeMap = getCharacterNodeMap(stage);

    for (const section of nodeMap.values()) {
      clearCharacterNode(section);
    }

    stage.replaceChildren();
    nodeMap.clear();
  }

  function releaseStageMouseInteraction(stage, options = {}) {
    const nodeMap = getCharacterNodeMap(stage);
    let shouldRelease = false;
    const closeMenus = options.closeMenus !== false;

    for (const section of nodeMap.values()) {
      if (section.dragState?.active) {
        continue;
      }

      if (!closeMenus && section.menuKeepsMouseInteraction) {
        continue;
      }

      if (section.pointerInside || (closeMenus && section.menuKeepsMouseInteraction)) {
        shouldRelease = true;
      }

      section.pointerInside = false;

      if (closeMenus) {
        closeCharacterMenu(section, { restoreMouseInteraction: false });
      }
    }

    if (shouldRelease) {
      notifyMouseInteraction(options.mascotApi, false, options.consoleRef);
    }
  }

  function attachStageReleaseHandlers(stage, options) {
    if (stage.releaseHandlersAttached) {
      stage.releaseOptions = options;
      return;
    }

    stage.releaseOptions = options;
    const releaseIfBackground = (event, { closeMenus }) => {
      if (event.target !== stage) {
        return;
      }

      releaseStageMouseInteraction(stage, {
        ...stage.releaseOptions,
        closeMenus
      });
    };

    stage.addEventListener('pointermove', (event) => releaseIfBackground(event, { closeMenus: false }));
    stage.addEventListener('pointerdown', (event) => releaseIfBackground(event, { closeMenus: true }));
    stage.releaseHandlersAttached = true;
  }

  function visibleIndex(stage, characterId, characters) {
    let index = 0;

    for (const character of characters) {
      if (!character.visible) {
        continue;
      }

      if (character.id === characterId) {
        return index;
      }

      index += 1;
    }

    return stage.children.length;
  }

  function moveNodeToIndex(stage, section, targetIndex) {
    const currentIndex = Array.from(stage.children).indexOf(section);

    if (currentIndex === -1 || currentIndex === targetIndex) {
      return;
    }

    stage.removeChild(section);

    if (targetIndex >= stage.children.length) {
      stage.appendChild(section);
      return;
    }

    stage.insertBefore(section, stage.children[targetIndex]);
  }

  function createFallbackNode(documentRef, character) {
    const fallback = documentRef.createElement('div');
    fallback.className = 'mascot-character__fallback';
    fallback.setAttribute('aria-hidden', 'true');
    fallback.textContent = character.name.slice(0, 1) || '?';
    return fallback;
  }

  function renderFrameFallback(section, character) {
    clearCharacterNode(section);
    const fallback = createFallbackNode(section.visualNode.ownerDocument, character);
    section.usingFallback = true;
    section.visualNode.replaceChildren(fallback);
  }

  function createFrameImage(documentRef, framePath, onError) {
    const image = documentRef.createElement('img');
    image.className = 'mascot-character__image';
    image.alt = '';
    image.src = framePath;
    image.addEventListener('error', onError, { once: true });
    return image;
  }

  function createCharacterNode(documentRef, character) {
    const section = documentRef.createElement('section');
    section.className = 'mascot-character';
    section.dataset.characterId = character.id;

    const visual = documentRef.createElement('div');
    visual.className = 'mascot-character__visual';

    const label = documentRef.createElement('div');
    label.className = 'mascot-character__label';

    const nameText = documentRef.createElement('span');
    nameText.className = 'mascot-character__name';

    const statusText = documentRef.createElement('span');
    statusText.className = 'mascot-character__status';

    section.visualNode = visual;
    section.labelNode = label;
    section.nameNode = nameText;
    section.statusNode = statusText;
    section.currentAssetPath = null;
    section.framePlayerStop = null;
    section.frameSignature = null;
    section.frameStatus = null;
    section.usingFallback = false;
    section.renderToken = 0;
    section.dragState = {
      characterId: character.id,
      pointerId: null,
      startClientX: 0,
      startClientY: 0,
      startX: normalizeCoordinate(character.x),
      startY: normalizeCoordinate(character.y),
      currentX: normalizeCoordinate(character.x),
      currentY: normalizeCoordinate(character.y),
      active: false
    };
    section.dragHandlersAttached = false;
    section.dragOptions = null;
    section.pointerInside = false;

    label.append(nameText, statusText);
    section.append(visual, label);
    return section;
  }

  function updateCharacterLayout(section, character) {
    const normalizedX = normalizeCoordinate(character.x);
    const normalizedY = normalizeCoordinate(character.y);
    const normalizedWidth = normalizeWidth(character.width);
    const normalizedZIndex = normalizeZIndex(character.zIndex);

    section.dataset.characterId = character.id;
    section.style.left = `${normalizedX}px`;
    section.style.top = `${normalizedY}px`;
    section.style.width = `${normalizedWidth}px`;
    section.visualNode.style.width = `${normalizedWidth}px`;
    section.labelNode.style.width = `${normalizedWidth}px`;
    section.style.zIndex = String(normalizedZIndex);
    section.nameNode.textContent = character.name;
    section.statusNode.textContent = getStatusLabel(character);
    section.statusNode.hidden = !shouldShowStatus(character);
  }

  function applyCharacterPreview(section, patch) {
    const nextCharacter = {
      ...(section.currentCharacter || {}),
      ...patch
    };

    section.currentCharacter = nextCharacter;
    updateCharacterLayout(section, nextCharacter);
  }

  function positionMenuNearCharacter(section, menu) {
    const left = normalizeCoordinate(section.currentCharacter?.x) + normalizeWidth(section.currentCharacter?.width) + 8;
    const top = normalizeCoordinate(section.currentCharacter?.y);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function clampPreviewIntoStage(section) {
    if (!section.menuNode) {
      return null;
    }

    const position = clampCharacterPosition(
      section.parentElement,
      section,
      normalizeCoordinate(section.currentCharacter?.x),
      normalizeCoordinate(section.currentCharacter?.y)
    );

    applyCharacterPreview(section, {
      x: position.x,
      y: position.y
    });

    return position;
  }

  function setDragPosition(section, x, y) {
    const position = clampCharacterPosition(section.parentElement, section, x, y);

    section.style.left = `${position.x}px`;
    section.style.top = `${position.y}px`;

    return position;
  }

  function isDescendantOf(node, ancestor) {
    let currentNode = node;

    while (currentNode) {
      if (currentNode === ancestor) {
        return true;
      }

      currentNode = currentNode.parentElement || currentNode.parentNode;
    }

    return false;
  }

  function syncDragState(section, character) {
    section.dragState ??= {
      characterId: character.id,
      pointerId: null,
      startClientX: 0,
      startClientY: 0,
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      active: false
    };

    section.dragState.characterId = character.id;

    if (section.dragState.active) {
      return;
    }

    const normalizedX = normalizeCoordinate(character.x);
    const normalizedY = normalizeCoordinate(character.y);
    section.dragState.startX = normalizedX;
    section.dragState.startY = normalizedY;
    section.dragState.currentX = normalizedX;
    section.dragState.currentY = normalizedY;
  }

  function closeCharacterMenu(section, { restoreMouseInteraction = true } = {}) {
    if (section.menuNode) {
      section.menuNode.remove();
      section.menuNode = null;
    }

    if (
      section.menuKeepsMouseInteraction &&
      restoreMouseInteraction &&
      !section.dragState?.active &&
      !section.pointerInside
    ) {
      notifyMouseInteraction(section.dragOptions?.mascotApi, false, section.dragOptions?.consoleRef);
    }

    section.menuKeepsMouseInteraction = false;
    section.classList?.remove('has-menu');
  }

  function createMenuOption(documentRef, value, selectedValue) {
    const option = documentRef.createElement('option');
    option.value = value;
    option.textContent = value;
    option.selected = value === selectedValue;
    return option;
  }

  async function openCharacterMenu(section, character, { mascotApi, consoleRef }) {
    if (!mascotApi || typeof mascotApi.updateCharacter !== 'function') {
      return;
    }

    closeCharacterMenu(section, { restoreMouseInteraction: false });
    notifyMouseInteraction(mascotApi, true, consoleRef);
    section.menuKeepsMouseInteraction = true;

    const documentRef = section.ownerDocument;
    const menu = documentRef.createElement('div');
    menu.className = 'mascot-character__menu';
    positionMenuNearCharacter(section, menu);

    const title = documentRef.createElement('div');
    title.className = 'mascot-character__menu-title';
    title.textContent = character.id;

    const integrationDetail = documentRef.createElement('div');
    integrationDetail.className = 'mascot-character__menu-detail';
    integrationDetail.textContent = character.integrationDetail || '接入详情：本地看板娘';

    const nameLabel = documentRef.createElement('label');
    nameLabel.textContent = '名称';
    const nameInput = documentRef.createElement('input');
    nameInput.value = character.name;
    nameLabel.appendChild(nameInput);

    const themeLabel = documentRef.createElement('label');
    themeLabel.textContent = '形象';
    const themeSelect = documentRef.createElement('select');
    let themes = [character.theme];

    if (typeof mascotApi.getThemes === 'function') {
      try {
        const themeResult = await mascotApi.getThemes();
        if (themeResult?.ok && Array.isArray(themeResult.themes) && themeResult.themes.length) {
          themes = themeResult.themes;
        }
      } catch (error) {
        consoleRef.warn(`Mascot renderer failed to load themes for ${character.id}:`, error);
      }
    }

    const selectedTheme = themes.includes(character.theme) ? character.theme : themes[0];
    themeSelect.replaceChildren(...themes.map((theme) => createMenuOption(documentRef, theme, selectedTheme)));
    themeSelect.value = selectedTheme;
    themeLabel.appendChild(themeSelect);

    const statusLabel = documentRef.createElement('label');
    statusLabel.textContent = '动作';
    const statusSelect = documentRef.createElement('select');
    const statuses = ['idle', 'working', 'thinking', 'typing', 'tool', 'permission', 'busy', 'resting', 'done', 'error'];
    statusSelect.replaceChildren(...statuses.map((status) => createMenuOption(documentRef, status, character.status)));
    statusSelect.value = character.status;
    statusLabel.appendChild(statusSelect);

    const showStatusLabel = documentRef.createElement('label');
    showStatusLabel.textContent = '显示状态';
    const showStatusSelect = documentRef.createElement('select');
    showStatusSelect.replaceChildren(
      createMenuOption(documentRef, 'true', String(shouldShowStatus(character))),
      createMenuOption(documentRef, 'false', String(shouldShowStatus(character)))
    );
    showStatusSelect.value = String(shouldShowStatus(character));
    showStatusLabel.appendChild(showStatusSelect);

    const sizeLabel = documentRef.createElement('label');
    sizeLabel.textContent = '大小';
    const sizeInput = documentRef.createElement('input');
    sizeInput.type = 'range';
    sizeInput.min = String(MIN_WIDTH);
    sizeInput.max = String(MAX_WIDTH);
    sizeInput.step = String(WIDTH_STEP);
    sizeInput.value = String(normalizeWidth(character.width));
    sizeLabel.appendChild(sizeInput);

    const deleteButton = documentRef.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'is-danger';
    deleteButton.textContent = '删除';

    const buildPatch = () => ({
        name: nameInput.value,
        theme: themeSelect.value,
        status: statusSelect.value,
        showStatus: showStatusSelect.value === 'true',
        width: normalizeWidth(Number.parseFloat(sizeInput.value))
      });

    const saveWithPreview = async () => {
      const patch = buildPatch();
      applyCharacterPreview(section, patch);
      await mascotApi.updateCharacter(character.id, patch);
    };

    const saveSize = async () => {
      const patch = buildPatch();
      applyCharacterPreview(section, patch);
      const position = clampPreviewIntoStage(section);
      await mascotApi.updateCharacter(character.id, patch);

      if (position && typeof mascotApi.updateCharacterPosition === 'function') {
        await mascotApi.updateCharacterPosition(character.id, position);
      }
    };

    statusSelect.addEventListener('change', () => {
      saveWithPreview().catch((error) => consoleRef.warn(`Mascot renderer failed to update ${character.id}:`, error));
    });
    showStatusSelect.addEventListener('change', () => {
      saveWithPreview().catch((error) => consoleRef.warn(`Mascot renderer failed to update ${character.id}:`, error));
    });
    themeSelect.addEventListener('change', () => {
      saveWithPreview().catch((error) => consoleRef.warn(`Mascot renderer failed to update ${character.id}:`, error));
    });
    nameInput.addEventListener('blur', () => {
      saveWithPreview().catch((error) => consoleRef.warn(`Mascot renderer failed to update ${character.id}:`, error));
    });
    sizeInput.addEventListener('input', () => {
      saveWithPreview().catch((error) => consoleRef.warn(`Mascot renderer failed to update ${character.id}:`, error));
    });
    sizeInput.addEventListener('change', () => {
      saveSize().catch((error) => consoleRef.warn(`Mascot renderer failed to resize ${character.id}:`, error));
    });
    deleteButton.addEventListener('click', () => {
      if (typeof mascotApi.deleteCharacter !== 'function') {
        return;
      }

      closeCharacterMenu(section);
      Promise.resolve(mascotApi.deleteCharacter(character.id)).catch((error) => {
        consoleRef.warn(`Mascot renderer failed to delete ${character.id}:`, error);
      });
    });

    menu.append(title, integrationDetail, nameLabel, themeLabel, statusLabel, showStatusLabel, sizeLabel, deleteButton);
    section.appendChild(menu);
    section.menuNode = menu;
    section.classList?.add('has-menu');
  }

  function finishDrag(section, { mascotApi, consoleRef }, persist) {
    const dragState = section.dragState;

    if (!dragState?.active) {
      return;
    }

    dragState.active = false;
    section.classList?.remove('is-dragging');

    if (!section.pointerInside && !section.menuKeepsMouseInteraction) {
      notifyMouseInteraction(mascotApi, false, consoleRef);
    }

    if (dragState.pointerId !== null && typeof section.releasePointerCapture === 'function') {
      section.releasePointerCapture(dragState.pointerId);
    }

    const position = clampCharacterPosition(section.parentElement, section, dragState.currentX, dragState.currentY);

    dragState.pointerId = null;
    dragState.startX = position.x;
    dragState.startY = position.y;

    if (!persist || !mascotApi || typeof mascotApi.updateCharacterPosition !== 'function') {
      return;
    }

    Promise.resolve(mascotApi.updateCharacterPosition(dragState.characterId, position)).catch((error) => {
      consoleRef.warn(`Mascot renderer failed to persist dragged position for ${dragState.characterId}:`, error);
    });
  }

  function attachDragHandlers(section, options) {
    if (section.dragHandlersAttached) {
      section.dragOptions = options;
      return;
    }

    section.dragOptions = options;
    section.addEventListener('pointerenter', () => {
      section.pointerInside = true;
      notifyMouseInteraction(section.dragOptions?.mascotApi, true, section.dragOptions?.consoleRef);
    });

    section.addEventListener('pointerleave', () => {
      section.pointerInside = false;
      if (!section.dragState?.active && !section.menuKeepsMouseInteraction) {
        notifyMouseInteraction(section.dragOptions?.mascotApi, false, section.dragOptions?.consoleRef);
      }
    });

    section.addEventListener('pointerdown', (event) => {
      if (Number.isFinite(event.button) && event.button !== 0) {
        return;
      }

      if (section.menuNode && event.target && event.target !== section && isDescendantOf(event.target, section.menuNode)) {
        return;
      }

      if (section.menuNode) {
        closeCharacterMenu(section);
        return;
      }

      const dragState = section.dragState;

      if (!dragState) {
        return;
      }

      dragState.active = true;
      dragState.pointerId = event.pointerId;
      dragState.startClientX = normalizeCoordinate(event.clientX);
      dragState.startClientY = normalizeCoordinate(event.clientY);
      dragState.currentX = dragState.startX;
      dragState.currentY = dragState.startY;
      section.classList?.add('is-dragging');
      notifyMouseInteraction(options.mascotApi, true, options.consoleRef);
      event.preventDefault?.();

      if (typeof section.setPointerCapture === 'function' && event.pointerId !== undefined) {
        section.setPointerCapture(event.pointerId);
      }
    });

    section.addEventListener('pointermove', (event) => {
      const dragState = section.dragState;

      if (!dragState?.active || dragState.pointerId !== event.pointerId) {
        return;
      }

      const nextX = dragState.startX + (normalizeCoordinate(event.clientX) - dragState.startClientX);
      const nextY = dragState.startY + (normalizeCoordinate(event.clientY) - dragState.startClientY);

      if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) {
        return;
      }

      const position = setDragPosition(section, nextX, nextY);
      dragState.currentX = position.x;
      dragState.currentY = position.y;
    });

    section.addEventListener('pointerup', (event) => {
      const dragState = section.dragState;

      if (!dragState?.active || dragState.pointerId !== event.pointerId) {
        return;
      }

      finishDrag(section, section.dragOptions, true);
    });

    section.addEventListener('pointercancel', (event) => {
      const dragState = section.dragState;

      if (!dragState?.active || dragState.pointerId !== event.pointerId) {
        return;
      }

      finishDrag(section, section.dragOptions, false);
    });

    section.addEventListener('contextmenu', (event) => {
      event.preventDefault?.();
      openCharacterMenu(section, section.currentCharacter, section.dragOptions).catch((error) => {
        section.dragOptions?.consoleRef?.warn('Mascot renderer failed to open character menu:', error);
      });
    });

    section.addEventListener('dblclick', (event) => {
      event.preventDefault?.();
      openCharacterMenu(section, section.currentCharacter, section.dragOptions).catch((error) => {
        section.dragOptions?.consoleRef?.warn('Mascot renderer failed to open character menu:', error);
      });
    });

    section.dragHandlersAttached = true;
  }

  function notifyMouseInteraction(mascotApi, interactive, consoleRef = console) {
    if (!mascotApi || typeof mascotApi.setMouseInteraction !== 'function') {
      return;
    }

    Promise.resolve(mascotApi.setMouseInteraction(interactive)).catch((error) => {
      consoleRef.warn('Mascot renderer failed to update mouse interaction mode:', error);
    });
  }

  async function loadCharacterFrames(character, mascotApi) {
    if (!mascotApi || typeof mascotApi.getFrames !== 'function') {
      return [];
    }

    const result = await mascotApi.getFrames(character.id, character.status);

    if (!result || result.ok === false || !Array.isArray(result.frames)) {
      return [];
    }

    return result.frames.filter((framePath) => typeof framePath === 'string' && framePath.length > 0);
  }

  function buildFrameSignature(character, frames) {
    return `${character.status}::${frames.join('|')}`;
  }

  function renderFrames(section, character, frames, { timers = globalScope } = {}) {
    const frameSignature = buildFrameSignature(character, frames);

    if (section.frameSignature === frameSignature && !section.usingFallback) {
      return;
    }

    clearCharacterNode(section);

    const image = createFrameImage(section.visualNode.ownerDocument, frames[0], () => {
      failedAssetPaths.add(image.src);
      renderFrameFallback(section, character);
    });

    section.visualNode.replaceChildren(image);
    section.currentAssetPath = frames[0];
    section.frameSignature = frameSignature;
    section.frameStatus = character.status;
    section.usingFallback = false;
    section.framePlayerStop = startFramePlayer({
      imageNode: image,
      frames,
      timers,
      fps: DEFAULT_FPS
    });
  }

  async function updateCharacterNode(section, character, options = {}) {
    const { mascotApi, timers = globalScope, console: consoleRef = globalScope.console } = options;
    section.currentCharacter = character;
    syncDragState(section, character);
    attachDragHandlers(section, { mascotApi, consoleRef });
    updateCharacterLayout(section, character);

    const renderToken = (section.renderToken || 0) + 1;
    section.renderToken = renderToken;
    let frames;

    try {
      frames = await loadCharacterFrames(character, mascotApi);
    } catch (error) {
      if (section.renderToken !== renderToken) {
        return;
      }

      consoleRef.warn(`Mascot renderer failed to load frames for ${character.id}:`, error);
      renderFrameFallback(section, character);
      return;
    }

    if (section.renderToken !== renderToken) {
      return;
    }

    if (!frames.length) {
      renderFrameFallback(section, character);
      return;
    }

    renderFrames(section, character, frames, { timers });
  }

  function renderState(stage, state, options = {}) {
    const nodeMap = getCharacterNodeMap(stage);
    const nextVisibleIds = new Set();
    attachStageReleaseHandlers(stage, {
      mascotApi: options.mascotApi,
      consoleRef: options.console || options.consoleRef || globalScope.console
    });

    if (!state || !Array.isArray(state.characters)) {
      clearStage(stage);
      return Promise.resolve();
    }

    const updates = [];

    for (const character of state.characters) {
      if (!character.visible) {
        continue;
      }

      nextVisibleIds.add(character.id);
      let section = nodeMap.get(character.id);

      if (!section) {
        section = createCharacterNode(stage.ownerDocument, character);
        nodeMap.set(character.id, section);
        stage.appendChild(section);
      }

      updates.push(updateCharacterNode(section, character, options));
      moveNodeToIndex(stage, section, visibleIndex(stage, character.id, state.characters));
    }

    for (const [characterId, section] of nodeMap.entries()) {
      if (nextVisibleIds.has(characterId)) {
        continue;
      }

      clearCharacterNode(section);
      section.remove();
      nodeMap.delete(characterId);
    }

    return Promise.all(updates).then(() => undefined);
  }

  async function initRenderer(windowRef = globalScope.window, consoleRef = globalScope.console) {
    if (!windowRef?.document) {
      return;
    }

    const stage = windowRef.document.getElementById('mascot-stage');

    if (!stage) {
      return;
    }

    if (
      !windowRef.mascotApi ||
      typeof windowRef.mascotApi.getInitialState !== 'function' ||
      typeof windowRef.mascotApi.onStateChange !== 'function' ||
      typeof windowRef.mascotApi.getFrames !== 'function'
    ) {
      clearStage(stage);
      consoleRef.error('Mascot renderer could not start: window.mascotApi.getInitialState/onStateChange/getFrames is unavailable.');
      return;
    }

    const initialState = await windowRef.mascotApi.getInitialState();
    windowRef.mascotApi.onStateChange((state) => {
      renderState(stage, state, { mascotApi: windowRef.mascotApi, timers: windowRef, console: consoleRef }).catch((error) => {
        consoleRef.error('Mascot renderer failed to render state update:', error);
      });
    });
    await renderState(stage, initialState, { mascotApi: windowRef.mascotApi, timers: windowRef, console: consoleRef });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      DEFAULT_FPS,
      buildCharacterAssetPath,
      clearStage,
      initRenderer,
      normalizeCoordinate,
      WIDTH_STEP,
      clampCharacterPosition,
      normalizeWidth,
      normalizeZIndex,
      renderFrameFallback,
      renderState,
      resetFailedAssetPaths,
      startFramePlayer,
      stopFramePlayer
    };
    return;
  }

  initRenderer(globalScope.window, globalScope.console).catch((error) => {
    globalScope.console.error('Mascot renderer failed during initialization:', error);
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
