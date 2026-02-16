// utils/helpers.js
const crypto = require('crypto');

exports.generateSlug = (length = 6) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

exports.safeJson = (obj) => {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (err) {
    return obj;
  }
};

exports.hashSHA256 = (input) => {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
};

exports.getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = forwarded.split(',').map(s => s.trim());
    return ips[0];
  }
  return req.ip || req.connection.remoteAddress || null;
};
