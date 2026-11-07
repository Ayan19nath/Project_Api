const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
        select: false // This part is mainly hidden in queries unless asked for it
    },
    Mobile: { type: String, trim: true },
    role: {
        type: String,
        enum: ['customer', 'admin'],
        default: 'customer'
    },
    isOwner: { type: Boolean, default: false } // true only for the main admin (Me)
});

// Compare a typed password with the saved hash
userSchema.methods.comparePassword = function (plainPassword) {
    return bcrypt.compare(plainPassword, this.Password);
};

const User = mongoose.model('User', userSchema);
module.exports = User;