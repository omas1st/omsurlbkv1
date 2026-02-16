// backend/utils/generateSlug.js
const { generateRandomSlug } = require('./helpers');

module.exports = (length = 6) => generateRandomSlug(length);
