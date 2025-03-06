const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true, unique: true },
  name: { type: String },
  status: { type: String, enum: ['active', 'inactive', 'opted-out'], default: 'active' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Customer', customerSchema);


