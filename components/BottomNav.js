// BottomNav.js - Bottom navigation bar
import { icon } from '../utils/icons.js';

export default function renderBottomNav(state) {
  const nav = document.createElement('nav');
  nav.style.cssText = `
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--slate-800);
    border-top: 1px solid var(--slate-700);
    display: flex;
    justify-content: space-around;
    padding: 0.5rem 0;
    z-index: 100;
  `;

  const items = [
    { id: 'home', icon: 'house', label: 'Home' },
    { id: 'programs', icon: 'listBullets', label: 'Programs' },
    { id: 'history', icon: 'clockCounterClockwise', label: 'History' }
  ];

  nav.innerHTML = items.map(item => `
    <button 
      data-nav="${item.id}"
      style="
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
        background: none;
        border: none;
        padding: 0.5rem;
        cursor: pointer;
        color: ${state.view === item.id ? 'var(--primary)' : 'var(--text-muted)'};
        transition: color 0.2s;
      "
    >
      ${icon(item.icon, 'nav-icon')}
      <span style="font-size: 0.75rem;">${item.label}</span>
    </button>
  `).join('');

  // Add event listeners
  setTimeout(() => {
    nav.querySelectorAll('[data-nav]').forEach(btn => {
      btn.onclick = () => {
        const view = btn.dataset.nav;
        window.dispatchEvent(new CustomEvent(`nav:${view}`));
      };
    });
  }, 0);

  return nav;
}