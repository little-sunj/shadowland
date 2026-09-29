// ==========================================================================
// 황량계(荒涼界) 인터랙티브 지도 — 이동/확대, 구역·거점 선택, 족자 패널, 주야간
// ==========================================================================

const SVG_NS = 'http://www.w3.org/2000/svg';

// innerHTML 로 넣는 데이터 문자열의 특수문자를 무력화합니다
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (val !== undefined && val !== null) el.setAttribute(key, val);
  }
  return el;
}

class FantasyMap {
  constructor(data) {
    this.data = data;

    this.viewport = document.getElementById('map-viewport');
    this.container = document.getElementById('map-container');
    this.tooltip = document.getElementById('map-tooltip');
    this.infoPanel = document.getElementById('info-panel');
    this.panelContent = document.getElementById('panel-content');
    this.mainScreen = document.getElementById('main-screen');
    this.dayNightBtn = document.getElementById('btn-daynight');
    this.nightBanner = document.querySelector('.night-warning-banner');
    this.zoomInBtn = document.getElementById('btn-zoom-in');
    this.zoomOutBtn = document.getElementById('btn-zoom-out');

    // 지도 기준 해상도 (SVG viewBox: 1400 x 1400)
    this.mapWidth = 1400;
    this.mapHeight = 1400;
    this.panMargin = 150;       // 지도를 화면 밖으로 끌어낼 수 있는 여유(px)

    // 변환 상태
    this.scale = 1;
    this.minScale = 0.4;
    this.maxScale = 3;
    this.translateX = 0;
    this.translateY = 0;
    this.isFitted = true;       // 사용자가 아직 시점을 바꾸지 않았는지 (리사이즈 시 재맞춤 여부)

    // 포인터(마우스·터치·펜) 상태
    this.pointers = new Map();
    this.gesture = null;
    this.suppressClick = false;
    this.dragThreshold = 6;

    this.animId = null;
    this.isNight = false;
    this.selection = null;       // { regionId, landmark }
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.canHover = window.matchMedia('(hover: hover)');   // 터치 기기에서는 호버 툴팁 생략

    this.buildMap();
    this.fitToScreen();
    this.bindPointerEvents();
    this.bindWheel();
    this.bindKeyboard();
    this.bindControls();
    window.addEventListener('resize', () => this.handleResize());
  }

  // ------------------------------------------------------------------
  // 지도 요소 생성 (js/data.js → SVG)
  // ------------------------------------------------------------------
  buildMap() {
    const regionsLayer = document.getElementById('regions-layer');
    const labelsLayer = document.getElementById('labels-layer');
    const markersLayer = document.getElementById('markers-layer');

    Object.values(this.data.regions).forEach((region) => {
      if (region.polygon) {
        const polygon = svgEl('polygon', {
          class: 'region-polygon',
          points: region.polygon,
          'data-region': region.id,
          tabindex: 0,
          role: 'button',
          'aria-label': `${region.name}(${region.hanja}) · ${region.direction} — 족자 열기`,
          style: `--region-color: ${region.color}`
        });
        this.bindSelectable(polygon, {
          tooltip: `${region.name} (${region.hanja}) · [${region.direction}]`,
          activate: () => this.selectRegion(region.id, { pan: true })
        });
        regionsLayer.appendChild(polygon);
      }

      if (region.label) {
        const { x, y, size } = region.label;
        const title = svgEl('text', {
          x, y, class: 'map-text region-label', 'text-anchor': 'middle', 'font-size': size
        });
        title.textContent = region.name.split('').join(' ');
        const subtitle = svgEl('text', {
          x, y: y + (size >= 24 ? 25 : 23), class: 'map-text region-sublabel', 'text-anchor': 'middle'
        });
        subtitle.textContent = region.hanja;
        labelsLayer.append(title, subtitle);
      }
    });

    this.data.landmarks.forEach((lm) => {
      if (lm.anchor === 'monster') {
        // 별도 핀 없이 야간 괴수 실루엣에 연결
        const monster = document.getElementById('monster-group');
        if (monster) {
          monster.setAttribute('role', 'button');
          monster.setAttribute('aria-label', `${lm.name}(${lm.hanja}) — 족자 열기`);
          this.bindSelectable(monster, {
            tooltip: `◈ ${lm.name} (${lm.hanja}) - ${lm.type}`,
            activate: () => this.selectLandmark(lm)
          });
        }
        return;
      }
      if (lm.pin) markersLayer.appendChild(this.createMarker(lm));
    });
  }

