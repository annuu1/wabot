const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true }, // Reference to Campaign
  phoneNumber: { type: String, required: true },
  status: { type: String, enum: ['pending', 'sent', 'delivered', 'failed'], default: 'pending' },
  sentAt: Date,
});

module.exports = mongoose.model('Message', messageSchema);