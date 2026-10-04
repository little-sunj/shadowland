// ==========================================================================
// 황량계(荒涼界) 인터랙티브 지도 — 이동/확대, 구역·거점 선택, 족자 패널
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

// 위험 등급 문자열("★★★★☆ (주간) / ★★★★★ (야간 극위험)")을 다섯 칸 눈금으로 바꿉니다
function dangerHtml(level) {
  return `<span class="danger">${String(level).split('/').map((part) => {
    const count = (part.match(/★/g) || []).length;
    const note = (part.match(/\(([^)]+)\)/) || [])[1] || '';
    const pips = Array.from({ length: 5 }, (_, i) => `<i${i < count ? ' class="on"' : ''}></i>`).join('');
    return `<span class="danger-item" role="img" aria-label="위험 ${count}/5${note ? ` (${escapeHtml(note)})` : ''}">
      <span class="danger-pips" aria-hidden="true">${pips}</span>${note ? `<span class="danger-note" aria-hidden="true">${escapeHtml(note)}</span>` : ''}
    </span>`;
  }).join('')}</span>`;
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
    this.selection = null;       // { kind, id, landmark }
    this.hasInteracted = false;  // 사용자가 지도를 직접 움직였는지 (조작 안내 숨김용)
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
        // 호버 동안 흐림 효과를 켜 두고, 떠난 뒤에는 색이 다 빠질 때까지 기다렸다 끕니다
        polygon.addEventListener('pointerenter', () => this.softenRegion(polygon, true));
        polygon.addEventListener('pointerleave', () => this.softenRegion(polygon, false));
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
      if (site.x === undefined) return;           // 지도 위치가 없는 그룹(마을 등)
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
      if (lm.x !== undefined) {
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

  // item: sites[] 또는 landmarks[] 항목. 모든 지점·거점은 같은 위치핀(#i-location)을 쓰고,
  // 지점(major)은 조금 크게 그립니다. 핀의 뾰족한 끝이 (x, y) 위치를 가리킵니다.
  createMarker(item, { major, tooltip, activate }) {
    const k = this.data.map.markerScale || 1;
    const size = major ? 30 : 24;                  // 핀 크기 (마커 좌표계, 실제로는 k 배)

    const g = svgEl('g', {
      class: `map-marker${major ? ' is-major' : ''}`,
      'data-landmark': item.id,
      transform: `translate(${item.x}, ${item.y}) scale(${k})`,
      tabindex: 0,
      role: 'button',
      'aria-label': `${item.name}(${item.hanja}) — 족자 열기`
    });

    // 클릭 영역: 핀 몸통을 넉넉히 덮는 원
    g.appendChild(svgEl('circle', { class: 'marker-hitbox', cy: -size * 0.55, r: size * 0.75 }));

    const pin = svgEl('g', { class: 'marker-pin' });
    // 핀 속을 한지색으로 채워 어떤 지형 위에서도 또렷하게
    pin.appendChild(svgEl('circle', { class: 'marker-fill', cy: -size * 0.585, r: size * 0.3 }));
    pin.appendChild(svgEl('use', {
      class: 'marker-icon', href: '#i-location',
      x: -size / 2, y: -size, width: size, height: size
    }));
    g.appendChild(pin);

    const label = svgEl('text', {
      y: major ? 15 : 13,
      class: `map-text marker-label${major ? ' is-major' : ''}`,
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
    // 족자가 열려 있어도 지도는 늘 화면 전체를 덮어야 합니다 (반투명 족자 너머로 바깥이 비치지 않게).
    // 족자 반대편에 선택한 곳이 오도록 족자 위치를 정하므로(placePanelSide) 가장자리 거점도 가려지지 않습니다.
    const x = curW <= vw ? (vw - curW) / 2 : Math.min(Math.max(tx, vw - curW - m), m);
    const y = curH <= vh ? (vh - curH) / 2 : Math.min(Math.max(ty, vh - curH - m), m);
    return { x, y };
  }

  // 족자 패널이 화면 왼쪽/오른쪽(데스크톱) 또는 아래쪽(모바일 하단 시트)을 가리는 폭/높이(px)
  panelOcclusion() {
    const none = { left: 0, right: 0, bottom: 0 };
    if (!this.infoPanel || !this.infoPanel.classList.contains('active')) return none;
    const { vw } = this.viewportSize();
    const cs = getComputedStyle(this.infoPanel);
    const w = this.infoPanel.offsetWidth;       // offset* 는 등장 애니메이션(transform)의 영향을 받지 않음
    const h = this.infoPanel.offsetHeight;
    const isSheet = w >= vw * 0.8;
    if (isSheet) return { ...none, bottom: h + (parseFloat(cs.bottom) || 0) };
    return this.infoPanel.classList.contains('is-left')
      ? { ...none, left: w + (parseFloat(cs.left) || 0) }
      : { ...none, right: w + (parseFloat(cs.right) || 0) };
  }

  // 패널과 상단 HUD 에 가려지지 않는 '실제로 보이는' 영역의 중심 (뷰포트 좌표)
  visibleCenter() {
    const { vw, vh } = this.viewportSize();
    const occ = this.panelOcclusion();
    const hud = document.querySelector('.top-hud');
    const vpTop = this.viewport.getBoundingClientRect().top;
    const top = hud ? Math.max(0, hud.getBoundingClientRect().bottom - vpTop) : 0;
    return {
      x: occ.left + (vw - occ.left - occ.right) / 2,
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

  fitToScreen(animate = false, duration = 750) {
    this.updateScaleLimits();
    const scale = this.computeFitScale();
    const { vw, vh } = this.viewportSize();
    const tx = (vw - this.mapWidth * scale) / 2;
    let ty = (vh - this.mapHeight * scale) / 2;
    // 위아래가 잘릴 때는, 가장 위쪽 지점·거점이 상단 버튼(HUD)에 가리지 않을 만큼 지도를 내려서 시작
    const ys = [...Object.values(this.data.sites), ...this.data.landmarks].map((p) => p.y).filter((y) => y !== undefined);
    const hud = document.querySelector('.top-hud');
    if (ys.length && hud) {
      const hudBottom = hud.getBoundingClientRect().bottom - this.viewport.getBoundingClientRect().top;
      const markerTop = (Math.min(...ys) - 60) * scale;     // 핀 높이만큼 여유
      ty = Math.min(0, Math.max(ty, hudBottom + 12 - markerTop, vh - this.mapHeight * scale));
    }

    if (animate) {
      this.animateTo(tx, ty, scale, duration);
    } else {
      this.cancelAnimation();
      this.setTransform(tx, ty, scale);
    }
    this.isFitted = true;
  }

  // 인트로 동안: 지도를 살짝 당겨 둔 상태로 대기 → 안개가 걷히면 전도 전체로 천천히 물러납니다
  prepareReveal(mapX, mapY, zoom = 1.18) {
    const scale = this.clampScale(this.computeFitScale() * zoom);
    const { vw, vh } = this.viewportSize();
    this.setTransform(vw / 2 - mapX * scale, vh / 2 - mapY * scale, scale);
  }

  reveal() {
    this.fitToScreen(true, 2200);
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
    // 지도는 화면 밖으로 끌어낼 수 없으므로, 가장자리 근처 지점이 족자에 가리면 필요한 만큼만 더 확대합니다
    const scale = this.clampScale(Math.max(targetScale, this.minScaleToReveal(mapX, mapY)));
    this.animateTo(c.x - mapX * scale, c.y - mapY * scale, scale);
    this.isFitted = false;
  }

  // 지도 좌표 (mx, my)를 족자·GNB 에 가리지 않는 영역 안으로 옮길 수 있는 최소 배율.
  // 지도가 화면을 꽉 채운 채(가장자리 고정) 움직일 수 있는 범위 안에서 계산합니다.
  minScaleToReveal(mx, my) {
    const { vw, vh } = this.viewportSize();
    const occ = this.panelOcclusion();
    const hud = document.querySelector('.top-hud');
    const vpTop = this.viewport.getBoundingClientRect().top;
    const hudBottom = hud ? Math.max(0, hud.getBoundingClientRect().bottom - vpTop) : 0;
    const pad = 48;                                   // 핀·이름이 가장자리에 붙지 않을 여유
    const box = {
      left: occ.left + pad,
      right: vw - occ.right - pad,
      top: hudBottom + pad,
      bottom: vh - occ.bottom - pad
    };
    const need = [];
    // 가로: 지도 왼쪽 끝이 0, 오른쪽 끝이 vw 를 넘지 않는 범위에서 점이 [left, right] 안에 올 수 있어야
    if (mx > 0) need.push(box.left / mx);
    if (this.mapWidth > mx) need.push((vw - box.right) / (this.mapWidth - mx));
    if (my > 0) need.push(box.top / my);
    if (this.mapHeight > my) need.push((vh - box.bottom) / (this.mapHeight - my));
    return Math.max(0, ...need.filter(Number.isFinite));
  }

  // 보이는 영역 중심을 기준으로 부드럽게 확대/축소 (+/− 버튼, 키보드)
  zoomBy(factor) {
    this.markInteracted();
    const newScale = this.clampScale(this.scale * factor);
    if (newScale === this.scale) return;
    const c = this.visibleCenter();
    const ratio = newScale / this.scale;
    this.animateTo(c.x - (c.x - this.translateX) * ratio, c.y - (c.y - this.translateY) * ratio, newScale, 220);
    this.isFitted = false;
  }

  // 사용자가 처음 지도를 직접 움직이면 하단 조작 안내를 숨깁니다
  markInteracted() {
    if (this.hasInteracted) return;
    this.hasInteracted = true;
    this.mainScreen.classList.add('has-interacted');
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
      this.markInteracted();
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
      this.markInteracted();
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
      this.markInteracted();
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
        this.markInteracted();
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
    const visW = vw - occ.left - occ.right;
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

  // 구역의 흐림 효과 켜기/끄기 — 끌 때는 색이 사라지는 전환(0.25s)보다 조금 늦게
  softenRegion(el, on) {
    clearTimeout(el._softTimer);
    if (on) el.classList.add('is-soft');
    else el._softTimer = setTimeout(() => el.classList.remove('is-soft'), 400);
  }

  updateSelectionHighlight() {
    const { kind, id, landmark } = this.selection || {};
    document.querySelectorAll('.region-polygon').forEach((el) => {
      const on = kind === 'region' && !landmark && el.dataset.region === id;
      // 선택이 풀릴 때도 색이 빠지는 동안 흐림을 유지 (마우스가 아직 위에 있으면 유지)
      if (!on && el.classList.contains('is-selected') && !el.matches(':hover')) {
        el.classList.add('is-soft');
        this.softenRegion(el, false);
      }
      el.classList.toggle('is-selected', on);
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
    this.placePanelSide(kind, id, landmark);
    this.renderInfoPanel();
    this.infoPanel.classList.add('active');
    this.infoPanel.inert = false;
    this.mainScreen.classList.add('panel-open');
    this.updateSelectionHighlight();
  }

  // 선택한 곳이 지도 오른쪽 절반(동부 쪽)이면 족자를 왼쪽에, 아니면 오른쪽에 둡니다.
  // 족자가 선택한 곳의 반대편에 뜨므로, 카메라를 지도 가장자리 밖으로 끌어낼 일이 없습니다.
  placePanelSide(kind, id, landmark) {
    let x = landmark ? landmark.x : undefined;
    if (x === undefined) {
      const data = this.entry(kind, id);
      if (kind === 'site') x = data && data.x;
      else if (data) {
        const f = data.focus || this.regionFocus(data);
        x = f && f.x;
      }
    }
    const left = x !== undefined && x > this.mapWidth / 2;
    this.infoPanel.classList.toggle('is-left', left);
    this.mainScreen.classList.toggle('panel-left', left);
  }

  // 족자 안의 '바로가기' 버튼 목록 (지점 ↔ 구역 ↔ 거점 이동)
  relatedLinks(kind, data) {
    const links = [];
    if (kind === 'region') {
      Object.values(this.data.sites).filter((s) => s.region === data.id && s.x !== undefined)
        .forEach((s) => links.push({ key: `site:${s.id}`, label: s.name }));
      this.data.landmarks.filter((l) => l.region === data.id && !(l.parent && this.data.sites[l.parent]?.region === data.id))
        .forEach((l) => links.push({ key: `landmark:${l.id}`, label: l.shortName || l.name }));
      return { title: '이 지역의 지점 · 거점', links };
    }
    if (data.region && this.data.regions[data.region]) {
      const r = this.data.regions[data.region];
      links.push({ key: `region:${r.id}`, label: `${r.name} 전역` });
    }
    this.data.landmarks.filter((l) => l.parent === data.id)
      .forEach((l) => links.push({ key: `landmark:${l.id}`, label: l.shortName || l.name }));
    return { title: '관련 지역 · 거점', links };
  }

  renderInfoPanel() {
    if (!this.selection) return;
    const { kind, id, landmark } = this.selection;
    const data = this.entry(kind, id);
    if (!data) return;
    const e = escapeHtml;

    const placeBox = (kicker, p, focus) => `
      <section class="panel-place${focus ? ' is-focus' : ''}">
        <p class="eyebrow">${kicker}</p>
        <p class="panel-place-name">${e(p.name)}<span lang="zh-Hant">${e(p.hanja)}</span></p>
        <p class="panel-place-desc">${e(p.desc)}</p>
      </section>`;

    const landmarkHtml = landmark ? placeBox('선택한 거점', landmark, true) : '';
    const keyPlaceHtml = data.keyPlace ? placeBox('본거지', data.keyPlace, false) : '';

    // 주의 안내 (예: 황해의 항해 경고) — data 의 notice: { title, text }
    const noticeHtml = data.notice ? `
        <aside class="panel-notice" role="note">
          ${iconHtml('warning')}
          <div>
            <strong>${e(data.notice.title)}</strong>
            ${e(data.notice.text)}
          </div>
        </aside>` : '';

    const rel = this.relatedLinks(kind, data);
    const linksHtml = rel.links.length ? `
      <h3 class="panel-section-title">${e(rel.title)}</h3>
      <div class="panel-links">
        ${rel.links.map((l) => `<button type="button" class="panel-chip" data-select="${e(l.key)}">${e(l.label)}</button>`).join('')}
      </div>` : '';

    // 대표 그림 (data.image) — 위에서부터 꽉 차고 아래로 갈수록 족자 바탕에 녹아듭니다
    const heroHtml = data.image ? `
      <div class="panel-hero">
        <img src="${e(data.image)}" alt="" referrerpolicy="no-referrer" decoding="async">
      </div>` : '';

    this.panelContent.innerHTML = `
      ${heroHtml}
      <header class="panel-header">
        <p class="eyebrow">${e(data.direction)} · ${e(data.category)}</p>
        <div class="panel-title-wrap">
          <h2 class="panel-name" id="panel-title">${e(data.name)}</h2>
          <span class="panel-hanja" lang="zh-Hant">${e(data.hanja)}</span>
          <span class="seal-stamp" aria-hidden="true">${e(data.seal || '法')}</span>
        </div>
      </header>

      ${landmarkHtml}

      <p class="panel-lead">${e(data.summary)}</p>

      <dl class="panel-meta">
        <dt>지배 세력</dt><dd>${e(data.ruler)}</dd>
        <dt>위험 등급</dt><dd>${dangerHtml(data.dangerLevel)}</dd>
      </dl>

      ${keyPlaceHtml}

      <div class="panel-desc">${e(data.description)}</div>

      <h3 class="panel-section-title">핵심 특성</h3>
      <ul class="panel-traits-list">
        ${data.traits.map((t) => `<li>${e(t)}</li>`).join('')}
      </ul>

      ${noticeHtml}

      ${linksHtml}
    `;

    // 그림을 못 불러오면 빈 칸 대신 그림 없는 족자로
    const heroImg = this.panelContent.querySelector('.panel-hero img');
    if (heroImg) heroImg.addEventListener('error', () => heroImg.parentElement.remove(), { once: true });

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
  // 상단 컨트롤
  // ------------------------------------------------------------------
  bindControls() {
    document.getElementById('btn-close-scroll').addEventListener('click', () => {
      this.closeInfoPanel();
      this.viewport.focus({ preventScroll: true });
    });

    // 족자 속 바로가기 버튼
    this.panelContent.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-select]');
      if (btn) this.handlePanelLink(btn.dataset.select);
    });

    // 로고(홈): 족자를 닫고 전도 전체로
    const home = document.getElementById('btn-home');
    if (home) {
      home.addEventListener('click', () => {
        if (this.isPanelOpen()) this.closeInfoPanel();
        this.fitToScreen(true, 900);
      });
    }

    this.zoomInBtn.addEventListener('click', () => this.zoomBy(1.4));
    this.zoomOutBtn.addEventListener('click', () => this.zoomBy(1 / 1.4));
    this.updateZoomButtons();
  }
}