  createMarker(lm) {
    const { shape, r, fill, stroke, icon } = lm.pin;
    const isVillage = shape === 'village';

    const g = svgEl('g', {
      class: 'map-marker',
      'data-landmark': lm.id,
      transform: `translate(${lm.x}, ${lm.y})`,
      tabindex: 0,
      role: 'button',
      'aria-label': `${lm.name}(${lm.hanja}) · ${lm.type} — 족자 열기`
    });

    g.appendChild(svgEl('circle', { class: 'marker-hitbox', r: r + 15 }));

    const pin = svgEl('g', { class: 'marker-pin' });
    pin.appendChild(svgEl('circle', {
      r, fill, stroke, 'stroke-width': isVillage ? 1.8 : 2,
      filter: isVillage ? null : 'url(#marker-glow)'
    }));

    const icons = {
      peak: () => svgEl('polygon', { points: '0,-7 -6,4 6,4', fill: icon }),
      keep: () => svgEl('rect', { x: -5, y: -5, width: 10, height: 10, fill: icon }),
      palace: () => svgEl('polygon', { points: '0,-7 7,0 0,7 -7,0', fill: icon }),
      serpent: () => svgEl('path', { d: 'M -4,-4 Q 4,-1 -4,2 Q 4,5 0,6', stroke: icon, 'stroke-width': 2, fill: 'none' }),
      village: () => svgEl('circle', { r: 3.5, fill: icon })
    };
    if (icons[shape]) pin.appendChild(icons[shape]());
    g.appendChild(pin);

    const label = svgEl('text', {
      y: r + 11,
      class: `map-text marker-label${isVillage ? ' is-small' : ''}`,
      'text-anchor': 'middle'
    });
    label.textContent = lm.shortName || lm.name;
    g.appendChild(label);

    this.bindSelectable(g, {
      tooltip: `◈ ${lm.name} (${lm.hanja}) - ${lm.type}`,
      activate: () => this.selectLandmark(lm)
    });
    return g;
  }

