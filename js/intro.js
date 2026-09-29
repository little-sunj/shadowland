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

    if (this.canvas) {
      this.resizeCanvas();
      this.initParticles();
      this.startMistAnimation();
      window.addEventListener('resize', () => this.resizeCanvas());
    }

    this.bindEvents();
  }

  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  initParticles() {
    this.particles = [];
    const count = Math.floor((window.innerWidth * window.innerHeight) / 14000);
    for (let i = 0; i < count; i++) {
      this.particles.push(this.createParticle());
    }
  }

  createParticle(isNew = false) {
    const width = this.canvas.width;
    const height = this.canvas.height;
    return {
      x: isNew ? (Math.random() < 0.5 ? -100 : width + 100) : Math.random() * width,
      y: Math.random() * height,
      radius: 120 + Math.random() * 220,
      vx: (Math.random() - 0.5) * 0.45,
      vy: (Math.random() - 0.5) * 0.25,
      baseAlpha: 0.12 + Math.random() * 0.2,
      alpha: 0.01,
      fadeSpeed: 0.003 + Math.random() * 0.005,
      fadingIn: true
    };
  }

  startMistAnimation() {
    const render = () => {
      if (!this.ctx) return;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];

        // 안개 분산(Parting) 상태일 때 좌우로 급속 분산
        if (this.isParted) {
          const midX = this.canvas.width / 2;
          if (p.x < midX) {
            p.vx -= 0.8;
          } else {
            p.vx += 0.8;
          }
          p.baseAlpha *= 0.95;
        } else {
          // 일반 상태: 알파 페이드 인/아웃 호흡 효과
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

        // 원형 그라디언트로 부드러운 먹구름/안개 표현
        const grad = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
        grad.addColorStop(0, `rgba(32, 40, 54, ${p.alpha * 1.5})`);
        grad.addColorStop(0.5, `rgba(18, 22, 30, ${p.alpha * 0.8})`);
        grad.addColorStop(1, 'rgba(10, 12, 16, 0)');

        this.ctx.fillStyle = grad;
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        this.ctx.fill();
      }

      this.animId = requestAnimationFrame(render);
    };

    render();
  }

  bindEvents() {
    if (!this.introScreen) return;

    // 클릭 시 구름/안개가 좌우로 걷힘
    this.introScreen.addEventListener('click', () => {
      if (this.isParted) return;
      this.triggerParting();
    });
  }

  triggerParting() {
    this.isParted = true;
    this.introScreen.classList.add('parted');

    // 메인 지도 연계 콜백 호출
    if (typeof this.onIntroComplete === 'function') {
      this.onIntroComplete();
    }

    // 애니메이션 완료 후 화면 가리기
    setTimeout(() => {
      this.introScreen.style.display = 'none';
      if (this.animId) {
        cancelAnimationFrame(this.animId);
      }
    }, 2200);
  }

  // 사용자가 다시 인트로를 보고 싶을 때 (안개 다시 덮기)
  resetIntro() {
    if (!this.introScreen) return;
    this.introScreen.style.display = 'flex';
    // 강제 리플로우
    void this.introScreen.offsetWidth;
    this.isParted = false;
    this.introScreen.classList.remove('parted');
    this.initParticles();
    this.startMistAnimation();
  }
}
