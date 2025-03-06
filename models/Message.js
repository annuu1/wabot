const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  phoneNumber: { type: String, required: true },
  content: { type: String, required: true },
  status: { type: String, enum: ['pending', 'sent', 'delivered', 'failed'], default: 'pending' },
  sentAt: Date,
  filePath: String, // Path to uploaded file
  fileType: String, // 'image' or 'document'
});

module.exports = mongoose.model('Message', messageSchema);