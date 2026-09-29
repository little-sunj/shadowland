// ==========================================================================
// 황량계(荒涼界) 인터랙티브 지도 조작 및 족자 패널 제어
// ==========================================================================

class FantasyMap {
  constructor() {
    this.viewport = document.getElementById('map-viewport');
    this.container = document.getElementById('map-container');
    this.tooltip = document.getElementById('map-tooltip');
    this.infoPanel = document.getElementById('info-panel');
    this.mainScreen = document.getElementById('main-screen');

    // 지도 기준 해상도 (SVG viewBox: 1400 x 1400)
    this.mapWidth = 1400;
    this.mapHeight = 1400;

    // 변환 상태
    this.scale = 1;
    this.minScale = 0.4;
    this.maxScale = 2.8;
    this.translateX = 0;
    this.translateY = 0;

    // 드래그 상태
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.lastTranslateX = 0;
    this.lastTranslateY = 0;

    // 야간 모드 상태
    this.isNight = false;

    // 활성 구역 ID
    this.activeRegionId = null;

    this.init();
  }

  init() {
    this.fitToScreen();
    this.bindPanZoomEvents();
    this.bindRegionEvents();
    this.bindMarkerEvents();
    this.bindControls();
    window.addEventListener('resize', () => this.handleResize());
  }

  fitToScreen() {
    const vw = this.viewport.clientWidth || window.innerWidth;
    const vh = this.viewport.clientHeight || window.innerHeight;

    // 대륙 전체가 한눈에 들어오도록 스케일 계산
    const scaleX = vw / this.mapWidth;
    const scaleY = vh / this.mapHeight;
    this.scale = Math.min(scaleX, scaleY) * 0.92;
    this.minScale = this.scale * 0.6;
    this.maxScale = 3.0;

    // 화면 중앙 정렬
    this.translateX = (vw - this.mapWidth * this.scale) / 2;
    this.translateY = (vh - this.mapHeight * this.scale) / 2;
    this.updateTransform();
  }

  handleResize() {
    // 리사이즈 시 화면 벗어남 방지
    this.clampTranslation();
    this.updateTransform();
  }

  updateTransform() {
    this.container.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
  }

  clampTranslation() {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    const curW = this.mapWidth * this.scale;
    const curH = this.mapHeight * this.scale;

    // 가로축: 지도가 화면 폭보다 작거나 같으면 정중앙 정렬, 크면 패닝 여백 제한
    if (curW <= vw) {
      this.translateX = (vw - curW) / 2;
    } else {
      const minX = vw - curW - 150;
      const maxX = 150;
      this.translateX = Math.min(Math.max(this.translateX, minX), maxX);
    }

    // 세로축: 지도가 화면 높이보다 작거나 같으면 정중앙 정렬, 크면 패닝 여백 제한
    if (curH <= vh) {
      this.translateY = (vh - curH) / 2;
    } else {
      const minY = vh - curH - 150;
      const maxY = 150;
      this.translateY = Math.min(Math.max(this.translateY, minY), maxY);
    }
  }

