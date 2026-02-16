// models/TextPage.js - COMPLETELY FIXED VERSION
const mongoose = require('mongoose');

const textPageSchema = new mongoose.Schema({
  alias: {
    type: String,
    required: [true, 'Alias is required'],
    unique: true,
    trim: true,
  },
  shortUrl: {
    type: String,
    required: true,
  },
  textContent: {
    type: String,
    required: [true, 'Text content is required'],
    maxlength: [5000, 'Text content cannot exceed 5000 characters'],
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  customization: {
    pageColor: {
      type: String,
      default: '#FFFFFF',
    },
    textColor: {
      type: String,
      default: '#000000',
    },
    textFont: {
      type: String,
      default: 'Arial',
    },
    textSize: {
      type: Number,
      default: 16,
      min: [12, 'Text size must be at least 12'],
      max: [32, 'Text size cannot exceed 32'],
    },
    title: {
      type: String,
      default: '',
      maxlength: [100, 'Title cannot exceed 100 characters'],
    },
    allowResponse: {
      type: Boolean,
      default: false,
    },
    showOwnerInfo: {
      type: Boolean,
      default: false,
    },
    backgroundImage: {
      type: String,
      default: null,
    },
    backgroundImagePublicId: {
      type: String,
      default: null,
    },
    backgroundOpacity: {
      type: Number,
      default: 1,
      min: [0, 'Opacity must be between 0 and 1'],
      max: [1, 'Opacity must be between 0 and 1'],
    },
    textAlignment: {
      type: String,
      enum: ['left', 'center', 'right', 'justify'],
      default: 'left',
    },
    lineHeight: {
      type: Number,
      default: 1.5,
      min: [1, 'Line height must be at least 1'],
      max: [3, 'Line height cannot exceed 3'],
    },
    padding: {
      type: Number,
      default: 20,
      min: [0, 'Padding must be at least 0'],
      max: [100, 'Padding cannot exceed 100'],
    },
    borderRadius: {
      type: Number,
      default: 0,
      min: [0, 'Border radius must be at least 0'],
      max: [50, 'Border radius cannot exceed 50'],
    },
    boxShadow: {
      type: Boolean,
      default: false,
    },
  },
  views: {
    type: Number,
    default: 0,
  },
  uniqueViews: {
    type: Number,
    default: 0,
  },
  todayViews: {
    type: Number,
    default: 0,
  },
  replies: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    name: {
      type: String,
      required: true,
      maxlength: [50, 'Name cannot exceed 50 characters'],
    },
    email: {
      type: String,
      default: null,
    },
    message: {
      type: String,
      required: true,
      maxlength: [1000, 'Message cannot exceed 1000 characters'],
    },
    approved: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  }],
  lastViewed: {
    type: Date,
    default: null,
  },
  active: {
    type: Boolean,
    default: true,
  },
  restricted: {
    type: Boolean,
    default: false,
  },
  tags: [{
    type: String,
    trim: true,
  }],
  metadata: {
    wordCount: Number,
    characterCount: Number,
    readTime: Number,
  },
  analyticsPrivate: {
    type: Boolean,
    default: false,
  },
  expirationDate: {
    type: Date,
    default: null,
  },
  password: {
    type: String,
    default: null,
    select: false,
  },
  passwordNote: {
    type: String,
    default: null,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual for analytics URL
textPageSchema.virtual('analyticsUrl').get(function() {
  return `${process.env.FRONTEND_URL || 'http://localhost:3000'}/${this.alias}/analytics`;
});

// Virtual for reply count
textPageSchema.virtual('replyCount').get(function() {
  return this.replies ? this.replies.length : 0;
});

// Virtual for approved reply count
textPageSchema.virtual('approvedReplyCount').get(function() {
  return this.replies ? this.replies.filter(reply => reply.approved).length : 0;
});

// Virtual for checking if it's public
textPageSchema.virtual('isPublic').get(function() {
  return !this.owner;
});

// Indexes
textPageSchema.index({ owner: 1 });
textPageSchema.index({ views: -1 });
textPageSchema.index({ createdAt: -1 });
textPageSchema.index({ active: 1, restricted: 1 });

// Simple pre-save middleware - FIXED VERSION
textPageSchema.pre('save', function() {
  // Calculate metadata if text content is being modified
  if (this.isModified('textContent')) {
    const text = this.textContent || '';
    const words = text.trim().split(/\s+/).filter(word => word.length > 0);
    const wordCount = words.length;
    const characterCount = text.length;
    const readTime = Math.max(1, Math.ceil(wordCount / 200)); // Minimum 1 minute
    
    this.metadata = {
      wordCount,
      characterCount,
      readTime,
    };
  }
  
  // If no metadata set, set defaults
  if (!this.metadata) {
    this.metadata = {
      wordCount: 0,
      characterCount: 0,
      readTime: 0,
    };
  }
  
  return Promise.resolve();
});

// Method to increment views
textPageSchema.methods.incrementViews = async function(isUnique = false) {
  try {
    const today = new Date().toDateString();
    const lastViewedDate = this.lastViewed ? this.lastViewed.toDateString() : null;
    
    if (lastViewedDate !== today) {
      this.todayViews = 0;
    }
    
    this.views = (this.views || 0) + 1;
    this.todayViews = (this.todayViews || 0) + 1;
    
    if (isUnique) {
      this.uniqueViews = (this.uniqueViews || 0) + 1;
    }
    
    this.lastViewed = new Date();
    
    await this.save();
    
    return this;
  } catch (error) {
    console.error('Error incrementing views:', error.message);
    return this;
  }
};

// Method to add reply
textPageSchema.methods.addReply = async function(replyData) {
  try {
    if (!this.customization || !this.customization.allowResponse) {
      throw new Error('This text page does not allow responses');
    }

    // Create reply object
    const reply = {
      ...replyData,
      createdAt: new Date()
    };

    // Initialize replies array if needed
    if (!this.replies) {
      this.replies = [];
    }
    
    // Auto-approve if no owner
    if (!reply.approved && !this.owner) {
      reply.approved = true;
    }
    
    this.replies.push(reply);
    await this.save();
    
    return reply;
  } catch (error) {
    console.error('Error adding reply:', error.message);
    throw error;
  }
};

// Method to approve reply
textPageSchema.methods.approveReply = async function(replyId) {
  try {
    if (!this.replies || this.replies.length === 0) {
      throw new Error('No replies found');
    }

    const reply = this.replies.id(replyId);
    if (!reply) {
      throw new Error('Reply not found');
    }
    
    reply.approved = true;
    await this.save();
    
    return reply;
  } catch (error) {
    console.error('Error approving reply:', error.message);
    throw error;
  }
};

// Method to delete reply
textPageSchema.methods.deleteReply = async function(replyId) {
  try {
    if (!this.replies || this.replies.length === 0) {
      throw new Error('No replies found');
    }

    const replyIndex = this.replies.findIndex(r => r._id.toString() === replyId);
    if (replyIndex === -1) {
      throw new Error('Reply not found');
    }
    
    this.replies.splice(replyIndex, 1);
    await this.save();
    
    return true;
  } catch (error) {
    console.error('Error deleting reply:', error.message);
    throw error;
  }
};

// Method to check password
textPageSchema.methods.checkPassword = function(password) {
  try {
    if (!this.password) return true;
    if (!password) return false;
    
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    return this.password === hash;
  } catch (error) {
    console.error('Error checking password:', error.message);
    return false;
  }
};

// Method to set password
textPageSchema.methods.setPassword = function(password) {
  try {
    if (!password) {
      this.password = null;
      return;
    }
    
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    this.password = hash;
  } catch (error) {
    console.error('Error setting password:', error.message);
    throw error;
  }
};

// Static method to create with metadata
textPageSchema.statics.createWithMetadata = async function(data) {
  const text = data.textContent || '';
  const words = text.trim().split(/\s+/).filter(word => word.length > 0);
  const wordCount = words.length;
  const characterCount = text.length;
  const readTime = Math.max(1, Math.ceil(wordCount / 200));
  
  const textPageData = {
    ...data,
    metadata: {
      wordCount,
      characterCount,
      readTime,
    }
  };
  
  return this.create(textPageData);
};

const TextPage = mongoose.model('TextPage', textPageSchema);

module.exports = TextPage;