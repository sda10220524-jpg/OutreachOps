export function toast(message) {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

export function modal(contentHtml, onClose) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal"><div class="modal-body">${contentHtml}</div></div>`;
  root.querySelector('[data-close]')?.addEventListener('click', () => {
    root.innerHTML = '';
    onClose?.();
  });
  return root;
}

export function bindTabs(onTab) {
  document.querySelectorAll('.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
      document.getElementById(btn.dataset.tab).classList.add('active');
      onTab(btn.dataset.tab);
    });
  });
}
