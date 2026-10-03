export async function copyToClipboard(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch { /* Older webviews can still support the selection fallback. */ }
  copySelection(value);
}

function copySelection(value) {
  const previousFocus = document.activeElement;
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.cssText = 'position:fixed;opacity:0;pointer-events:none;font-size:16px';
  document.body.appendChild(input);
  input.focus();
  input.select();
  input.setSelectionRange(0, input.value.length);
  try {
    if (!document.execCommand('copy')) throw new Error('Copy unavailable');
  } finally {
    input.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}

export async function copyFormattedToClipboard({ html, telegramText }) {
  // HTML-aware clients get real bold/code entities. The plain-text flavor uses
  // Telegram markup so browsers/clients that discard HTML keep the intent.
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([telegramText], { type: 'text/plain' }),
      })]);
      return 'rich';
    }
  } catch { /* Try the user-gesture copy event in older webviews. */ }
  let rich = false;
  const onCopy = (event) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/plain', telegramText);
    event.clipboardData.setData('text/html', html);
    event.preventDefault();
    rich = true;
  };
  document.addEventListener('copy', onCopy);
  try {
    copySelection(telegramText);
    return rich ? 'rich' : 'markup';
  } catch { /* Last fallback: text-only Clipboard API with Telegram markup. */ }
  finally { document.removeEventListener('copy', onCopy); }
  await copyToClipboard(telegramText);
  return 'markup';
}
