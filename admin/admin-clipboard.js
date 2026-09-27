export async function copyTextToClipboard(
  text,
  {
    clipboard = globalThis.navigator?.clipboard,
    documentRef = globalThis.document,
  } = {},
) {
  const value = String(text);

  if (typeof clipboard?.writeText === 'function') {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the DOM-based compatibility path.
    }
  }

  if (
    !documentRef?.body ||
    typeof documentRef.createElement !== 'function' ||
    typeof documentRef.execCommand !== 'function'
  ) {
    return false;
  }

  const textarea = documentRef.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.inset = '0 auto auto -9999px';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  documentRef.body.append(textarea);

  try {
    textarea.focus();
    textarea.select();
    return documentRef.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
