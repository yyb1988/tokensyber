let onLockSet = null;
let onUnlockSuccess = null;

export function init() {
  const modal = document.getElementById('lock-modal');
  const btnCancel = document.getElementById('btn-lock-cancel');
  const btnConfirm = document.getElementById('btn-lock-confirm');
  const backdrop = modal.querySelector('.modal-backdrop');

  btnCancel.addEventListener('click', hideModal);
  backdrop.addEventListener('click', hideModal);
  btnConfirm.addEventListener('click', handleConfirm);
}

export function showLockModal(callback) {
  onLockSet = callback;
  const modal = document.getElementById('lock-modal');
  const title = document.getElementById('lock-modal-title');
  const desc = document.getElementById('lock-modal-desc');
  const confirmGroup = document.getElementById('confirm-group');
  const passwordInput = document.getElementById('lock-password');
  const confirmInput = document.getElementById('lock-confirm');
  const errorEl = document.getElementById('lock-error');

  title.textContent = '锁定模型';
  desc.textContent = '设置密码后，重新生成需要输入密码确认';
  confirmGroup.classList.remove('hidden');
  passwordInput.value = '';
  confirmInput.value = '';
  passwordInput.type = 'password';
  errorEl.classList.add('hidden');

  modal.classList.remove('hidden');
  passwordInput.focus();
}

export function showUnlockModal(callback) {
  onUnlockSuccess = callback;
  const modal = document.getElementById('lock-modal');
  const title = document.getElementById('lock-modal-title');
  const desc = document.getElementById('lock-modal-desc');
  const confirmGroup = document.getElementById('confirm-group');
  const passwordInput = document.getElementById('lock-password');
  const confirmInput = document.getElementById('lock-confirm');
  const errorEl = document.getElementById('lock-error');

  title.textContent = '解锁模型';
  desc.textContent = '请输入密码以解锁模型';
  confirmGroup.classList.add('hidden');
  passwordInput.value = '';
  confirmInput.value = '';
  passwordInput.type = 'password';
  errorEl.classList.add('hidden');

  modal.classList.remove('hidden');
  passwordInput.focus();
}

function hideModal() {
  document.getElementById('lock-modal').classList.add('hidden');
  onLockSet = null;
  onUnlockSuccess = null;
}

async function handleConfirm() {
  const password = document.getElementById('lock-password').value;
  const confirm = document.getElementById('lock-confirm').value;
  const errorEl = document.getElementById('lock-error');
  const isLockMode = !document.getElementById('confirm-group').classList.contains('hidden');

  if (isLockMode) {
    // 设置密码模式
    if (password.length < 4) {
      showError(errorEl, '密码至少4位');
      return;
    }
    if (password !== confirm) {
      showError(errorEl, '两次密码不一致');
      return;
    }
    const hash = await hashPassword(password);
    if (onLockSet) onLockSet(hash);
    hideModal();
  } else {
    // 解锁模式
    const hash = await hashPassword(password);
    if (onUnlockSuccess) {
      const success = onUnlockSuccess(hash);
      if (success) {
        hideModal();
      }
    }
  }
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
  // 抖动
  const input = document.getElementById('lock-password');
  input.classList.add('shake');
  setTimeout(() => input.classList.remove('shake'), 400);
}

export async function hashPassword(password) {
  try {
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    // 降级简单哈希
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
      hash = ((hash << 5) - hash) + password.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(64, '0');
  }
}
