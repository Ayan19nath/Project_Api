const mongoose = require('mongoose');

// A pending request to become an admin (deleted when approved or rejected)
const adminRequestSchema = mongoose.Schema({
    First_name: { type: String, required: true, trim: true },
    Last_name: { type: String, trim: true },
    Email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    Mobile: { type: String, trim: true },
    Password: { type: String, required: true } // already hashed
}, { timestamps: true });

module.exports = mongoose.model('AdminRequest', adminRequestSchema);