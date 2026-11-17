const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Order = require('../models/orderModel');
const Tracking = require('../models/trackingModel');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const ACTIVE = 'Out for Delivery'; // the position is shared only during the delivery

// ========== SEND THE DELIVERY PERSON'S POSITION (admin only) ==========
router.put('/:id', authenticate, authorize('admin'), async (req, res) => {
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    if (!mongoose.isValidObjectId(req.params.id) || !(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) {
        return res.status(400).json({ message: 'Invalid position' });
    }

    try {
        if (!(await Order.exists({ _id: req.params.id, status: ACTIVE }))) {
            return res.status(400).json({ message: 'This order is not out for delivery' });
        }
        await Tracking.findOneAndUpdate({ order: req.params.id }, { lat, lng, at: new Date() }, { upsert: true });
        res.json({ message: 'Position saved' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ========== READ THE POSITION (the customer of this order, or an admin) ==========
router.get('/:id', authenticate, async (req, res) => {
    try {
        const order = mongoose.isValidObjectId(req.params.id) && (await Order.findById(req.params.id).select('user status'));
        if (!order || (String(order.user) !== req.user.id && req.user.role !== 'admin')) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const active = order.status === ACTIVE;
        const point = active ? await Tracking.findOne({ order: order._id }) : null;
        res.json({ active, position: point ? { lat: point.lat, lng: point.lng, at: point.at } : null });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;