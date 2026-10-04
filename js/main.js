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

// 도감 항목 그림 띠 — image 가 있으면 그 그림, 없으면 지도에서 (x, y) 부근을 잘라 보여 줍니다
function codexThumb(data, item, place) {
  const e = escapeHtml;
  if (item && item.image) {
    return `<div class="codex-thumb" style="background-image:url('${e(item.image)}');background-size:cover;background-position:center"></div>`;
  }
  const { width: W, height: H, image } = data.map;
  const p = place || { x: W / 2, y: H / 2 };
  const zoom = 4;                                     // 지도 가로의 1/4 정도를 띠에 담음
  const viewW = 1 / zoom;                             // 띠에 보이는 지도 가로 비율
  const viewH = (7 / 16) / (zoom * H / W);            // 띠(16:7)에 보이는 지도 세로 비율
  // background-position % : 점 p 가 띠 가운데 오도록 (가장자리에서는 0~100% 로 고정)
  const pos = (f, v) => Math.min(100, Math.max(0, ((f - v / 2) / (1 - v)) * 100)).toFixed(1);
  return `<div class="codex-thumb is-map" style="background-image:url('${e(image)}');background-size:${zoom * 100}% auto;background-position:${pos(p.x / W, viewW)}% ${pos(p.y / H, viewH)}%"></div>`;
}

// 지도 위 위치 — 지점은 핀, 구역은 지명 자리, 그 밖은 소속 거점
function placeOf(data, id, item) {
  if (item.x !== undefined) return { x: item.x, y: item.y };
  if (item.label) return { x: item.label.x, y: item.label.y + 120 };
  const lm = data.landmarks.find((l) => l.parent === id && l.x !== undefined);
  return lm ? { x: lm.x, y: lm.y } : null;
}

// 세계관 창 — 가운데 황해와 네 지역. 지역 카드 안에 그 지역의 세력 거점·거점 목록을 담습니다.
// 장소를 누르면 창을 닫고 지도에서 그곳을 엽니다 (data-goto).
function regionPlaces(data, regionId) {
  const sites = Object.values(data.sites).filter((s) => s.region === regionId && s.x !== undefined);
  const lms = data.landmarks.filter((l) => l.region === regionId);
  return [
    ...sites.map((s) => ({ key: `site:${s.id}`, name: s.name, hanja: s.hanja, tag: s.tag, desc: s.brief, major: true, color: s.color })),
    ...lms.map((l) => ({ key: `landmark:${l.id}`, name: l.name, hanja: l.hanja, tag: l.type, desc: l.desc }))
  ];
}

function placeListHtml(places) {
  const e = escapeHtml;
  if (!places.length) return '';
  return `
    <ul class="place-list">
      ${places.map((p) => `
        <li>
          <button type="button" class="place${p.major ? ' is-major' : ''}" data-goto="${e(p.key)}"${p.color ? ` style="--faction-color: ${e(p.color)}"` : ''}>
            <span class="place-name">${e(p.name)}${p.hanja ? `<small lang="zh-Hant">${e(p.hanja)}</small>` : ''}</span>
            ${p.tag ? `<span class="place-tag">${e(p.tag)}</span>` : ''}
            <span class="place-go" aria-hidden="true">지도</span>
            ${p.desc ? `<span class="place-desc">${e(p.desc)}</span>` : ''}
          </button>
        </li>`).join('')}
    </ul>`;
}

function renderLoreModal(data) {
  const e = escapeHtml;
  const cards = data.loreOrder.map((id) => {
    const r = data.regions[id] || data.sites[id];
    if (!r) return '';
    const isRegion = !!data.regions[id];
    const wide = id === 'hwanghae' || id === 'villages';
    // loreBullets 는 <strong> 강조를 위해 데이터 작성자가 직접 쓴 HTML 을 허용합니다
    const bullets = r.loreBullets ? `<ul>${r.loreBullets.map((b) => `<li>${b}</li>`).join('')}</ul>` : '';
    const brief = r.brief ? `<p class="lore-brief">${e(r.brief)}</p>` : '';
    const places = isRegion ? regionPlaces(data, id) : [];
    return `
      <li class="codex-card${wide ? ' is-wide' : ''}" style="--faction-color: ${e(r.color)}">
        ${codexThumb(data, r, placeOf(data, id, r))}
        ${codexHead({ seal: r.seal, eyebrow: isRegion ? `${r.hanja} · ${r.category}` : r.direction, title: r.loreTitle || r.name, hanja: isRegion || r.loreTitle ? '' : r.hanja })}
        ${brief}${bullets}
        ${places.length ? `<p class="place-list-title">${id === 'hwanghae' ? '이 바다의 장소' : '이 지역의 장소'}</p>${placeListHtml(places)}` : ''}
      </li>`;
  }).join('');

  return `
    <p class="modal-lead"><strong>${e(data.worldName)}</strong>(${e(data.worldHanja)})는 ${e(data.worldDescription)}</p>
    <ul class="codex">${cards}</ul>`;
}

