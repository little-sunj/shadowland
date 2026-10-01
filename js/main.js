// ==========================================================================
// 황량계 웹 애플리케이션 진입점 (main.js)
// ==========================================================================

// ------------------------------------------------------------------
// 모달 본문 생성 (js/data.js → 세계관 / 등장인물)
// ------------------------------------------------------------------
function renderLoreModal(data) {
  const e = escapeHtml;
  const sections = data.loreOrder.map((id) => {
    const r = data.regions[id] || data.sites[id];   // 구역(황해)과 지점을 함께 나열
    if (!r) return '';
    const title = r.loreTitle || `${r.direction}: ${r.name} (${r.hanja})`;
    // loreBullets 는 <strong> 강조를 위해 데이터 작성자가 직접 쓴 HTML 을 허용합니다
    return `
      <h3>◈ ${e(title)}</h3>
      <ul>${r.loreBullets.map((b) => `<li>${b}</li>`).join('')}</ul>`;
  }).join('');

  return `
    <p><strong>${e(data.worldName)}(${e(data.worldHanja)})</strong>는 ${e(data.worldDescription)}</p>
    ${sections}`;
}

function renderCharactersModal(data) {
  const e = escapeHtml;
  const people = data.characters.map((c) => `
    <h3>◈ ${e(c.heading)}</h3>
    <ul>
      <li><strong>지위:</strong> ${e(c.position)}</li>
      <li><strong>특징:</strong> ${e(c.traits)}</li>
    </ul>`).join('');

  return `
    <p><strong>${e(data.worldName)}(${e(data.worldHanja)})</strong>${e(data.charactersIntro)}</p>
    ${people}`;
}

// ------------------------------------------------------------------
// 접근 가능한 모달: 열 때 포커스 이동, Tab 가두기, Esc 로 닫기, 닫으면 원래 버튼으로 복귀
// ------------------------------------------------------------------
class Modal {
  constructor(el, openButton) {
    this.el = el;
    this.openButton = openButton;
    this.lastFocus = null;
    this.closeTimer = null;

    openButton.addEventListener('click', () => this.open());
    el.querySelectorAll('[data-close-modal]').forEach((btn) => btn.addEventListener('click', () => this.close()));
    el.addEventListener('click', (ev) => {
      if (ev.target === el) this.close();          // 바깥(어두운 배경) 클릭
    });
    el.addEventListener('keydown', (ev) => this.trapFocus(ev));
  }

  isOpen() {
    return !this.el.hidden;
  }

  open() {
    clearTimeout(this.closeTimer);
    this.lastFocus = document.activeElement;
    this.el.hidden = false;
    void this.el.offsetWidth;                      // 페이드 인 트랜지션 시작용 리플로우
    this.el.classList.add('visible');
    const closeBtn = this.el.querySelector('[data-close-modal]');
    if (closeBtn) closeBtn.focus({ preventScroll: true });
    this.el.querySelector('.modal-body').scrollTop = 0;
  }

  close() {
    if (!this.isOpen()) return;
    this.el.classList.remove('visible');
    this.closeTimer = setTimeout(() => { this.el.hidden = true; }, 300);
    if (this.lastFocus && document.contains(this.lastFocus)) {
      this.lastFocus.focus({ preventScroll: true });
    }
  }

  trapFocus(ev) {
    if (ev.key !== 'Tab') return;
    const focusables = [...this.el.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')]
      .filter((n) => !n.disabled);
    // 스크롤되는 본문도 키보드로 내릴 수 있도록 포함
    const body = this.el.querySelector('.modal-body');
    if (body && !focusables.includes(body)) focusables.push(body);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  }
}

// ------------------------------------------------------------------
// 초기화
// ------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const mainScreen = document.getElementById('main-screen');
  const viewport = document.getElementById('map-viewport');

  // 1. 지도
  const fantasyMap = new FantasyMap(WORLD_DATA);

  // 2. 인트로 — 안개가 걷히면 지도를 활성화하고 살짝 줌인
  new IntroManager((viaKeyboard) => {
    mainScreen.inert = false;
    if (viaKeyboard) viewport.focus({ preventScroll: true });
    const { intro } = WORLD_DATA.map;
    setTimeout(() => fantasyMap.panTo(intro.x, intro.y, fantasyMap.computeFitScale() * 1.25), 400);
  });

  // 3. 모달
  const loreBody = document.getElementById('lore-modal-body');
  const charBody = document.getElementById('characters-modal-body');
  loreBody.innerHTML = renderLoreModal(WORLD_DATA);
  charBody.innerHTML = renderCharactersModal(WORLD_DATA);
  loreBody.tabIndex = 0;
  charBody.tabIndex = 0;

  const modals = [
    new Modal(document.getElementById('lore-modal'), document.getElementById('btn-lore-modal')),
    new Modal(document.getElementById('characters-modal'), document.getElementById('btn-characters-modal'))
  ];

  // 4. Esc: 열린 모달 → 족자 패널 순으로 닫기
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const openModal = modals.find((m) => m.isOpen());
    if (openModal) {
      openModal.close();
    } else if (fantasyMap.isPanelOpen()) {
      fantasyMap.closeInfoPanel();
      viewport.focus({ preventScroll: true });
    }
  });
});
