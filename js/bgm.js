// ==========================================================================
// 황량계 배경음악 플레이어 (GNB 로고 옆)
//  - 브라우저는 사용자 조작 없는 소리 자동재생을 막으므로, 인트로를 클릭(=사용자 조작)하는
//    순간 start() 를 불러 재생합니다. 안개가 걷히는 동안 소리가 서서히 커집니다.
//  - 사용자가 꺼 두면 그 선택을 기억해 다음 방문 때 자동재생하지 않습니다.
// ==========================================================================

class BgmPlayer {
  constructor({ src, title, volume = 0.5 }) {
    this.audio = document.getElementById('bgm-audio');
    this.root = document.getElementById('bgm-player');
    this.button = document.getElementById('btn-bgm');
    this.targetVolume = volume;
    this.fadeId = null;
    this.storageKey = 'shadowland:bgm-off';
    this.volumeKey = 'shadowland:bgm-volume';
    this.slider = document.getElementById('bgm-volume');

    if (!this.audio || !this.button) return;
    this.audio.src = encodeURI(src);
    this.audio.volume = 0;
    document.getElementById('bgm-title').textContent = title;
    this.button.title = title;

    this.button.addEventListener('click', () => this.toggle());
    this.audio.addEventListener('play', () => this.render(true));
    this.audio.addEventListener('pause', () => this.render(false));
    this.audio.addEventListener('error', () => this.root.classList.add('is-error'));

    // 볼륨 슬라이더 — 마지막으로 맞춘 값을 기억합니다
    const saved = this.readNumber(this.volumeKey);
    if (saved !== null) this.targetVolume = saved;
    if (this.slider) {
      this.slider.value = Math.round(this.targetVolume * 100);
      this.paintSlider();
      this.slider.addEventListener('input', () => this.setVolume(this.slider.value / 100));
    }
  }

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

  // 사용자가 예전에 음악을 꺼 두었는지 (저장소를 못 쓰는 환경이면 '안 꺼둠'으로 취급)
  get userTurnedOff() {
    try { return localStorage.getItem(this.storageKey) === '1'; } catch { return false; }
  }

  set userTurnedOff(off) {
    try { off ? localStorage.setItem(this.storageKey, '1') : localStorage.removeItem(this.storageKey); } catch { /* 무시 */ }
  }

  // 인트로 클릭 직후 호출 — 꺼 둔 적이 없으면 서서히 재생
  start() {
    if (!this.audio || this.userTurnedOff) return;
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