function renderProtagonist(data) {
  const e = escapeHtml;
  const p = data.protagonist;
  if (!p) return '';
  const f = data.sites[p.faction] || {};
  return `
    <article class="hero-card" style="--faction-color: ${e(f.color || '')}">
      <div class="hero-portrait">
        <img src="${e(p.image)}" alt="${e(p.name)}의 초상" decoding="async" onerror="this.parentNode.remove()">
        <span class="hero-watermark" lang="zh-Hant" aria-hidden="true">${[...p.hanja].map((ch) => `<span>${e(ch)}</span>`).join('')}</span>
      </div>
      <div class="hero-body">
        <span class="codex-eyebrow">主人公 · ${e(f.direction || '')} ${e(f.name || '')}</span>
        <h3 class="hero-name">${e(p.name)}<small lang="zh-Hant">${e(p.hanja)}</small></h3>
        <p class="hero-title">${e(p.title)}</p>
        <blockquote class="hero-quote">“${e(p.quote)}”</blockquote>
        <dl class="hero-profile">
          ${p.profile.map(([k, v]) => `<dt>${e(k)}</dt><dd>${e(v)}</dd>`).join('')}
        </dl>
      </div>
      ${p.history ? `
      <details class="hero-history">
        <summary>
          <span class="hero-history-kicker" lang="zh-Hant">前史</span>
          <span class="hero-history-title">${e(p.history.title)}</span>
          <span class="hero-history-toggle" aria-hidden="true"></span>
        </summary>
        <div class="hero-history-text">
          ${p.history.paragraphs.map((t) => `<p>${e(t)}</p>`).join('')}
        </div>
      </details>` : ''}
    </article>`;
}

function renderCharactersModal(data) {
  const e = escapeHtml;
  const cards = data.characterOrder.map((id) => {
    const f = data.sites[id];
    if (!f || !f.members) return '';
    return `
      <li class="codex-card" style="--faction-color: ${e(f.color || '')}">
        ${codexThumb(data, f, placeOf(data, id, f))}
        ${codexHead({ seal: f.seal || '人', eyebrow: f.direction || '', title: f.name, hanja: f.hanja })}
        ${f.stance ? `<p class="stance"><span class="stance-label">연묵과의 관계</span>${e(f.stance)}</p>` : ''}
        ${memberListHtml(f.members)}
      </li>`;
  }).join('');

  return `
    <p class="modal-lead">${e(data.charactersIntro)}</p>
    ${renderProtagonist(data)}
    <h3 class="codex-section-title"><span lang="zh-Hant">勢力人物</span>세력별 인물</h3>
    <ul class="codex">${cards}</ul>`;
}

// 괴수 창 — 지역별로 묶고, 지역 이름을 누르면 지도에서 그 지역을 엽니다
function renderBeastsModal(data) {
  const e = escapeHtml;
  const order = ['hwanghae', 'north', 'west', 'east', 'south'];
  const groups = order.map((rid) => {
    const r = data.regions[rid];
    const list = data.beasts.filter((b) => b.region === rid);
    if (!r || !list.length) return '';
    return `
      <section class="beast-group" style="--faction-color: ${e(r.color)}">
        <h3 class="codex-section-title">
          <span lang="zh-Hant">${e(r.hanja)}</span>
          <button type="button" class="beast-region" data-goto="region:${e(rid)}">${e(r.name)}<span aria-hidden="true">지도 →</span></button>
        </h3>
        <ul class="beast-list">
          ${list.map((b) => `
            <li class="beast">
              <p class="beast-head">
                <span class="beast-name">${e(b.name)}<small lang="zh-Hant">${e(b.hanja)}</small></span>
                <span class="beast-habitat">${e(b.habitat)}</span>
              </p>
              <p class="beast-lead">${e(b.traits[0])}</p>
              <ul class="beast-traits">${b.traits.slice(1).map((t) => `<li>${e(t)}</li>`).join('')}</ul>
            </li>`).join('')}
        </ul>
      </section>`;
  }).join('');
  return `
    <p class="modal-lead">${e(data.beastsIntro)}</p>
    ${groups}`;
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
  document.getElementById('codex-beasts').innerHTML = renderBeastsModal(WORLD_DATA);
  const codex = new Codex(document.getElementById('codex'));
  document.querySelectorAll('[data-open-codex]').forEach((btn) => {
    btn.addEventListener('click', () => codex.open(btn.dataset.openCodex));
  });
  // 세계관 창의 장소 → 창을 닫고 지도에서 그곳의 족자를 엽니다
  codex.dialog.addEventListener('click', (ev) => {
    const go = ev.target.closest('[data-goto]');
    if (!go) return;
    codex.dialog.close();
    fantasyMap.handlePanelLink(go.dataset.goto);
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
