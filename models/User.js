const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['superadmin', 'admin', 'agent'], required: true },
  team: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Team owner (Admin) or self for Super Admin/Admin
});

module.exports = mongoose.model('User', userSchema);