  bindPanZoomEvents() {
    // 드래그 이동 (Pan)
    this.viewport.addEventListener('mousedown', (e) => {
      // 족자 패널이나 UI 조작 시 드래그 방지
      if (e.target.closest('.top-hud') || e.target.closest('#info-panel')) return;
      this.isDragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.lastTranslateX = this.translateX;
      this.lastTranslateY = this.translateY;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;
        this.translateX = this.lastTranslateX + dx;
        this.translateY = this.lastTranslateY + dy;
        this.clampTranslation();
        this.updateTransform();
      }

      // 미니 툴팁 위치 갱신
      if (this.tooltip && this.tooltip.classList.contains('visible')) {
        this.tooltip.style.left = `${e.clientX}px`;
        this.tooltip.style.top = `${e.clientY}px`;
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    // 휠 줌 (Zoom at mouse position)
    this.viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
      const newScale = Math.min(Math.max(this.scale * zoomFactor, this.minScale), this.maxScale);

      if (newScale === this.scale) return;

      const rect = this.viewport.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // 마우스 커서 중심 줌 계산
      this.translateX = mouseX - (mouseX - this.translateX) * (newScale / this.scale);
      this.translateY = mouseY - (mouseY - this.translateY) * (newScale / this.scale);
      this.scale = newScale;

      this.clampTranslation();
      this.updateTransform();
    }, { passive: false });

    // 모바일 터치 지원 (1터치: 이동, 2터치: 핀치 줌)
    let touchStartDist = 0;
    let touchStartScale = 1;

    this.viewport.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.dragStartX = e.touches[0].clientX;
        this.dragStartY = e.touches[0].clientY;
        this.lastTranslateX = this.translateX;
        this.lastTranslateY = this.translateY;
      } else if (e.touches.length === 2) {
        this.isDragging = false;
        touchStartDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        touchStartScale = this.scale;
      }
    }, { passive: true });

    this.viewport.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && this.isDragging) {
        const dx = e.touches[0].clientX - this.dragStartX;
        const dy = e.touches[0].clientY - this.dragStartY;
        this.translateX = this.lastTranslateX + dx;
        this.translateY = this.lastTranslateY + dy;
        this.clampTranslation();
        this.updateTransform();
      } else if (e.touches.length === 2 && touchStartDist > 0) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const newScale = Math.min(Math.max(touchStartScale * (dist / touchStartDist), this.minScale), this.maxScale);
        this.scale = newScale;
        this.clampTranslation();
        this.updateTransform();
      }
    }, { passive: true });

    this.viewport.addEventListener('touchend', () => {
      this.isDragging = false;
      touchStartDist = 0;
    });
  }

  // 특정 좌표 및 배율로 부드럽게 시점 이동 (카메라 점프)
  panTo(targetX, targetY, targetScale = 1.25) {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;

    const startX = this.translateX;
    const startY = this.translateY;
    const startScale = this.scale;

    const endScale = Math.min(Math.max(targetScale, this.minScale), this.maxScale);
    const endX = (vw / 2) - (targetX * endScale);
    const endY = (vh / 2) - (targetY * endScale);

    const startTime = performance.now();
    const duration = 750;

    const easeOutCubic = (t) => (--t) * t * t + 1;

    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = easeOutCubic(progress);

      this.scale = startScale + (endScale - startScale) * ease;
      this.translateX = startX + (endX - startX) * ease;
      this.translateY = startY + (endY - startY) * ease;

      this.updateTransform();

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        this.clampTranslation();
        this.updateTransform();
      }
    };

    requestAnimationFrame(animate);
  }

  bindRegionEvents() {
    const regions = document.querySelectorAll('.region-polygon');
    regions.forEach((polygon) => {
      const regionId = polygon.dataset.region;
      const regionData = WORLD_DATA.regions[regionId];
      if (!regionData) return;

      // 호버 시 하이라이트 및 툴팁 표시
      polygon.addEventListener('mouseenter', (e) => {
        polygon.classList.add('active');
        this.showTooltip(`${regionData.name} (${regionData.hanja}) · [${regionData.direction}]`, e);
      });

      polygon.addEventListener('mouseleave', () => {
        polygon.classList.remove('active');
        this.hideTooltip();
      });

      // 클릭 시 족자 패널 오픈 및 해당 지역으로 부드럽게 카메라 이동
      polygon.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openInfoPanel(regionId);
        this.focusRegion(regionId);
        // 상단 네비게이션 버튼 활성화 동기화
        const matchingBtn = document.querySelector(`.nav-btn[data-target="${regionId}"]`);
        if (matchingBtn) {
          document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
          matchingBtn.classList.add('active');
        }
      });
    });
  }

  bindMarkerEvents() {
    const markers = document.querySelectorAll('.map-marker');
    markers.forEach((marker) => {
      const landmarkId = marker.dataset.landmark;
      const lmData = WORLD_DATA.landmarks.find(l => l.id === landmarkId);
      if (!lmData) return;

      marker.addEventListener('mouseenter', (e) => {
        this.showTooltip(`◈ ${lmData.name} (${lmData.hanja}) - ${lmData.type}`, e);
      });

      marker.addEventListener('mouseleave', () => {
        this.hideTooltip();
      });

      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openInfoPanel(lmData.region, lmData);
      });
    });
  }

  showTooltip(text, e) {
    if (!this.tooltip) return;
    this.tooltip.textContent = text;
    if (e) {
      this.tooltip.style.left = `${e.clientX}px`;
      this.tooltip.style.top = `${e.clientY}px`;
    }
    this.tooltip.classList.add('visible');
  }

  hideTooltip() {
    if (!this.tooltip) return;
    this.tooltip.classList.remove('visible');
  }

  openInfoPanel(regionId, landmarkData = null) {
    const data = WORLD_DATA.regions[regionId];
    if (!data) return;

    this.activeRegionId = regionId;

    // 패널 내부 콘텐츠 채우기
    const container = document.getElementById('panel-content');
    if (!container) return;

    // 야간 모드일 때 황해 경고 특수 문구 생성
    let warningHtml = '';
    if (regionId === 'hwanghae') {
      warningHtml = `
        <div class="panel-warning">
          <span>⚠️</span>
          <div>
            <strong>야간 해수(괴수) 출몰 경고:</strong><br/>
            밤에는 심해 괴수가 솟구치므로 야간 횡단은 자살 행위입니다.
          </div>
        </div>
      `;
    }

    // 랜드마크를 클릭한 경우 랜드마크 안내 박스 추가
    let landmarkHtml = '';
    if (landmarkData) {
      landmarkHtml = `
        <div style="margin-bottom: 14px; padding: 10px; background: rgba(212,175,55,0.12); border: 1px solid var(--gold-primary); border-radius: 4px;">
          <div style="font-size: 11px; color: var(--gold-light);">[ 선택된 주요 거점 ]</div>
          <div style="font-size: 16px; font-weight: 700; color: #fff;">${landmarkData.name} <span style="font-size: 13px; color: var(--gold-primary);">(${landmarkData.hanja})</span></div>
          <div style="font-size: 12px; color: #cbd5e1; margin-top: 4px;">${landmarkData.desc}</div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="panel-header">
        <span class="panel-direction-badge">[ ${data.direction} · ${data.category} ]</span>
        <div class="panel-title-wrap">
          <h2 class="panel-name">${data.name}</h2>
          <span class="panel-hanja">${data.hanja}</span>
          <span class="seal-stamp">法</span>
        </div>
      </div>

      ${landmarkHtml}

      <div class="panel-summary-quote">
        "${data.summary}"
      </div>

      <table class="panel-meta-table">
        <tr>
          <td class="meta-label">지배 세력</td>
          <td class="meta-val">${data.ruler}</td>
        </tr>
        <tr>
          <td class="meta-label">위험 등급</td>
          <td class="meta-val" style="color: #f87171; font-weight: 700;">${data.dangerLevel}</td>
        </tr>
      </table>

      <div class="panel-desc">
        ${data.description}
      </div>

      <div class="panel-traits-title">◈ 핵심 세계관 특성</div>
      <ul class="panel-traits-list">
        ${data.traits.map(t => `<li>${t}</li>`).join('')}
      </ul>

      ${warningHtml}
    `;

    this.infoPanel.classList.add('active');
  }

  closeInfoPanel() {
    this.infoPanel.classList.remove('active');
    this.activeRegionId = null;
  }

  bindControls() {
    // 족자 패널 닫기 버튼
    const closeBtn = document.getElementById('btn-close-scroll');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeInfoPanel());
    }

    // 뷰포트 바깥 클릭 시 패널 닫기 (선택적)
    this.viewport.addEventListener('click', (e) => {
      if (!e.target.closest('.region-polygon') && !e.target.closest('.map-marker') && !e.target.closest('#info-panel')) {
        // 배경 클릭 시 족자 패널 닫기
        // this.closeInfoPanel();
      }
    });

    // 퀵 네비게이션 버튼
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        navButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const regionKey = btn.dataset.target;
        if (regionKey === 'all') {
          this.fitToScreen();
          this.closeInfoPanel();
        } else {
          this.focusRegion(regionKey);
        }
      });
    });

    // 주야간 전환 토글
    const dayNightBtn = document.getElementById('btn-daynight');
    if (dayNightBtn) {
      dayNightBtn.addEventListener('click', () => {
        this.toggleDayNight();
      });
    }

    // 뷰 초기화 버튼
    const resetBtn = document.getElementById('btn-reset-view');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.fitToScreen();
      });
    }
  }

  focusRegion(regionKey) {
    const coords = {
      hwanghae: { x: 760, y: 650, scale: 1.45 },
      yuryeonggok: { x: 660, y: 280, scale: 1.45 },
      churadae: { x: 380, y: 620, scale: 1.45 },
      myeongjogung: { x: 1050, y: 680, scale: 1.35 },
      heuksadang: { x: 720, y: 950, scale: 1.45 }
    };

    const target = coords[regionKey];
    if (target) {
      this.panTo(target.x, target.y, target.scale);
      this.openInfoPanel(regionKey);
    }
  }

  toggleDayNight() {
    this.isNight = !this.isNight;
    const btn = document.getElementById('btn-daynight');

    if (this.isNight) {
      this.mainScreen.classList.add('night-mode');
      if (btn) {
        btn.classList.add('night');
        btn.innerHTML = '<span>🌙 야간 (괴수 주의)</span>';
      }
    } else {
      this.mainScreen.classList.remove('night-mode');
      if (btn) {
        btn.classList.remove('night');
        btn.innerHTML = '<span>☀️ 주간 모드</span>';
      }
    }

    // 현재 열린 패널이 황해라면 내용 갱신
    if (this.activeRegionId === 'hwanghae') {
      this.openInfoPanel('hwanghae');
    }
  }
}
