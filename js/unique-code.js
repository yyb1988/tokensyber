export async function generateUniqueCode(modelId, completionTimestamp) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const input = `${modelId}:${completionTimestamp}:${saltHex}`;

  let hashHex;
  try {
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    // 降级：简单哈希
    hashHex = simpleHash(input);
  }

  const codePart = hashHex.slice(0, 8).toUpperCase();
  const datePart = new Date(completionTimestamp)
    .toISOString().slice(0, 10).replace(/-/g, '');
  const checksum = hashHex.slice(8, 12).toUpperCase();

  return `TC-${codePart}-${datePart}-${checksum}`;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(16, '0') +
    Math.abs(hash * 31).toString(16).padStart(16, '0');
}

export function formatCode(code) {
  return code;
}
