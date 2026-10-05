// ==========================================================================
// 황량계 배경음악 플레이어 (GNB 로고 옆)
//  - 브라우저는 사용자 조작 없는 소리 자동재생을 막으므로, 인트로를 클릭(=사용자 조작)하는
//    순간 start() 를 불러 재생합니다. 안개가 걷히는 동안 소리가 서서히 커집니다.
//  - 사용자가 꺼 두면 그 선택을 기억해 다음 방문 때 자동재생하지 않습니다.
//  - 곡 목록(data.js 의 bgm.tracks)을 위에서부터 차례로 재생하고, 끝나면 첫 곡으로 돌아갑니다.
//  - 곡 제목을 누르면 아래로 목록이 펼쳐지고, 원하는 곡을 골라 바로 들을 수 있습니다.
// ==========================================================================

class BgmPlayer {
  constructor({ tracks, src, title, volume = 0.5 }) {
    this.audio = document.getElementById('bgm-audio');
    this.root = document.getElementById('bgm-player');
    this.button = document.getElementById('btn-bgm');
    this.titleBtn = document.getElementById('bgm-title-btn');
    this.titleText = document.getElementById('bgm-title');
    this.list = document.getElementById('bgm-list');
    this.slider = document.getElementById('bgm-volume');
    this.targetVolume = volume;
    this.fadeId = null;
    this.storageKey = 'shadowland:bgm-off';
    this.volumeKey = 'shadowland:bgm-volume';

    // 예전 형식(src/title 한 곡)도 그대로 받아 줍니다
    this.tracks = (tracks && tracks.length ? tracks : [{ src, title }]).filter(t => t && t.src);
    this.index = 0;
    this.failed = new Set();   // 불러오지 못한 곡 — 모두 실패하면 플레이어를 숨깁니다

    if (!this.audio || !this.button || !this.tracks.length) return;
    this.audio.volume = 0;
    this.load(0);
    this.buildList();

    this.button.addEventListener('click', () => this.toggle());
    this.audio.addEventListener('play', () => this.render(true));
    this.audio.addEventListener('pause', () => this.render(false));
    this.audio.addEventListener('ended', () => this.next());
    this.audio.addEventListener('error', () => this.handleError());

    // 곡 목록 열고 닫기
    if (this.titleBtn && this.list) {
      this.titleBtn.addEventListener('click', () => this.setListOpen(this.list.hidden));
      document.addEventListener('pointerdown', (e) => {
        if (!this.list.hidden && !this.root.contains(e.target)) this.setListOpen(false);
      });
      this.root.addEventListener('keydown', (e) => this.onListKey(e));
    }

    // 볼륨 슬라이더 — 마지막으로 맞춘 값을 기억합니다
    const saved = this.readNumber(this.volumeKey);
    if (saved !== null) this.targetVolume = saved;
    if (this.slider) {
      this.slider.value = Math.round(this.targetVolume * 100);
      this.paintSlider();
      this.slider.addEventListener('input', () => this.setVolume(this.slider.value / 100));
    }
  }

  // ---- 곡 목록 -------------------------------------------------------------

  load(i) {
    this.index = (i + this.tracks.length) % this.tracks.length;
    const track = this.tracks[this.index];
    this.audio.src = encodeURI(track.src);
    if (this.titleText) this.titleText.textContent = track.title;
    if (this.titleBtn) this.titleBtn.title = `${track.title} — 곡 목록 보기`;
    this.button.title = track.title;
    this.markCurrent();
  }

  buildList() {
    if (!this.list) return;
    this.list.innerHTML = '';
    this.tracks.forEach((track, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bgm-track';
      btn.setAttribute('role', 'option');
      btn.dataset.index = String(i);
      btn.innerHTML = `<span class="bgm-track-no">${String(i + 1).padStart(2, '0')}</span><span class="bgm-track-title"></span>`;
      btn.querySelector('.bgm-track-title').textContent = track.title;
      btn.addEventListener('click', () => {
        this.select(i);
        this.setListOpen(false);
        this.titleBtn.focus();
      });
      li.appendChild(btn);
      this.list.appendChild(li);
    });
    this.markCurrent();
  }

  markCurrent() {
    if (!this.list) return;
    this.list.querySelectorAll('.bgm-track').forEach((btn) => {
      const on = Number(btn.dataset.index) === this.index;
      btn.classList.toggle('is-current', on);
      btn.setAttribute('aria-selected', String(on));
    });
  }

  // 목록에서 곡을 고르면 — 지금 곡이면 재생만, 다른 곡이면 바꿔서 재생
  select(i) {
    const changed = i !== this.index;
    if (changed) this.load(i);
    else if (!this.audio.paused && this.audio.volume > 0) return;   // 이미 재생 중인 곡
    this.userTurnedOff = false;
    this.play();
  }

