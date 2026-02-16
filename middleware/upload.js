// middleware/upload.js
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { MAX_FILE_SIZE } = require('../config/constants');

const memoryStorage = multer.memoryStorage();

const upload = multer({
  storage: memoryStorage,
  limits: { fileSize: MAX_FILE_SIZE || 10 * 1024 * 1024 },
});

function saveBufferToTemp(file) {
  // file: { originalname, buffer }
  const tmpDir = os.tmpdir();
  const fileName = `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;
  const filePath = path.join(tmpDir, fileName);
  fs.writeFileSync(filePath, file.buffer);
  return filePath;
}

// Middleware to persist memory file to a temp path for older codepaths that use req.file.path
async function persistTempFileIfNeeded(req, res, next) {
  try {
    if (req.file && req.file.buffer && !req.file.path) {
      const filePath = saveBufferToTemp(req.file);
      req.file.path = filePath;
    }
    if (req.files && Array.isArray(req.files)) {
      req.files.forEach((f) => {
        if (f.buffer && !f.path) {
          f.path = saveBufferToTemp(f);
        }
      });
    } else if (req.files && typeof req.files === 'object') {
      // multer fields object
      Object.keys(req.files).forEach((key) => {
        req.files[key].forEach((f) => {
          if (f.buffer && !f.path) {
            f.path = saveBufferToTemp(f);
          }
        });
      });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  upload,
  persistTempFileIfNeeded,
};
