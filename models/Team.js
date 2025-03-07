const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Super Admin
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Team', teamSchema);