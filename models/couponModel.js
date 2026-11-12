const mongoose = require('mongoose');

const couponSchema = mongoose.Schema({
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    percent: { type: Number, required: true, min: 1, max: 90 },        // percent off the cart value
    maxDiscount: { type: Number, min: 0, default: 0 },                 // most rupees one order can save (0 = no limit)
    minOrder: { type: Number, min: 0, default: 0 },                    // smallest cart value that can use it
    expiresAt: Date,                                                   // empty = never expires
    usageLimit: { type: Number, min: 0, default: 0 },                  // total uses allowed (0 = unlimited)
    usedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],   // each customer can use a code once
    active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Coupon', couponSchema);