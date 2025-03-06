const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  name: { type: String, required: true }, // User-defined campaign name
  content: { type: String, required: true }, // Message content
  filePath: String, // Path to uploaded file (if any)
  fileType: String, // 'image' or 'document'
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Campaign', campaignSchema);