  // 다음 곡으로 (마지막 곡 다음은 첫 곡)
  next() {
    const wasPlaying = !this.audio.paused || this.audio.ended;
    this.load(this.index + 1);
    if (wasPlaying) {
      const p = this.audio.play();
      if (p && p.catch) p.catch(() => this.render(false));
      this.audio.volume = this.targetVolume;
    }
  }

  handleError() {
    this.failed.add(this.index);
    if (this.failed.size >= this.tracks.length) {
      this.root.classList.add('is-error');
      return;
    }
    // 못 불러온 곡은 건너뜁니다
    const playing = this.root.classList.contains('is-playing');
    this.load(this.index + 1);
    if (playing) this.play(300);
  }

  setListOpen(open) {
    if (!this.list || !this.titleBtn) return;
    this.list.hidden = !open;
    this.titleBtn.setAttribute('aria-expanded', String(open));
    this.root.classList.toggle('is-list-open', open);
    if (open) {
      const current = this.list.querySelector('.bgm-track.is-current') || this.list.querySelector('.bgm-track');
      if (current) current.focus({ preventScroll: true });
    }
  }

  // 목록 안에서 ↑↓ 로 이동, Esc 로 닫기
  onListKey(e) {
    if (this.list.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.setListOpen(false);
      this.titleBtn.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...this.list.querySelectorAll('.bgm-track')];
    const at = items.indexOf(document.activeElement);
    if (at === -1) return;
    e.preventDefault();
    const to = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[to].focus();
  }

  // ---- 볼륨 ---------------------------------------------------------------

  readNumber(key) {
    try {
      const v = parseFloat(localStorage.getItem(key));
      return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : null;
    } catch { return null; }
  }

  setVolume(v) {
    this.targetVolume = v;
    try { localStorage.setItem(this.volumeKey, String(v)); } catch { /* 무시 */ }
    this.paintSlider();
    // 재생 중이면 바로 반영 (페이드 중이었다면 멈추고 새 값으로)
    if (!this.audio.paused) {
      cancelAnimationFrame(this.fadeId);
      this.audio.volume = v;
    }
  }

  // 슬라이더의 채워진 부분 + 0일 때 음소거 표시
  paintSlider() {
    if (!this.slider) return;
    this.slider.style.setProperty('--fill', `${this.slider.value}%`);
    this.root.classList.toggle('is-muted', Number(this.slider.value) === 0);
  }

  // ---- 재생 / 정지 ---------------------------------------------------------

  // 사용자가 예전에 음악을 꺼 두었는지 (저장소를 못 쓰는 환경이면 '안 꺼둠'으로 취급)
  get userTurnedOff() {
    try { return localStorage.getItem(this.storageKey) === '1'; } catch { return false; }
  }

  set userTurnedOff(off) {
    try { off ? localStorage.setItem(this.storageKey, '1') : localStorage.removeItem(this.storageKey); } catch { /* 무시 */ }
  }

  // 인트로 클릭 직후 호출 — 꺼 둔 적이 없으면 서서히 재생
  start() {
    if (!this.audio || !this.tracks.length || this.userTurnedOff) return;
    this.play(2400);
  }

  play(fadeMs = 600) {
    this.audio.volume = 0;
    const p = this.audio.play();
    if (p && p.catch) p.catch(() => this.render(false));   // 막히면 정지 상태로 표시만
    this.fadeTo(this.targetVolume, fadeMs);
  }

  pause(fadeMs = 400) {
    this.fadeTo(0, fadeMs, () => this.audio.pause());
  }

  toggle() {
    const playing = !this.audio.paused && this.audio.volume > 0;
    if (playing) {
      this.userTurnedOff = true;
      this.pause();
    } else {
      this.userTurnedOff = false;
      this.play();
    }
  }

  fadeTo(target, ms, done) {
    cancelAnimationFrame(this.fadeId);
    const from = this.audio.volume;
    const t0 = performance.now();
    const step = (now) => {
      const k = ms > 0 ? Math.min((now - t0) / ms, 1) : 1;
      this.audio.volume = Math.max(0, Math.min(1, from + (target - from) * k));
      if (k < 1) this.fadeId = requestAnimationFrame(step);
      else if (done) done();
    };
    this.fadeId = requestAnimationFrame(step);
  }

  render(playing) {
    this.root.classList.toggle('is-playing', playing);
    this.button.setAttribute('aria-pressed', String(playing));
    this.button.setAttribute('aria-label', playing ? '배경음악 끄기' : '배경음악 재생');
  }
}
