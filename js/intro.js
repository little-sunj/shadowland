// ==========================================================================
// 황량계 인트로 안개 시뮬레이션 및 양옆 개폐(Parting) 로직
// ==========================================================================

class IntroManager {
  constructor(onIntroComplete) {
    this.onIntroComplete = onIntroComplete;
    this.introScreen = document.getElementById('intro-screen');
    this.canvas = document.getElementById('mist-canvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.particles = [];
    this.isParted = false;
    this.animId = null;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (this.ctx) {
      this.sprite = this.createFogSprite();
      this.resizeCanvas();
      this.initParticles();
      this.startMistAnimation();
      window.addEventListener('resize', () => this.resizeCanvas());
    }

    this.bindEvents();

    // 키보드 사용자가 바로 Enter 로 입장할 수 있도록
    if (this.introScreen) this.introScreen.focus({ preventScroll: true });
  }

  // 안개 한 덩어리를 미리 그려둔 스프라이트 — 매 프레임 그라디언트를 새로 만들지 않습니다
  // 색은 css/style.css 의 --fog-particle-*-rgb, --bg-rgb 변수를 읽어 옵니다
  createFogSprite() {
    const css = getComputedStyle(document.documentElement);
    const rgb = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const core = rgb('--fog-particle-core-rgb', '40, 36, 32');
    const mid = rgb('--fog-particle-mid-rgb', '22, 19, 16');
    const edge = rgb('--bg-rgb', '14, 12, 10');
    const size = 256;
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = size;
    const g = sprite.getContext('2d');
    const half = size / 2;
    const grad = g.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, `rgba(${core}, 1)`);
    grad.addColorStop(0.5, `rgba(${mid}, 0.53)`);
    grad.addColorStop(1, `rgba(${edge}, 0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return sprite;
  }

  resizeCanvas() {
    const prevW = this.canvas.width;
    const prevH = this.canvas.height;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;

    // 화면 크기가 크게 바뀌면 입자 분포/개수를 다시 맞춥니다
    if (this.particles.length && (Math.abs(prevW - this.canvas.width) > 200 || Math.abs(prevH - this.canvas.height) > 200)) {
      this.initParticles();
    }
  }

  particleCount() {
    // 화면 넓이에 비례하되 4K 등에서 과도하게 늘지 않도록 상한을 둡니다
    const n = Math.floor((this.canvas.width * this.canvas.height) / 14000);
    return Math.max(24, Math.min(n, 160));
  }

  initParticles() {
    this.particles = [];
    const count = this.particleCount();
    for (let i = 0; i < count; i++) {
      this.particles.push(this.createParticle(false));
    }
  }

  // fromEdge=true: 화면 좌/우 바깥에서 새로 흘러들어오는 입자
  createParticle(fromEdge) {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const radius = 120 + Math.random() * 220;
    const speed = this.reducedMotion ? 0.15 : 1;
    let x = Math.random() * width;
    let vx = (Math.random() - 0.5) * 0.45 * speed;

    if (fromEdge) {
      const fromLeft = Math.random() < 0.5;
      x = fromLeft ? -radius : width + radius;
      vx = (fromLeft ? 1 : -1) * (0.05 + Math.random() * 0.2) * speed; // 화면 안쪽을 향해
    }

    return {
      x,
      y: Math.random() * height,
      radius,
      vx,
      vy: (Math.random() - 0.5) * 0.25 * speed,
      baseAlpha: 0.12 + Math.random() * 0.2,
      alpha: 0.01,
      fadeSpeed: 0.003 + Math.random() * 0.005,
      fadingIn: true
    };
  }

  isOffscreen(p) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    return p.x < -p.radius * 1.2 || p.x > w + p.radius * 1.2 || p.y < -p.radius * 1.2 || p.y > h + p.radius * 1.2;
  }

  startMistAnimation() {
    const ctx = this.ctx;

    const render = () => {
      const w = this.canvas.width;
      const h = this.canvas.height;
      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < this.particles.length; i++) {
        let p = this.particles[i];

        if (this.isParted) {
          // 걷힐 때: 중앙에서 좌우로 급속 분산
          p.vx += p.x < w / 2 ? -0.8 : 0.8;
          p.alpha *= 0.95;
        } else {
          // 평상시: 알파 호흡 효과
          if (p.fadingIn) {
            p.alpha += p.fadeSpeed;
            if (p.alpha >= p.baseAlpha) p.fadingIn = false;
          } else {
            p.alpha -= p.fadeSpeed;
            if (p.alpha <= 0.02) p.fadingIn = true;
          }
        }

        p.x += p.vx;
        p.y += p.vy;

        // 화면 밖으로 흘러나간 안개는 반대편에서 새로 들어오게 합니다
        if (!this.isParted && this.isOffscreen(p)) {
          p = this.particles[i] = this.createParticle(true);
        }

        ctx.globalAlpha = Math.min(1, p.alpha * 1.5);
        ctx.drawImage(this.sprite, p.x - p.radius, p.y - p.radius, p.radius * 2, p.radius * 2);
      }
      ctx.globalAlpha = 1;

      this.animId = requestAnimationFrame(render);
    };

    render();
  }

  stopMistAnimation() {
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  bindEvents() {
    if (!this.introScreen) return;

    this.introScreen.addEventListener('click', () => this.triggerParting(false));

    this.introScreen.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.triggerParting(true);
      }
    });
  }

  // viaKeyboard: Enter/Space 로 입장했는지 — 키보드 사용자에게만 지도로 포커스를 옮깁니다
  triggerParting(viaKeyboard) {
    if (this.isParted) return;
    this.isParted = true;
    this.introScreen.classList.add('parted');

    if (typeof this.onIntroComplete === 'function') {
      this.onIntroComplete(viaKeyboard);
    }

    // 걷힘 연출이 끝나면 인트로를 완전히 제거
    setTimeout(() => {
      this.introScreen.hidden = true;
      this.stopMistAnimation();
    }, this.reducedMotion ? 50 : 2200);
  }
}
