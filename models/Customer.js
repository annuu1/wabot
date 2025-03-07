const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true, unique: true },
  name: String,
  team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
});

module.exports = mongoose.model('Customer', customerSchema);