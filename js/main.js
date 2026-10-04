// ==========================================================================
// 황량계 웹 애플리케이션 진입점 (main.js)
// ==========================================================================

// ------------------------------------------------------------------
// 모달 본문 생성 (js/data.js → 세계관 / 등장인물)
// ------------------------------------------------------------------
// 도감 항목 머리 — 낙관 + 소속(세력 색 점) + 이름
function codexHead({ seal, eyebrow, title, hanja }) {
  const e = escapeHtml;
  return `
    <div class="codex-head">
      <span class="seal-stamp" aria-hidden="true">${e(seal)}</span>
      <div>
        <span class="codex-eyebrow">${e(eyebrow)}</span>
        <h3 class="codex-title">${e(title)}${hanja ? `<small lang="zh-Hant">${e(hanja)}</small>` : ''}</h3>
      </div>
    </div>`;
}

function renderLoreModal(data) {
  const e = escapeHtml;
  const cards = data.loreOrder.map((id) => {
    const r = data.regions[id] || data.sites[id];   // 구역(황해)과 지점을 함께 나열
    if (!r) return '';
    // loreBullets 는 <strong> 강조를 위해 데이터 작성자가 직접 쓴 HTML 을 허용합니다
    return `
      <li class="codex-card" style="--faction-color: ${e(r.color)}">
        ${codexHead({ seal: r.seal, eyebrow: r.direction, title: r.loreTitle || r.name, hanja: r.loreTitle ? '' : r.hanja })}
        <ul>${r.loreBullets.map((b) => `<li>${b}</li>`).join('')}</ul>
      </li>`;
  }).join('');

  return `
    <p class="modal-lead"><strong>${e(data.worldName)}</strong>(${e(data.worldHanja)})는 ${e(data.worldDescription)}</p>
    <ul class="codex">${cards}</ul>`;
}

function renderCharactersModal(data) {
  const e = escapeHtml;
  const cards = data.characters.map((c) => {
    const f = data.sites[c.faction] || {};
    return `
      <li class="codex-card" style="--faction-color: ${e(f.color || '')}">
        ${codexHead({ seal: f.seal || '人', eyebrow: `${f.direction || ''} ${f.name || ''}`.trim(), title: c.title })}
        <dl>
          <dt>지위</dt><dd>${e(c.position)}</dd>
          <dt>특징</dt><dd>${e(c.traits)}</dd>
        </dl>
      </li>`;
  }).join('');

  return `
    <p class="modal-lead">${e(data.charactersIntro)}</p>
    <ul class="codex">${cards}</ul>`;
}

// ------------------------------------------------------------------
// 비록(秘錄) 창 — 네이티브 <dialog> + 탭.
// Esc·포커스 가두기·배경 차단·포커스 복귀는 브라우저가 처리하고,
// 여기서는 탭 전환, 닫기 버튼, 바깥(배경) 클릭만 연결합니다.
// ------------------------------------------------------------------
class Codex {
  constructor(dialog) {
    this.dialog = dialog;
    this.tabs = [...dialog.querySelectorAll('[role="tab"]')];

    this.tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => this.select(i));
      // 좌우 방향키로 탭 이동 (WAI-ARIA 탭 패턴)
      tab.addEventListener('keydown', (e) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        const next = (i + step + this.tabs.length) % this.tabs.length;
        this.select(next);
        this.tabs[next].focus();
      });
    });

    dialog.querySelectorAll('[data-close-modal]').forEach((btn) => btn.addEventListener('click', () => dialog.close()));

    // 배경(::backdrop)을 누르면 클릭 대상은 dialog 자신이고 좌표는 창 바깥입니다
    dialog.addEventListener('click', (ev) => {
      if (ev.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      if (!inside) dialog.close();
    });
  }

  select(index) {
    this.tabs.forEach((tab, i) => {
      const on = i === index;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      panel.hidden = !on;
      if (on) panel.scrollTop = 0;
    });
    this.dialog.style.setProperty('--tab-index', index);
  }

  open(tabId) {
    const index = Math.max(0, this.tabs.findIndex((t) => t.id === `tab-${tabId}`));
    this.select(index);
    if (!this.dialog.open) this.dialog.showModal();
    this.tabs[index].focus({ preventScroll: true });
  }
}

// ------------------------------------------------------------------
// 초기화
// ------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const mainScreen = document.getElementById('main-screen');
  const viewport = document.getElementById('map-viewport');

  // 1. 지도 — 인트로 동안에는 살짝 당겨 둔 상태로 대기
  const fantasyMap = new FantasyMap(WORLD_DATA);
  const { intro } = WORLD_DATA.map;
  fantasyMap.prepareReveal(intro.x, intro.y);

  // 2. 배경음악 + 인트로 — 안개를 걷는 클릭(사용자 조작)에서 음악을 켜야 브라우저가 막지 않습니다
  const bgm = new BgmPlayer(WORLD_DATA.bgm);
  new IntroManager((viaKeyboard) => {
    bgm.start();
    mainScreen.inert = false;
    if (viaKeyboard) viewport.focus({ preventScroll: true });
    fantasyMap.reveal();
  });

  // 3. 비록 창 (세계관 / 등장인물 탭)
  document.getElementById('codex-lore').innerHTML = renderLoreModal(WORLD_DATA);
  document.getElementById('codex-people').innerHTML = renderCharactersModal(WORLD_DATA);
  const codex = new Codex(document.getElementById('codex'));
  document.querySelectorAll('[data-open-codex]').forEach((btn) => {
    btn.addEventListener('click', () => codex.open(btn.dataset.openCodex));
  });

  // 4. Esc: 창이 열려 있으면 브라우저가 창만 닫고, 아니면 족자 패널을 닫습니다
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (fantasyMap.isPanelOpen()) {
      fantasyMap.closeInfoPanel();
      viewport.focus({ preventScroll: true });
    }
  });
});
