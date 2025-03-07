const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  phoneNumber: { type: String, required: true },
  status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
  sentAt: Date,
  team: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Team owner (Admin)
});

module.exports = mongoose.model('Message', messageSchema);