const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Coupon = require('../models/couponModel');
const Item = require('../models/itemModel');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { checkCoupon } = require('../utils/coupon');

const admin = [authenticate, authorize('admin')];

// Catches errors in async routes
const wrap = (fn) => (req, res) =>
    fn(req, res).catch((err) => {
        const bad = err.name === 'CastError' || err.name === 'ValidationError';
        res.status(bad ? 400 : err.code === 11000 ? 409 : 500)
            .json({ message: err.code === 11000 ? 'This coupon code already exists' : err.message });
    });

// Shape of a coupon sent to the website (the list of customers who used it stays private)
const toClient = (c) => ({
    id: c._id, code: c.code, percent: c.percent, maxDiscount: c.maxDiscount, minOrder: c.minOrder,
    expiresAt: c.expiresAt, usageLimit: c.usageLimit, used: c.usedBy.length, active: c.active
});

// ========== CHECK A CODE (logged-in customer) ==========
// The cart value is calculated from the database prices, never taken from the website
router.post('/check', authenticate, wrap(async (req, res) => {
    const { code, items } = req.body;
    if (!Array.isArray(items) || !items.length || items.length > 20 || items.some((i) => !mongoose.isValidObjectId(i.id))) {
        return res.status(400).json({ message: 'Your cart is empty' });
    }

    const products = await Item.find({ _id: { $in: items.map((i) => i.id) } });
    const price = new Map(products.map((p) => [String(p._id), p.price]));
    const subtotal = items.reduce(
        (sum, i) => sum + (price.get(String(i.id)) || 0) * Math.max(1, Math.floor(Number(i.quantity)) || 1), 0
    );

    try {
        const { coupon, amount } = await checkCoupon(code, req.user.id, subtotal);
        res.json({ code: coupon.code, percent: coupon.percent, amount });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
}));

// ========== LIST ALL COUPONS (admin only) ==========
router.get('/', admin, wrap(async (req, res) => {
    res.json((await Coupon.find().sort('-createdAt')).map(toClient));
}));

// ========== CREATE A COUPON (admin only) ==========
router.post('/', admin, wrap(async (req, res) => {
    const { code, percent, maxDiscount, minOrder, usageLimit, expiresAt } = req.body;
    const clean = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(clean)) {
        return res.status(400).json({ message: 'The code must have 3 to 20 letters or numbers' });
    }

    // the coupon works until the end of the chosen day (India time)
    const end = expiresAt ? new Date(`${expiresAt}T23:59:59+05:30`) : undefined;
    if (end && Number.isNaN(end.getTime())) return res.status(400).json({ message: 'Invalid expiry date' });

    const coupon = await Coupon.create({
        code: clean,
        percent: Number(percent),
        maxDiscount: Number(maxDiscount) || 0,
        minOrder: Number(minOrder) || 0,
        usageLimit: Number(usageLimit) || 0,
        expiresAt: end
    });
    res.status(201).json(toClient(coupon));
}));

// ========== SWITCH A COUPON ON OR OFF (admin only) ==========
router.put('/:id/toggle', admin, wrap(async (req, res) => {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) return res.status(404).json({ message: 'Coupon not found' });

    coupon.active = !coupon.active;
    await coupon.save();
    res.json(toClient(coupon));
}));

// ========== DELETE A COUPON (admin only) ==========
router.delete('/:id', admin, wrap(async (req, res) => {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) return res.status(404).json({ message: 'Coupon not found' });
    res.json({ message: 'Coupon deleted' });
}));

module.exports = router;