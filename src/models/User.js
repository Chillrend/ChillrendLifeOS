const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    planeApiKey: { type: String },
});

module.exports = mongoose.model('User', userSchema);
