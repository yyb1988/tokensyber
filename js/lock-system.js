import { showModal, shakeField, showModalError } from './modal.js';

export function showLockModal(callback, opts = {}) {
  const errorId = 'lock-error-' + Date.now();

  showModal({
    title: opts.title || '锁定模型',
    desc: opts.desc || '设置密码后，重新生成需要输入密码确认',
    fields: [
      { id: 'password', label: '密码', type: 'password', placeholder: '至少4位', autocomplete: 'new-password' },
      { id: 'confirm', label: '确认密码', type: 'password', placeholder: '再次输入', autocomplete: 'new-password' },
    ],
    errorId,
    buttons: [
      { id: 'cancel', text: '取消 (Esc)', style: 'outline', escape: true },
      { id: 'ok', text: '确认 (Enter)', style: 'primary', enter: true },
    ],
  }).then(async (result) => {
    if (result === 'cancel') return;
    const { values } = result;
    if (values.password.length < 4) {
      showModalError(errorId, '密码至少4位');
      shakeField('password');
      return;
    }
    if (values.password !== values.confirm) {
      showModalError(errorId, '两次密码不一致');
      shakeField('password');
      return;
    }
    const hash = await hashPassword(values.password);
    callback(hash);
  });
}

export function showUnlockModal(callback, opts = {}) {
  const errorId = 'unlock-error-' + Date.now();

  showModal({
    title: opts.title || '解锁模型',
    desc: opts.desc || '请输入密码以解锁模型',
    fields: [
      { id: 'password', label: '密码', type: 'password', placeholder: '输入密码', autocomplete: 'current-password' },
    ],
    errorId,
    buttons: [
      { id: 'cancel', text: '取消 (Esc)', style: 'outline', escape: true },
      { id: 'ok', text: '确认 (Enter)', style: 'primary', enter: true },
    ],
  }).then(async (result) => {
    if (result === 'cancel') return;
    const { values } = result;
    const hash = await hashPassword(values.password);
    const success = callback(hash);
    if (!success) {
      showModalError(errorId, '密码错误');
      shakeField('password');
    }
  });
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
