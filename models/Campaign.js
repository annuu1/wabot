const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  name: { type: String, required: true },
  content: { type: String, required: true },
  filePath: String,
  fileType: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  team: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Team owner (Admin)
});

module.exports = mongoose.model('Campaign', campaignSchema);