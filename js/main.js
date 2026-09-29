// ==========================================================================
// 황량계 웹 애플리케이션 진입점 (main.js)
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  // 1. 메인 지도 인스턴스 생성
  const fantasyMap = new FantasyMap();

  // 2. 인트로 매니저 생성 및 연동
  const introManager = new IntroManager(() => {
    // 안개가 걷힐 때 살짝 줌인되면서 지도가 등장하는 연출
    setTimeout(() => {
      fantasyMap.panTo(760, 650, 1.05);
    }, 400);
  });

  // 3. '안개 다시 덮기' 버튼 이벤트 연결
  const refogBtn = document.getElementById('btn-refog');
  if (refogBtn) {
    refogBtn.addEventListener('click', () => {
      introManager.resetIntro();
    });
  }

  // 4. 세계관 모달 토글
  const loreBtn = document.getElementById('btn-lore-modal');
  const loreModal = document.getElementById('lore-modal');
  const closeLoreBtn = document.getElementById('btn-close-lore');

  if (loreBtn && loreModal) {
    loreBtn.addEventListener('click', () => {
      loreModal.classList.add('visible');
    });
  }

  if (closeLoreBtn && loreModal) {
    closeLoreBtn.addEventListener('click', () => {
      loreModal.classList.remove('visible');
    });
  }

  if (loreModal) {
    loreModal.addEventListener('click', (e) => {
      if (e.target === loreModal) {
        loreModal.classList.remove('visible');
      }
    });
  }

  // 5. 등장인물 모달 토글
  const charBtn = document.getElementById('btn-characters-modal');
  const charModal = document.getElementById('characters-modal');
  const closeCharBtn = document.getElementById('btn-close-characters');

  if (charBtn && charModal) {
    charBtn.addEventListener('click', () => {
      charModal.classList.add('visible');
    });
  }

  if (closeCharBtn && charModal) {
    closeCharBtn.addEventListener('click', () => {
      charModal.classList.remove('visible');
    });
  }

  if (charModal) {
    charModal.addEventListener('click', (e) => {
      if (e.target === charModal) {
        charModal.classList.remove('visible');
      }
    });
  }
});