  // 마우스 호버 / 키보드 포커스 / 클릭 / Enter 를 한 번에 연결
  bindSelectable(el, { tooltip, activate }) {
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse' && this.canHover.matches) this.showTooltip(tooltip, e.clientX, e.clientY);
    });
    el.addEventListener('pointerleave', () => this.hideTooltip());

    // 키보드(Tab)로 포커스했을 때만: 화면 밖이면 그쪽으로 이동, 아니면 툴팁 표시
    el.addEventListener('focus', () => {
      if (!el.matches(':focus-visible')) return;
      const rect = el.getBoundingClientRect();
      const vr = this.viewport.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const inView = cx > vr.left + 40 && cx < vr.right - 40 && cy > vr.top + 80 && cy < vr.bottom - 40;
      if (inView) {
        this.showTooltip(tooltip, cx, cy);
      } else {
        const mapX = (cx - vr.left - this.translateX) / this.scale;
        const mapY = (cy - vr.top - this.translateY) / this.scale;
        this.panTo(mapX, mapY, this.scale);
      }
    });
    el.addEventListener('blur', () => this.hideTooltip());

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      activate();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        activate();
      }
    });
  }

  // ------------------------------------------------------------------
  // 시점(변환) 계산
  // ------------------------------------------------------------------
  viewportSize() {
    return {
      vw: this.viewport.clientWidth || window.innerWidth,
      vh: this.viewport.clientHeight || window.innerHeight
    };
  }

  computeFitScale() {
    const { vw, vh } = this.viewportSize();
    return Math.min(vw / this.mapWidth, vh / this.mapHeight) * 0.92;
  }

  updateScaleLimits() {
    const fit = this.computeFitScale();
    this.minScale = fit * 0.6;
    this.maxScale = Math.max(3, fit * 4);
  }

  clampScale(s) {
    return Math.min(Math.max(s, this.minScale), this.maxScale);
  }

  // 주어진 이동량을 화면 경계 안으로 보정한 값을 돌려줍니다 (상태는 바꾸지 않음)
  clampedTranslation(tx, ty, scale) {
    const { vw, vh } = this.viewportSize();
    const curW = this.mapWidth * scale;
    const curH = this.mapHeight * scale;
    const m = this.panMargin;
    // 족자가 열려 있으면 그만큼 지도를 더 끌어낼 수 있게 해, 가장자리 거점도 보이는 영역에 올 수 있도록
    const occ = this.panelOcclusion();

    const x = curW <= vw ? (vw - curW) / 2 : Math.min(Math.max(tx, vw - curW - m - occ.right), m);
    const y = curH <= vh ? (vh - curH) / 2 : Math.min(Math.max(ty, vh - curH - m - occ.bottom), m);
    return { x, y };
  }

  // 족자 패널이 화면 오른쪽(데스크톱) 또는 아래쪽(모바일 하단 시트)을 가리는 폭/높이(px)
  panelOcclusion() {
    const none = { right: 0, bottom: 0 };
    if (!this.infoPanel || !this.infoPanel.classList.contains('active')) return none;
    const { vw } = this.viewportSize();
    const cs = getComputedStyle(this.infoPanel);
    const w = this.infoPanel.offsetWidth;       // offset* 는 등장 애니메이션(transform)의 영향을 받지 않음
    const h = this.infoPanel.offsetHeight;
    const isSheet = w >= vw * 0.8;
    return isSheet
      ? { right: 0, bottom: h + (parseFloat(cs.bottom) || 0) }
      : { right: w + (parseFloat(cs.right) || 0), bottom: 0 };
  }

  // 패널과 상단 HUD 에 가려지지 않는 '실제로 보이는' 영역의 중심 (뷰포트 좌표)
  visibleCenter() {
    const { vw, vh } = this.viewportSize();
    const occ = this.panelOcclusion();
    const hud = document.querySelector('.top-hud');
    const vpTop = this.viewport.getBoundingClientRect().top;
    const top = hud ? Math.max(0, hud.getBoundingClientRect().bottom - vpTop) : 0;
    return {
      x: (vw - occ.right) / 2,
      y: top + (vh - occ.bottom - top) / 2
    };
  }

  setTransform(tx, ty, scale) {
    this.scale = scale;
    const c = this.clampedTranslation(tx, ty, scale);
    this.translateX = c.x;
    this.translateY = c.y;
    this.container.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
    this.updateZoomButtons();
  }

  // 화면 좌표(sx, sy)를 고정점으로 확대/축소
  zoomAt(sx, sy, newScale) {
    newScale = this.clampScale(newScale);
    if (newScale === this.scale) return;
    const ratio = newScale / this.scale;
    this.setTransform(sx - (sx - this.translateX) * ratio, sy - (sy - this.translateY) * ratio, newScale);
    this.isFitted = false;
  }

  fitToScreen(animate = false) {
    this.updateScaleLimits();
    const scale = this.computeFitScale();
    const { vw, vh } = this.viewportSize();
    const tx = (vw - this.mapWidth * scale) / 2;
    const ty = (vh - this.mapHeight * scale) / 2;

    if (animate) {
      this.animateTo(tx, ty, scale);
    } else {
      this.cancelAnimation();
      this.setTransform(tx, ty, scale);
    }
    this.isFitted = true;
  }

  handleResize() {
    this.updateScaleLimits();
    if (this.isFitted) {
      this.fitToScreen();
    } else {
      this.setTransform(this.translateX, this.translateY, this.clampScale(this.scale));
    }
  }

  // ------------------------------------------------------------------
  // 카메라 애니메이션
  // ------------------------------------------------------------------
  cancelAnimation() {
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  animateTo(endTx, endTy, endScale, duration = 750) {
    this.cancelAnimation();

    // 도착 지점을 미리 경계 안으로 보정 → 애니메이션 끝에 '툭' 튀지 않음
    const end = this.clampedTranslation(endTx, endTy, endScale);
    const start = { x: this.translateX, y: this.translateY, s: this.scale };

    if (this.reducedMotion || duration <= 0) {
      this.setTransform(end.x, end.y, endScale);
      return;
    }

    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);

    const step = (now) => {
      const p = Math.min((now - t0) / duration, 1);
      const k = ease(p);
      this.setTransform(
        start.x + (end.x - start.x) * k,
        start.y + (end.y - start.y) * k,
        start.s + (endScale - start.s) * k
      );
      this.animId = p < 1 ? requestAnimationFrame(step) : null;
    };
    this.animId = requestAnimationFrame(step);
  }

  // 지도 좌표 (mapX, mapY)가 '보이는 영역'의 중앙에 오도록 이동 (족자·HUD 에 가려지지 않게)
  panTo(mapX, mapY, targetScale = 1.25) {
    const c = this.visibleCenter();
    const scale = this.clampScale(targetScale);
    this.animateTo(c.x - mapX * scale, c.y - mapY * scale, scale);
    this.isFitted = false;
  }

  // 보이는 영역 중심을 기준으로 부드럽게 확대/축소 (+/− 버튼, 키보드)
  zoomBy(factor) {
    const newScale = this.clampScale(this.scale * factor);
    if (newScale === this.scale) return;
    const c = this.visibleCenter();
    const ratio = newScale / this.scale;
    this.animateTo(c.x - (c.x - this.translateX) * ratio, c.y - (c.y - this.translateY) * ratio, newScale, 220);
    this.isFitted = false;
  }

  // 확대/축소 한계에 닿으면 해당 버튼을 비활성화
  updateZoomButtons() {
    if (!this.zoomInBtn) return;
    const eps = 1e-3;
    this.zoomInBtn.disabled = this.scale >= this.maxScale - eps;
    this.zoomOutBtn.disabled = this.scale <= this.minScale + eps;
  }

  // ------------------------------------------------------------------
  // 입력: 포인터(마우스·터치·펜) 드래그 & 핀치
  // ------------------------------------------------------------------
  bindPointerEvents() {
    const vp = this.viewport;

    vp.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.cancelAnimation();
      this.suppressClick = false;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.startGesture();
    });

    window.addEventListener('pointermove', (e) => {
      if (this.tooltip.classList.contains('visible') && e.pointerType === 'mouse') {
        this.positionTooltip(e.clientX, e.clientY);
      }
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.updateGesture();
    });

    const endPointer = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      // 두 손가락 → 한 손가락이 되면 남은 손가락으로 계속 이동할 수 있도록 재시작
      this.startGesture();
    };
    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', endPointer);

    // 드래그로 끝난 동작은 클릭으로 취급하지 않습니다 (캡처 단계에서 차단)
    vp.addEventListener('click', (e) => {
      if (this.suppressClick) {
        e.stopPropagation();
        e.preventDefault();
        this.suppressClick = false;
      }
    }, true);

    // 브라우저가 포커스 이동 시 overflow:hidden 뷰포트를 스크롤해 버리는 것을 되돌림
    vp.addEventListener('scroll', () => {
      vp.scrollLeft = 0;
      vp.scrollTop = 0;
    });
  }

  startGesture() {
    const pts = [...this.pointers.values()];
    this.viewport.classList.toggle('is-dragging', pts.length > 0);

    if (pts.length === 0) {
      this.gesture = null;
      return;
    }

    const base = { tx: this.translateX, ty: this.translateY, scale: this.scale };
    if (pts.length === 1) {
      this.gesture = { type: 'pan', startX: pts[0].x, startY: pts[0].y, ...base };
    } else {
      const [a, b] = pts;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const rect = this.viewport.getBoundingClientRect();
      this.gesture = {
        type: 'pinch',
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        // 두 손가락 중심 아래에 있던 지도 좌표 — 이 점이 계속 손가락 중심에 머물도록 합니다
        mapX: (cx - rect.left - this.translateX) / this.scale,
        mapY: (cy - rect.top - this.translateY) / this.scale,
        ...base
      };
      this.suppressClick = true;
    }
  }

  updateGesture() {
    const g = this.gesture;
    if (!g) return;
    const pts = [...this.pointers.values()];

    if (g.type === 'pan' && pts.length === 1) {
      const dx = pts[0].x - g.startX;
      const dy = pts[0].y - g.startY;
      if (!this.suppressClick && Math.hypot(dx, dy) < this.dragThreshold) return;
      if (!this.suppressClick) this.hideTooltip();
      this.suppressClick = true;
      this.setTransform(g.tx + dx, g.ty + dy, this.scale);
      this.isFitted = false;
    } else if (g.type === 'pinch' && pts.length >= 2) {
      const [a, b] = pts;
      const rect = this.viewport.getBoundingClientRect();
      const cx = (a.x + b.x) / 2 - rect.left;
      const cy = (a.y + b.y) / 2 - rect.top;
      const scale = this.clampScale(g.scale * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist));
      this.setTransform(cx - g.mapX * scale, cy - g.mapY * scale, scale);
      this.isFitted = false;
    }
  }

  // 휠 / 트랙패드 줌 — 이동량(delta)에 비례해 부드럽게 확대
  bindWheel() {
    this.viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cancelAnimation();

      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 16;        // 줄 단위
      else if (e.deltaMode === 2) delta *= 400;  // 페이지 단위

      // 트랙패드 핀치(ctrlKey)는 delta 가 작으므로 감도를 높입니다
      const sensitivity = e.ctrlKey ? 0.01 : 0.0015;
      const factor = Math.min(Math.max(Math.exp(-delta * sensitivity), 0.5), 2);

      const rect = this.viewport.getBoundingClientRect();
      this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, this.scale * factor);
    }, { passive: false });
  }

  // 지도에 포커스가 있을 때: 방향키 이동, +/- 확대·축소, 0 전도 복원
  bindKeyboard() {
    this.viewport.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const step = 80;
      const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };

      if (moves[e.key]) {
        e.preventDefault();
        const [dx, dy] = moves[e.key];
        this.animateTo(this.translateX + dx, this.translateY + dy, this.scale, 180);
        this.isFitted = false;
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        this.zoomBy(1.4);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        this.zoomBy(1 / 1.4);
      } else if (e.key === '0') {
        e.preventDefault();
        this.fitToScreen(true);
      }
    });
  }

  // ------------------------------------------------------------------
  // 툴팁
  // ------------------------------------------------------------------
  showTooltip(text, x, y) {
    this.tooltip.textContent = text;
    this.tooltip.classList.add('visible');
    this.positionTooltip(x, y);
  }

  // 화면 오른쪽/아래 끝에서는 커서 반대편으로 뒤집어 잘리지 않게 합니다
  positionTooltip(x, y) {
    const offset = 12;
    const w = this.tooltip.offsetWidth;
    const h = this.tooltip.offsetHeight;
    let left = x + offset;
    let top = y + offset;
    if (left + w > window.innerWidth - 8) left = x - w - offset;
    if (top + h > window.innerHeight - 8) top = y - h - offset;
    this.tooltip.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
  }

  hideTooltip() {
    this.tooltip.classList.remove('visible');
  }

  // ------------------------------------------------------------------
  // 구역 / 거점 선택
  // ------------------------------------------------------------------
  selectRegion(regionId, { pan = true } = {}) {
    const region = this.data.regions[regionId];
    if (!region) return;
    this.openInfoPanel(regionId, null);
    if (pan && region.focus) this.panTo(region.focus.x, region.focus.y, region.focus.scale);
  }

  selectLandmark(lm) {
    this.openInfoPanel(lm.region, lm);
    // 현재 배율이 너무 작으면 살짝 확대하며 이동
    this.panTo(lm.x, lm.y, Math.max(this.scale, 1.35));
  }

  updateSelectionHighlight() {
    const { regionId, landmark } = this.selection || {};
    document.querySelectorAll('.region-polygon').forEach((el) => {
      el.classList.toggle('is-selected', !landmark && el.dataset.region === regionId);
    });
    document.querySelectorAll('.map-marker').forEach((el) => {
      el.classList.toggle('is-selected', !!landmark && el.dataset.landmark === landmark.id);
    });
  }

  // ------------------------------------------------------------------
  // 족자 패널
  // ------------------------------------------------------------------
  openInfoPanel(regionId, landmark = null) {
    this.selection = { regionId, landmark };
    this.renderInfoPanel();
    this.infoPanel.classList.add('active');
    this.infoPanel.inert = false;
    this.mainScreen.classList.add('panel-open');
    this.updateSelectionHighlight();
  }

  renderInfoPanel() {
    if (!this.selection) return;
    const { regionId, landmark } = this.selection;
    const data = this.data.regions[regionId];
    if (!data) return;
    const e = escapeHtml;

    const landmarkHtml = landmark ? `
      <div class="panel-landmark">
        <div class="panel-landmark-kicker">[ 선택된 주요 거점 ]</div>
        <div class="panel-landmark-name">${e(landmark.name)} <span>(${e(landmark.hanja)})</span></div>
        <div class="panel-landmark-desc">${e(landmark.desc)}</div>
      </div>` : '';

    let noticeHtml = '';
    if (data.notice) {
      const night = this.isNight;
      noticeHtml = `
        <div class="panel-notice${night ? ' is-night' : ''}">
          <span aria-hidden="true">${night ? '⚠️' : '⚓'}</span>
          <div>
            <strong>${night ? '야간 해수(괴수) 출몰 경고' : '주간 항해 안내'}:</strong><br>
            ${e(night ? data.notice.night : data.notice.day)}
          </div>
        </div>`;
    }

    this.panelContent.innerHTML = `
      <div class="panel-header">
        <span class="panel-direction-badge">[ ${e(data.direction)} · ${e(data.category)} ]</span>
        <div class="panel-title-wrap">
          <h2 class="panel-name" id="panel-title">${e(data.name)}</h2>
          <span class="panel-hanja">${e(data.hanja)}</span>
          <span class="seal-stamp" aria-hidden="true">${e(data.seal || '法')}</span>
        </div>
      </div>

      ${landmarkHtml}

      <p class="panel-summary-quote">"${e(data.summary)}"</p>

      <table class="panel-meta-table">
        <tr><th scope="row">지배 세력</th><td>${e(data.ruler)}</td></tr>
        <tr><th scope="row">위험 등급</th><td class="danger">${e(data.dangerLevel)}</td></tr>
      </table>

      <div class="panel-desc">${e(data.description)}</div>

      <div class="panel-traits-title">◈ 핵심 세계관 특성</div>
      <ul class="panel-traits-list">
        ${data.traits.map((t) => `<li>${e(t)}</li>`).join('')}
      </ul>

      ${noticeHtml}
    `;

    this.infoPanel.querySelector('.scroll-body').scrollTop = 0;
  }

  isPanelOpen() {
    return this.infoPanel.classList.contains('active');
  }

  closeInfoPanel() {
    this.infoPanel.classList.remove('active');
    this.infoPanel.inert = true;
    this.mainScreen.classList.remove('panel-open');
    this.selection = null;
    this.updateSelectionHighlight();
  }

  // ------------------------------------------------------------------
  // 상단 컨트롤 / 주야간
  // ------------------------------------------------------------------
  bindControls() {
    document.getElementById('btn-close-scroll').addEventListener('click', () => {
      this.closeInfoPanel();
      this.viewport.focus({ preventScroll: true });
    });

    this.dayNightBtn.addEventListener('click', () => this.toggleDayNight());

    document.getElementById('btn-reset-view').addEventListener('click', () => {
      this.fitToScreen(true);
    });

    this.zoomInBtn.addEventListener('click', () => this.zoomBy(1.4));
    this.zoomOutBtn.addEventListener('click', () => this.zoomBy(1 / 1.4));
    this.updateZoomButtons();
  }

  toggleDayNight() {
    this.isNight = !this.isNight;
    this.mainScreen.classList.toggle('night-mode', this.isNight);

    this.dayNightBtn.setAttribute('aria-pressed', String(this.isNight));
    this.dayNightBtn.textContent = this.isNight ? '🌙 야간' : '☀️ 주간';

    // 스크린리더에 알리도록 배너 문구는 야간 전환 시에만 채웁니다
    this.nightBanner.textContent = this.isNight
      ? '⚠️ [ 야간 경보 ] 황해 심해 괴수 출몰 중! 야간 해상 횡단 절대 불가'
      : '';

    // 괴수는 야간에만 키보드로 선택 가능
    const monster = document.getElementById('monster-group');
    if (monster) {
      if (this.isNight) {
        monster.setAttribute('tabindex', '0');
        monster.removeAttribute('aria-hidden');
      } else {
        monster.removeAttribute('tabindex');
        monster.setAttribute('aria-hidden', 'true');
      }
    }

    // 열려 있는 족자에 주/야간 안내가 있으면 선택 상태(거점 포함)를 유지한 채 갱신
    if (this.isPanelOpen() && this.selection && this.data.regions[this.selection.regionId]?.notice) {
      this.renderInfoPanel();
    }
  }
}
