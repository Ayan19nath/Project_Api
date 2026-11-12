const Coupon = require('../models/couponModel');

// Check a code for this customer and cart value. Returns { coupon, amount } or throws a readable error.
const checkCoupon = async (code, userId, subtotal) => {
    const fail = (message) => { throw new Error(message); };
    const coupon = await Coupon.findOne({ code: String(code || '').trim().toUpperCase() });

    if (!coupon || !coupon.active) fail('Invalid coupon code');
    if (coupon.expiresAt && coupon.expiresAt < Date.now()) fail('This coupon has expired');
    if (coupon.usageLimit && coupon.usedBy.length >= coupon.usageLimit) fail('This coupon has been fully used');
    if (coupon.usedBy.some((id) => String(id) === String(userId))) fail('You have already used this coupon');
    if (subtotal < coupon.minOrder) fail(`Add items worth ₹${coupon.minOrder} or more to use this coupon`);

    let amount = Math.round((subtotal * coupon.percent) / 100);
    if (coupon.maxDiscount) amount = Math.min(amount, coupon.maxDiscount);
    return { coupon, amount };
};

// Take the coupon for this customer (only one request can win the last use)
const claimCoupon = async (coupon, userId) => {
    const done = await Coupon.updateOne(
        {
            _id: coupon._id,
            active: true,
            usedBy: { $ne: userId },
            $expr: { $or: [{ $eq: ['$usageLimit', 0] }, { $lt: [{ $size: '$usedBy' }, '$usageLimit'] }] }
        },
        { $addToSet: { usedBy: userId } }
    );
    return done.modifiedCount === 1;
};

// Give the coupon back (order cancelled or failed)
const releaseCoupon = (code, userId) => Coupon.updateOne({ code }, { $pull: { usedBy: userId } });

module.exports = { checkCoupon, claimCoupon, releaseCoupon };