// lib/base58.js — Base58 (Bitcoin alphabet) encode/decode for TVBox config.
// Standard base58 used by TVBox 直播源/资源站 API.
// Algorithm: standard division-by-58 (same as Python base58 library).

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP = new Map();
for (let i = 0; i < B58_ALPHABET.length; i++) {
  B58_MAP.set(B58_ALPHABET[i], i);
}

export function b58Encode(input) {
  let bytes;
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else {
    bytes = new Uint8Array(input);
  }

  // Count leading zero bytes
  let zeros = 0;
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) zeros++;

  // Copy remaining bytes (after leading zeros) for division
  const num = Array.from(bytes.slice(zeros));

  // Repeatedly divide by 58, collecting remainders
  const digits = [];
  while (num.length > 0 && !(num.length === 1 && num[0] === 0)) {
    let remainder = 0;
    for (let i = 0; i < num.length; i++) {
      const temp = remainder * 256 + num[i];
      num[i] = Math.floor(temp / 58);
      remainder = temp % 58;
    }
    digits.unshift(B58_ALPHABET[remainder]);

    // Remove leading zeros from num
    while (num.length > 0 && num[0] === 0) {
      num.shift();
    }
  }

  // Prepend '1' for each leading zero byte
  let result = "";
  for (let i = 0; i < zeros; i++) result += "1";
  result += digits.join("");
  return result;
}

export function b58Decode(str) {
  // Count leading '1' characters (zero bytes)
  let zeros = 0;
  for (let i = 0; i < str.length && str[i] === "1"; i++) zeros++;

  // Convert base58 string to bytes using repeated multiplication
  const bytes = [];
  for (let i = zeros; i < str.length; i++) {
    const val = B58_MAP.get(str[i]);
    if (val === undefined) {
      throw new Error(`Invalid base58 character: ${str[i]}`);
    }
    // Multiply bytes by 58 and add val
    let carry = val;
    for (let j = bytes.length - 1; j >= 0; j--) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xFF;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.unshift(carry & 0xFF);
      carry >>= 8;
    }
  }

  // Remove leading zero bytes (keep counted zeros)
  while (bytes.length > zeros && bytes[0] === 0) {
    bytes.shift();
  }

  // Prepend zero bytes
  for (let i = 0; i < zeros; i++) bytes.unshift(0);

  return new Uint8Array(bytes);
}
