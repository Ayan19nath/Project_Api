const mongoose = require('mongoose');

const userSchema = mongoose.Schema({
    First_name: { type: String, trim: true },
    Last_name: { type: String, trim: true },
    Email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    Password: {
        type: String,
        required: true,
        select: false
    },
    Mobile: { type: String, trim: true },
    role: {
        type: String,
        enum: ['customer', 'admin'],
        default: 'customer'
    }
});

const User = mongoose.model('User', userSchema);
module.exports = User;