// utils/validators.js
exports.isValidUrl = (url) => {
  try {
    // accept missing protocol and prefix with http for validation
    const normalized = url.startsWith('http://') || url.startsWith('https://') ? url : `http://${url}`;
    new URL(normalized);
    return true;
  } catch (_) {
    return false;
  }
};

exports.isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

exports.isValidSlug = (slug) => {
  if (!slug) return true;
  const slugRegex = /^[a-zA-Z0-9-_]+$/;
  return slugRegex.test(slug);
};