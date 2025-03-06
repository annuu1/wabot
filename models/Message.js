const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  phoneNumber: { type: String, required: true },
  content: { type: String, required: true },
  status: { type: String, enum: ['pending', 'sent', 'delivered', 'failed'], default: 'pending' },
  sentAt: { type: Date },
});

module.exports = mongoose.model('Message', messageSchema);



