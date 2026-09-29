// ==========================================================================
// Google Material Icons SVG Loader & Manager
// ==========================================================================

const IconManager = {
  icons: {},
  isLoaded: false,

  /**
   * data/icons.json 파일에서 아이콘 SVG 맵을 비동기로 로드합니다.
   */
  async init() {
    try {
      const response = await fetch('data/icons.json');
      if (response.ok) {
        this.icons = await response.json();
        this.isLoaded = true;
        this.renderAll();
      }
    } catch (e) {
      console.warn('IconManager: icons.json 로드 실패 (기본 인라인 SVG 유지):', e);
    }
  },

  /**
   * 지정된 이름의 아이콘 SVG 문자열을 반환합니다.
   * @param {string} name - 아이콘 이름 (예: 'ads_click', 'touch_app', 'explore' 등)
   * @returns {string|null}
   */
  get(name) {
    return this.icons[name] || null;
  },

  /**
   * [data-icon] 속성을 가진 모든 DOM 요소에 해당 아이콘 SVG를 렌더링합니다.
   */
  renderAll() {
    document.querySelectorAll('[data-icon]').forEach(el => {
      const iconKey = el.getAttribute('data-icon');
      if (this.icons[iconKey]) {
        el.innerHTML = this.icons[iconKey];
      }
    });
  },

  /**
   * 특정 요소의 아이콘을 동적으로 교체합니다.
   * @param {string|HTMLElement} target - 셀렉터 또는 DOM 요소
   * @param {string} iconKey - 새로 적용할 아이콘 이름
   */
  setIcon(target, iconKey) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (el && this.icons[iconKey]) {
      el.setAttribute('data-icon', iconKey);
      el.innerHTML = this.icons[iconKey];
    }
  }
};

// 페이지 로드 시 아이콘 자동 초기화
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => IconManager.init());
} else {
  IconManager.init();
}
