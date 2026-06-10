/**
 * 通用模态框系统 — 替代 index.html 中 4 份重复模板
 *
 * 用法:
 *   import { showModal } from './modal.js';
 *   const result = await showModal({
 *     title: '确认操作',
 *     desc: '确定要删除吗？',
 *     fields: [{ id: 'name', label: '名称', type: 'text' }],
 *     buttons: [
 *       { id: 'cancel', text: '取消', style: 'outline', escape: true },
 *       { id: 'ok', text: '确认', style: 'primary', enter: true },
 *     ],
 *     bodyHtml: '<div class="list">...</div>',  // 可选：自定义 body 区域
 *     wide: false,  // true → max-width: 600px
 *   });
 *   // result = 'ok' | 'cancel' | 按钮id
 *   // 若有 fields, result = { action: 'ok', values: { name: '...' } }
 */

let activeModal = null;
let resolvePromise = null;
let currentFields = null;

/**
 * 显示模态框，返回 Promise，resolve 值为按钮 id（或有 fields 时为 {action, values}）
 */
export function showModal(opts = {}) {
  // 如果已有打开的模态框，先关闭
  if (activeModal) closeModal('cancel');

  const {
    title = '',
    desc = '',
    fields = [],      // { id, label, type, placeholder, autocomplete }
    buttons = [],     // { id, text, style, escape, enter, disabled }
    bodyHtml = '',    // 自定义 body 区域 HTML
    wide = false,
    errorId = null,   // 若提供，自动生成 error 区域
  } = opts;

  currentFields = fields;

  const el = document.createElement('div');
  el.className = 'modal';
  el.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-content${wide ? ' modal-content-wide' : ''}">
      <h3 class="modal-title">${title}</h3>
      ${desc ? `<p class="modal-desc">${desc}</p>` : ''}
      ${fields.map(f => `
        <div class="form-group">
          <label for="modal-field-${f.id}">${f.label}</label>
          <input type="${f.type || 'text'}" id="modal-field-${f.id}"
                 placeholder="${f.placeholder || ''}"
                 autocomplete="${f.autocomplete || 'off'}">
        </div>
      `).join('')}
      ${errorId ? `<div id="${errorId}" class="error-text hidden"></div>` : ''}
      ${bodyHtml ? `<div class="modal-body">${bodyHtml}</div>` : ''}
      <div class="modal-buttons">
        ${buttons.map(b => `
          <button id="modal-btn-${b.id}" class="btn btn-${b.style || 'outline'}"
                  ${b.disabled ? 'disabled' : ''}>${b.text}</button>
        `).join('')}
      </div>
    </div>
  `;

  document.body.appendChild(el);
  activeModal = el;

  // 聚焦第一个输入框
  const firstInput = el.querySelector('input');
  if (firstInput) {
    setTimeout(() => firstInput.focus(), 50);
  }

  // 返回 Promise
  return new Promise((resolve) => {
    resolvePromise = resolve;

    // 按钮
    buttons.forEach(b => {
      const btn = el.querySelector(`#modal-btn-${b.id}`);
      if (!btn) return;
      btn.addEventListener('click', () => {
        if (fields.length > 0) {
          const values = {};
          fields.forEach(f => {
            const input = el.querySelector(`#modal-field-${f.id}`);
            values[f.id] = input ? input.value : '';
          });
          resolve({ action: b.id, values });
        } else {
          resolve(b.id);
        }
        closeModal();
      });
    });

    // backdrop 点击 = 取消
    const backdrop = el.querySelector('.modal-backdrop');
    backdrop.addEventListener('click', () => {
      resolve('cancel');
      closeModal();
    });

    // 键盘
    el._keyHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        resolve('cancel');
        closeModal();
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const enterBtn = buttons.find(b => b.enter);
        if (enterBtn) {
          const btn = el.querySelector(`#modal-btn-${enterBtn.id}`);
          if (btn && !btn.disabled) btn.click();
        }
      }
    };
    document.addEventListener('keydown', el._keyHandler);
  });
}

/** 关闭当前模态框 */
function closeModal() {
  if (!activeModal) return;
  if (activeModal._keyHandler) {
    document.removeEventListener('keydown', activeModal._keyHandler);
  }
  activeModal.remove();
  activeModal = null;
  resolvePromise = null;
  currentFields = null;
}

/** 获取当前模态框 DOM 元素（用于自定义 body 区域操作） */
export function getActiveModal() {
  return activeModal;
}

/** 在当前模态框内显示错误 */
export function showModalError(errorId, message) {
  const el = document.getElementById(errorId);
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

/** 在当前模态框内抖动输入框（密码错误等） */
export function shakeField(fieldId) {
  const input = document.getElementById(`modal-field-${fieldId}`);
  if (!input) return;
  input.classList.add('shake');
  setTimeout(() => input.classList.remove('shake'), 400);
}

/** 关闭当前模态框并 resolve 为 cancel */
export function cancelModal() {
  if (resolvePromise) resolvePromise('cancel');
  closeModal();
}
