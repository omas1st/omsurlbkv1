const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Configure upload settings
const uploadOptions = {
  folder: 'url-shortener',
  resource_type: 'auto',
  timeout: 60000,
  chunk_size: 6000000, // 6MB
};

// Generate Cloudinary signature for secure uploads
const generateSignature = (params) => {
  const timestamp = Math.round(Date.now() / 1000);
  const signature = cloudinary.utils.api_sign_request(
    { ...params, timestamp },
    process.env.CLOUDINARY_API_SECRET
  );

  return { signature, timestamp, api_key: process.env.CLOUDINARY_API_KEY };
};

// Upload image to Cloudinary
const uploadImage = async (file, options = {}) => {
  try {
    const result = await cloudinary.uploader.upload(file, {
      ...uploadOptions,
      ...options,
    });

    return {
      success: true,
      url: result.secure_url,
      public_id: result.public_id,
      format: result.format,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
      created_at: result.created_at,
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    return {
      success: false,
      message: error.message,
    };
  }
};

// Upload file (any type)
const uploadFile = async (file, options = {}) => {
  try {
    const result = await cloudinary.uploader.upload(file, {
      ...uploadOptions,
      resource_type: 'auto',
      ...options,
    });

    return {
      success: true,
      url: result.secure_url,
      public_id: result.public_id,
      format: result.format,
      resource_type: result.resource_type,
      bytes: result.bytes,
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    return {
      success: false,
      message: error.message,
    };
  }
};

// Delete image from Cloudinary
const deleteImage = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return {
      success: result.result === 'ok',
      message: result.result === 'ok' ? 'Image deleted' : 'Delete failed',
    };
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    return {
      success: false,
      message: error.message,
    };
  }
};

// Generate QR code URL with Cloudinary transformations
const generateQRCodeUrl = (text, options = {}) => {
  const defaultOptions = {
    width: 256,
    height: 256,
    color: '000000',
    bgcolor: 'ffffff',
    format: 'png',
    qzone: 1,
  };

  const qrOptions = { ...defaultOptions, ...options };
  const qrText = encodeURIComponent(text);
  
  return cloudinary.url(`qrcode/${qrText}`, {
    transformation: [
      { width: qrOptions.width, height: qrOptions.height, crop: 'scale' },
      { color: qrOptions.color, background: qrOptions.bgcolor },
      { format: qrOptions.format },
    ],
  });
};

// Generate responsive image URL
const getResponsiveImageUrl = (publicId, width, quality = 'auto') => {
  return cloudinary.url(publicId, {
    transformation: [
      { width, crop: 'scale' },
      { quality },
      { fetch_format: 'auto' }
    ]
  });
};

module.exports = {
  cloudinary,
  uploadImage,
  uploadFile,
  deleteImage,
  generateSignature,
  generateQRCodeUrl,
  getResponsiveImageUrl,
  uploadOptions,
};