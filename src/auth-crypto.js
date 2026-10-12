'use strict';
const crypto = require('node:crypto');

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const cand = hashPassword(password, salt).hash;
  try {
    return crypto.timingSafeEqual(Buffer.from(cand, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}
function newToken(bytes = 32) { return crypto.randomBytes(bytes).toString('hex'); }

module.exports = { hashPassword, verifyPassword, newToken };
