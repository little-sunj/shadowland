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

// 아이콘 스프라이트(index.html 의 <symbol>)를 쓰는 인라인 SVG 문자열
function iconHtml(name) {
  return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
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

    // 지도 기준 해상도 = 지도 이미지 픽셀 크기 (js/data.js 의 map)
    this.mapWidth = data.map.width;
    this.mapHeight = data.map.height;
    this.panMargin = 0;         // 지도 가장자리 바깥으로 끌어낼 수 있는 여유(px) — 0: 빈 공간이 보이지 않게

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
    this.selection = null;       // { kind, id, landmark }
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.canHover = window.matchMedia('(hover: hover)');   // 터치 기기에서는 호버 툴팁 생략

    this.applyMapImage();
    this.buildMap();
    this.layoutMapIcons();
    // 웹폰트가 늦게 도착하면 글자 폭이 바뀌므로 한 번 더 맞춥니다
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.layoutMapIcons());
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

  // 지도 이미지·크기를 data.map 에 맞춥니다 (지도를 바꿀 때는 data.js 의 map 만 고치면 됨)
  applyMapImage() {
    const { image, width, height } = this.data.map;
    const svg = document.getElementById('fantasy-map');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const img = document.getElementById('map-bg-image');
    img.setAttribute('href', image);
    img.setAttribute('width', width);
    img.setAttribute('height', height);
    const tint = document.getElementById('night-tint');
    tint.setAttribute('width', width);
    tint.setAttribute('height', height);
    this.container.style.width = `${width}px`;
    this.container.style.height = `${height}px`;
    // 족자를 열어 지도가 밀릴 때 드러나는 가장자리를 흐린 지도로 채우는 배경
    // (CSS 변수 속 url 은 css 폴더 기준으로 풀리므로 절대 경로로 넘깁니다)
    const absUrl = new URL(image, document.baseURI).href;
    this.viewport.style.setProperty('--map-image', `url("${absUrl}")`);
  }

  buildMap() {
    const regionsLayer = document.getElementById('regions-layer');
    const labelsLayer = document.getElementById('labels-layer');
    const ringsLayer = document.getElementById('rings-layer');
    const markersLayer = document.getElementById('markers-layer');

    // 구역 (경계 + 큰 지명)
    Object.values(this.data.regions).forEach((region) => {
      if (region.polygon) {
        const polygon = svgEl('polygon', {
          class: 'region-polygon',
          points: region.polygon,
          'data-region': region.id,
          tabindex: 0,
          role: 'button',
          'aria-label': `${region.name}(${region.hanja}) — 족자 열기`,
          style: `--region-color: ${region.color}`
        });
        this.bindSelectable(polygon, {
          tooltip: `${region.name} (${region.hanja})`,
          activate: () => this.selectRegion(region.id)
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
          x, y: y + Math.round(size * 0.95), class: 'map-text region-sublabel', 'text-anchor': 'middle', 'data-region': region.id
        });
        subtitle.textContent = region.hanja;
        labelsLayer.append(title, subtitle);
      }
    });

    // 주요 지점 (세력권 고리 + 큰 핀)
    Object.values(this.data.sites).forEach((site) => {
      if (!site.pin) return;                      // 핀이 없는 그룹(마을 등)
      const ring = svgEl('circle', {
        class: 'site-ring', cx: site.x, cy: site.y, r: site.radius,
        'data-site': site.id, style: `--ring-color: ${site.color}`
      });
      ringsLayer.appendChild(ring);

      const marker = this.createMarker(site, {
        major: true,
        tooltip: `◈ ${site.name} (${site.hanja}) · ${site.category}`,
        activate: () => this.selectSite(site.id)
      });
      // 핀에 마우스를 올리면 세력권 고리도 함께 보여 줍니다
      marker.addEventListener('pointerenter', () => ring.classList.add('is-hover'));
      marker.addEventListener('pointerleave', () => ring.classList.remove('is-hover'));
      markersLayer.appendChild(marker);
    });

    // 소거점
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
      if (lm.pin) {
        markersLayer.appendChild(this.createMarker(lm, {
          major: false,
          tooltip: `◈ ${lm.name} (${lm.hanja}) - ${lm.type}`,
          activate: () => this.selectLandmark(lm)
        }));
      }
    });
  }

  // 지도 위 라벨 앞에 아이콘(<use class="map-icon">)을 붙이고, 아이콘+글자 묶음이 원래 중심에 오도록 정렬
  layoutMapIcons() {
    document.querySelectorAll('#fantasy-map .map-icon').forEach((icon) => {
      const text = icon.previousElementSibling;
      if (!text || text.tagName !== 'text') return;
      if (!text.dataset.cx) text.dataset.cx = text.getAttribute('x');
      const size = parseFloat(icon.getAttribute('width'));
      const gap = size * 0.3;
      const cx = parseFloat(text.dataset.cx);
      const box = text.getBBox();
      if (!box.width) return;                       // 아직 그려지지 않음
      text.setAttribute('x', cx + (size + gap) / 2);
      const startX = cx - (box.width + size + gap) / 2;
      icon.setAttribute('x', startX);
      icon.setAttribute('y', box.y + (box.height - size) / 2);
    });
  }

  // item: sites[] 또는 landmarks[] 항목. 핀 내부는 작은 좌표로 그리고 map.markerScale 배로 키웁니다.
  createMarker(item, { major, tooltip, activate }) {
    const { shape, r, fill, stroke, icon } = item.pin;
    const isSmall = shape === 'village';
    const k = this.data.map.markerScale || 1;

    const g = svgEl('g', {
      class: `map-marker${major ? ' is-major' : ''}`,
      'data-landmark': item.id,
      transform: `translate(${item.x}, ${item.y}) scale(${k})`,
      tabindex: 0,
      role: 'button',
      'aria-label': `${item.name}(${item.hanja}) — 족자 열기`
    });

    g.appendChild(svgEl('circle', { class: 'marker-hitbox', r: r + 12 }));

    const pin = svgEl('g', { class: 'marker-pin' });
    pin.appendChild(svgEl('circle', {
      r, fill, stroke, 'stroke-width': isSmall ? 1.8 : 2,
      filter: isSmall ? null : 'url(#marker-glow)'
    }));

    const s = r / 13;   // 아이콘은 반지름 13 기준으로 그려 두고 핀 크기에 맞춰 확대
    const icons = {
      peak: () => svgEl('polygon', { points: '0,-7 -6,4 6,4', fill: icon }),
      keep: () => svgEl('rect', { x: -5, y: -5, width: 10, height: 10, fill: icon }),
      palace: () => svgEl('polygon', { points: '0,-7 7,0 0,7 -7,0', fill: icon }),
      serpent: () => svgEl('path', { d: 'M -4,-4 Q 4,-1 -4,2 Q 4,5 0,6', stroke: icon, 'stroke-width': 2, fill: 'none' }),
      mist: () => svgEl('path', { d: 'M -6,-3 q 3,-3 6,0 t 6,0 M -6,3 q 3,-3 6,0 t 6,0', stroke: icon, 'stroke-width': 1.8, fill: 'none', 'stroke-linecap': 'round' }),
      cave: () => svgEl('path', { d: 'M -6,5 L -6,0 A 6,6 0 0 1 6,0 L 6,5 Z', fill: icon }),
      village: () => svgEl('circle', { r: 3.5, fill: icon })
    };
    if (icons[shape]) {
      const glyph = icons[shape]();
      if (!isSmall && s !== 1) glyph.setAttribute('transform', `scale(${s.toFixed(3)})`);
      pin.appendChild(glyph);
    }
    g.appendChild(pin);

    const label = svgEl('text', {
      y: r + (major ? 14 : 11),
      class: `map-text marker-label${major ? ' is-major' : ''}${isSmall ? ' is-small' : ''}`,
      'text-anchor': 'middle'
    });
    label.textContent = item.shortName || item.name;
    g.appendChild(label);

    this.bindSelectable(g, { tooltip, activate });
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

  // 지도가 화면을 빈틈없이 꽉 채우는 배율 (CSS 의 background-size: cover 와 같은 방식)
  computeFitScale() {
    const { vw, vh } = this.viewportSize();
    return Math.max(vw / this.mapWidth, vh / this.mapHeight);
  }

  updateScaleLimits() {
    const fit = this.computeFitScale();
    this.minScale = fit;                // 이보다 축소하면 지도 바깥(빈 공간)이 보이므로 막습니다
    // 원본 이미지 픽셀 기준 최대 배율 (이보다 크게 확대하면 흐려짐). 아주 큰 화면에서는 맞춤 배율의 2배까지
    this.maxScale = Math.max(this.data.map.maxScale || 1.6, fit * 2);
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

    // 지도가 '보이는 영역'(족자에 가려지지 않은 부분)보다 작으면 그 영역 가운데에, 크면 여유 범위 안에서 자유롭게
    const visW = vw - occ.right;
    const visH = vh - occ.bottom;
    const x = curW <= visW ? (visW - curW) / 2 : Math.min(Math.max(tx, vw - curW - m - occ.right), m);
    const y = curH <= visH ? (visH - curH) / 2 : Math.min(Math.max(ty, vh - curH - m - occ.bottom), m);
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
      // 모든 포인터가 떨어지면, 이번 드래그 직후의 click 만 막고 플래그는 곧바로 풀어 둡니다
      if (this.pointers.size === 0 && this.suppressClick) {
        setTimeout(() => { this.suppressClick = false; }, 0);
      }
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
  // 구역 / 지점 / 거점 선택
  //  selection = { kind: 'region' | 'site', id, landmark }
  // ------------------------------------------------------------------
  entry(kind, id) {
    return kind === 'site' ? this.data.sites[id] : this.data.regions[id];
  }

  selectRegion(regionId, { pan = true } = {}) {
    const region = this.data.regions[regionId];
    if (!region) return;
    this.openInfoPanel('region', regionId, null);
    if (pan) {
      const f = region.focus || this.regionFocus(region);
      if (f) this.panTo(f.x, f.y, f.scale);
    }
  }

  // 구역 경계(polygon)의 외곽 상자를 '보이는 영역'에 꽉 차게 맞추는 중심점·배율
  regionFocus(region) {
    if (!region.polygon) return null;
    const xy = region.polygon.trim().split(/\s+/).map((p) => p.split(',').map(Number));
    const xs = xy.map((p) => p[0]);
    const ys = xy.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const { vw, vh } = this.viewportSize();
    const occ = this.panelOcclusion();
    const hud = document.querySelector('.top-hud');
    const top = hud ? hud.getBoundingClientRect().bottom - this.viewport.getBoundingClientRect().top : 0;
    const visW = vw - occ.right;
    const visH = vh - occ.bottom - Math.max(0, top);
    const fit = this.computeFitScale();
    const scale = Math.min(this.maxScale, 1, Math.max(fit * 1.15, Math.min(visW / (x1 - x0), visH / (y1 - y0)) * 0.95));
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, scale };
  }

  selectSite(siteId, { pan = true } = {}) {
    const site = this.data.sites[siteId];
    if (!site) return;
    this.openInfoPanel('site', siteId, null);
    if (pan && site.x !== undefined) this.panTo(site.x, site.y, Math.max(this.scale, this.focusScale(site.radius)));
  }

  // 소거점: 소속 지점(parent)이 있으면 그 지점의 족자, 없으면 소속 구역의 족자에 거점 안내를 얹어 엽니다
  selectLandmark(lm) {
    if (lm.parent && this.data.sites[lm.parent]) this.openInfoPanel('site', lm.parent, lm);
    else this.openInfoPanel('region', lm.region, lm);
    this.panTo(lm.x, lm.y, Math.max(this.scale, this.focusScale(120)));
  }

  // 세력권 반지름이 화면에서 적당한 크기(약 120px)로 보이는 배율
  focusScale(radius) {
    // 작은 지점도 주변이 보이도록 원본 크기(1배) 조금 넘는 정도까지만 확대
    return Math.min(this.maxScale, 1.1, Math.max(this.computeFitScale() * 1.4, 120 / (radius || 120)));
  }

  updateSelectionHighlight() {
    const { kind, id, landmark } = this.selection || {};
    document.querySelectorAll('.region-polygon').forEach((el) => {
      el.classList.toggle('is-selected', kind === 'region' && !landmark && el.dataset.region === id);
    });
    document.querySelectorAll('.map-marker').forEach((el) => {
      const key = el.dataset.landmark;
      const on = landmark ? key === landmark.id : (kind === 'site' && key === id);
      el.classList.toggle('is-selected', on);
    });
    document.querySelectorAll('.site-ring').forEach((el) => {
      el.classList.toggle('is-selected', kind === 'site' && el.dataset.site === id);
    });
  }

  // ------------------------------------------------------------------
  // 족자 패널
  // ------------------------------------------------------------------
  openInfoPanel(kind, id, landmark = null) {
    this.selection = { kind, id, landmark };
    this.renderInfoPanel();
    this.infoPanel.classList.add('active');
    this.infoPanel.inert = false;
    this.mainScreen.classList.add('panel-open');
    this.updateSelectionHighlight();
  }

  // 족자 안의 '바로가기' 버튼 목록 (지점 ↔ 구역 ↔ 거점 이동)
  relatedLinks(kind, data) {
    const links = [];
    if (kind === 'region') {
      Object.values(this.data.sites).filter((s) => s.region === data.id && s.pin)
        .forEach((s) => links.push({ key: `site:${s.id}`, label: s.name }));
      this.data.landmarks.filter((l) => l.region === data.id && !(l.parent && this.data.sites[l.parent]?.region === data.id))
        .forEach((l) => links.push({ key: `landmark:${l.id}`, label: l.shortName || l.name }));
      return { title: '◈ 이 지역의 지점 · 거점', links };
    }
    if (data.region && this.data.regions[data.region]) {
      const r = this.data.regions[data.region];
      links.push({ key: `region:${r.id}`, label: `${r.name} (소속 지역)` });
    }
    this.data.landmarks.filter((l) => l.parent === data.id)
      .forEach((l) => links.push({ key: `landmark:${l.id}`, label: l.shortName || l.name }));
    return { title: '◈ 관련 지역 · 거점', links };
  }

  renderInfoPanel() {
    if (!this.selection) return;
    const { kind, id, landmark } = this.selection;
    const data = this.entry(kind, id);
    if (!data) return;
    const e = escapeHtml;

    const placeBox = (kicker, p) => `
      <div class="panel-landmark">
        <div class="panel-landmark-kicker">[ ${kicker} ]</div>
        <div class="panel-landmark-name">${e(p.name)} <span>(${e(p.hanja)})</span></div>
        <div class="panel-landmark-desc">${e(p.desc)}</div>
      </div>`;

    const landmarkHtml = landmark ? placeBox('선택된 거점', landmark) : '';
    const keyPlaceHtml = data.keyPlace ? placeBox('본거지', data.keyPlace) : '';

    let noticeHtml = '';
    if (data.notice) {
      const night = this.isNight;
      noticeHtml = `
        <div class="panel-notice${night ? ' is-night' : ''}">
          ${iconHtml(night ? 'warning' : 'anchor')}
          <div>
            <strong>${night ? '야간 해수(괴수) 출몰 경고' : '주간 항해 안내'}:</strong><br>
            ${e(night ? data.notice.night : data.notice.day)}
          </div>
        </div>`;
    }

    const rel = this.relatedLinks(kind, data);
    const linksHtml = rel.links.length ? `
      <div class="panel-traits-title">${rel.title}</div>
      <div class="panel-links">
        ${rel.links.map((l) => `<button type="button" class="panel-chip" data-select="${e(l.key)}">${e(l.label)}</button>`).join('')}
      </div>` : '';

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

      ${keyPlaceHtml}

      <div class="panel-desc">${e(data.description)}</div>

      <div class="panel-traits-title">◈ 핵심 세계관 특성</div>
      <ul class="panel-traits-list">
        ${data.traits.map((t) => `<li>${e(t)}</li>`).join('')}
      </ul>

      ${linksHtml}

      ${noticeHtml}
    `;

    this.infoPanel.querySelector('.scroll-body').scrollTop = 0;
  }

  // 족자 속 바로가기 버튼 처리 (data-select="site:churadae" 등)
  handlePanelLink(key) {
    const [type, id] = key.split(':');
    if (type === 'region') this.selectRegion(id);
    else if (type === 'site') this.selectSite(id);
    else if (type === 'landmark') {
      const lm = this.data.landmarks.find((l) => l.id === id);
      if (lm) this.selectLandmark(lm);
    }
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

    // 족자 속 바로가기 버튼
    this.panelContent.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-select]');
      if (btn) this.handlePanelLink(btn.dataset.select);
    });

    this.zoomInBtn.addEventListener('click', () => this.zoomBy(1.4));
    this.zoomOutBtn.addEventListener('click', () => this.zoomBy(1 / 1.4));
    this.updateZoomButtons();
  }

  toggleDayNight() {
    this.isNight = !this.isNight;
    this.mainScreen.classList.toggle('night-mode', this.isNight);

    this.dayNightBtn.setAttribute('aria-pressed', String(this.isNight));
    this.dayNightBtn.querySelector('use').setAttribute('href', this.isNight ? '#i-moon' : '#i-sun');
    this.dayNightBtn.querySelector('.btn-label').textContent = this.isNight ? '야간' : '주간';

    // 스크린리더에 알리도록 배너 문구는 야간 전환 시에만 채웁니다
    this.nightBanner.innerHTML = this.isNight
      ? `${iconHtml('warning')}<span>[ 야간 경보 ] 황해 심해 괴수 출몰 중! 야간 해상 횡단 절대 불가</span>`
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
    const sel = this.selection;
    if (this.isPanelOpen() && sel && this.entry(sel.kind, sel.id)?.notice) {
      this.renderInfoPanel();
    }
  }
}
