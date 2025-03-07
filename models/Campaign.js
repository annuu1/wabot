const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  name: { type: String, required: true },
  content: { type: String, required: true },
  filePath: String,
  fileType: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
});

module.exports = mongoose.model('Campaign', campaignSchema);