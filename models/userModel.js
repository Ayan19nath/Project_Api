const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = mongoose.Schema({
    First_name: { type: String, trim: true },
    Last_name: { type: String, trim: true },
    Email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    Password: { type: String, required: true, select: false }, // hidden in queries unless asked for
    Mobile: { type: String, trim: true },
    DOB: { type: String, trim: true },                         // date of birth, YYYY-MM-DD
    role: { type: String, enum: ['customer', 'admin'], default: 'customer' },
    isOwner: { type: Boolean, default: false },                // true only for the main admin
    passwordChangedAt: Date,                                   // older reset links stop working after a change
    resetOtp: { type: String, select: false },                 // hashed 6-digit code (forgot password)
    resetOtpExpires: { type: Date, select: false },
    resetOtpTries: { type: Number, default: 0, select: false },
    emailVerified: Boolean,                                    // false until the emailed code is entered (older accounts have no value and stay allowed)
    verifyOtp: { type: String, select: false },                // hashed 6-digit code (verify email)
    verifyOtpExpires: { type: Date, select: false },
    verifyOtpTries: { type: Number, default: 0, select: false }
});

// Compare a typed password with the saved hash
userSchema.methods.comparePassword = function (plainPassword) {
    return bcrypt.compare(plainPassword, this.Password);
};

module.exports = mongoose.model('User', userSchema);