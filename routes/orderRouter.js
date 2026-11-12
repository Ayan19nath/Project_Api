const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Order = require('../models/orderModel');
const Item = require('../models/itemModel');
const User = require('../models/userModel');
const sendMail = require('../utils/sendMail');
const { checkCoupon, claimCoupon, releaseCoupon } = require('../utils/coupon');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const admin = [authenticate, authorize('admin')];

const PAYMENTS = ['Cash on Delivery', 'UPI', 'Credit / Debit Card'];
const ADDRESS_FIELDS = ['name', 'phone', 'address', 'city', 'state', 'pincode', 'country'];

// The admin can only move an order one step forward: current status -> [next status, email type]
const NEXT = {
    Processing: ['Shipped', 'shipped'],
    Shipped: ['Out for Delivery', 'out_for_delivery'],
    'Out for Delivery': ['Delivered', 'delivered']
};

// Catches errors in async routes
const wrap = (fn) => (req, res) =>
    fn(req, res).catch((err) => res.status(err.name === 'CastError' ? 400 : 500).json({ message: err.message }));

// Shape of an order sent to the website
const toClient = (order) => {
    const o = order.toObject();
    const u = o.user && o.user.Email ? o.user : null; // only present when the customer was loaded (admin list)
    return {
        id: o._id,
        orderId: o.orderId,
        status: o.status,
        history: o.history,
        items: o.items.map(({ product, ...rest }) => ({ id: product, ...rest })),
        address: o.address,
        paymentMethod: o.paymentMethod,
        notes: o.notes,
        subtotal: o.subtotal,
        discount: o.discount,
        couponCode: o.couponCode,
        couponDiscount: o.couponDiscount,
        shipping: o.shipping,
        total: o.total,
        cancellationReason: o.cancellationReason,
        cancelledAt: o.cancelledAt,
        refundStatus: o.refundStatus,
        createdAt: o.createdAt,
        customer: u && { name: `${u.First_name || ''} ${u.Last_name || ''}`.trim(), email: u.Email, mobile: u.Mobile }
    };
};

// Put the stock back (order cancelled or failed)
const restoreStock = (lines) =>
    Promise.all(lines.map((l) => Item.updateOne({ _id: l.product }, { $inc: { stock: l.quantity } })));

// Email the customer about an order. A mail problem never breaks the order.
const emailCustomer = async (order, type) => {
    try {
        const user = await User.findById(order.user._id || order.user);
        if (!user) return;
        const a = order.address;
        await sendMail.sendOrderMail({
            type,
            to: user.Email,
            name: user.First_name,
            orderId: order.orderId,
            total: order.total,
            payment: order.paymentMethod,
            reason: order.cancellationReason,
            address: [a.address, a.city, a.state, a.pincode, a.country].filter(Boolean).join(', '),
            items: order.items.map(({ name, quantity, price }) => ({ name, quantity, price }))
        });
    } catch (err) {
        console.log('Order mail error:', err.message);
    }
};

// Email the head admin (owner) about a new order, with a hidden copy to the official inbox
const emailOwner = async (order) => {
    try {
        const [boss, buyer] = await Promise.all([User.findOne({ isOwner: true }), User.findById(order.user)]);
        if (!boss) return;
        const a = order.address;
        const lines = order.items.map((i) => `- ${i.name} x ${i.quantity} = ₹${i.price * i.quantity}`).join('\n');
        const coupon = order.couponCode ? `Coupon: ${order.couponCode} (-₹${order.couponDiscount})\n` : '';
        await sendMail(
            boss.Email,
            `New order ${order.orderId}`,
            `A new order was placed.\n\nOrder: ${order.orderId}\nCustomer: ${buyer?.First_name || ''} ${buyer?.Last_name || ''} (${buyer?.Email || '-'}, ${a.phone})\nPayment: ${order.paymentMethod}\n${coupon}Total: ₹${order.total}\n\nItems:\n${lines}\n\nDeliver to: ${[a.name, a.address, a.city, a.state, a.pincode, a.country].filter(Boolean).join(', ')}\n\nOpen the admin dashboard to manage this order.`,
            true
        );
    } catch (err) {
        console.log('Owner mail error:', err.message);
    }
};

const clean = (value, max = 200) => String(value || '').trim().slice(0, max);

// ========== PLACE ORDER (logged-in customer) ==========
// The website sends only product ids, quantities and the coupon code. Prices, stock and the discount come from the database.
router.post('/', authenticate, wrap(async (req, res) => {
    const { items, address, paymentMethod, notes } = req.body;

    if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
        return res.status(400).json({ message: 'Your cart is empty' });
    }
    if (!address || ADDRESS_FIELDS.some((f) => !clean(address[f]))) {
        return res.status(400).json({ message: 'Please fill all address details' });
    }
    if (!PAYMENTS.includes(paymentMethod)) {
        return res.status(400).json({ message: 'Invalid payment method' });
    }
    if (items.some((i) => !mongoose.isValidObjectId(i.id))) {
        return res.status(400).json({ message: 'Invalid product in your cart' });
    }

    // Quantity wanted for each product (same product listed twice is added up)
    const wanted = new Map();
    items.forEach((i) => {
        const qty = Math.max(1, Math.floor(Number(i.quantity)) || 1);
        wanted.set(String(i.id), (wanted.get(String(i.id)) || 0) + qty);
    });

    const products = await Item.find({ _id: { $in: [...wanted.keys()] } }).populate('category');
    if (products.length !== wanted.size) {
        return res.status(400).json({ message: 'Some products are no longer available. Please check your cart.' });
    }

    const lines = products.map((p) => ({
        product: p._id,
        name: p.name,
        brand: p.brand,
        category: p.category?.cat_name,
        image: p.images[0]?.url,
        price: p.price,
        oldPrice: p.oldPrice,
        quantity: wanted.get(String(p._id))
    }));

    const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
    const discount = lines.reduce((sum, l) => sum + Math.max(0, (l.oldPrice || 0) - l.price) * l.quantity, 0);

    // Coupon: checked here on the server, so a discount cannot be faked
    let coupon = null;
    let couponDiscount = 0;
    if (clean(req.body.couponCode)) {
        try {
            ({ coupon, amount: couponDiscount } = await checkCoupon(req.body.couponCode, req.user.id, subtotal));
        } catch (err) {
            return res.status(400).json({ message: err.message });
        }
    }

    // Take the stock (one product at a time; undo everything if one is short)
    const reserved = [];
    for (const line of lines) {
        const done = await Item.updateOne(
            { _id: line.product, stock: { $gte: line.quantity } },
            { $inc: { stock: -line.quantity } }
        );
        if (!done.modifiedCount) {
            await restoreStock(reserved);
            return res.status(400).json({ message: `Not enough stock for ${line.name}` });
        }
        reserved.push(line);
    }

    // Take the coupon (only one request can win the last use)
    if (coupon && !(await claimCoupon(coupon, req.user.id))) {
        await restoreStock(reserved);
        return res.status(400).json({ message: 'This coupon is no longer available' });
    }

    try {
        const order = await Order.create({
            orderId: `HH${Date.now()}${Math.floor(10 + Math.random() * 90)}`,
            user: req.user.id,
            items: lines,
            address: Object.fromEntries(ADDRESS_FIELDS.map((f) => [f, clean(address[f])])),
            paymentMethod,
            notes: clean(notes),
            subtotal,
            discount,
            couponCode: coupon?.code,
            couponDiscount,
            total: subtotal - couponDiscount,
            history: [{ status: 'Processing' }]
        });
        // customer confirmation and owner alert are sent together (so the request stays fast)
        await Promise.all([emailCustomer(order, 'placed'), emailOwner(order)]);
        res.status(201).json(toClient(order));
    } catch (err) {
        await restoreStock(lines);
        if (coupon) await releaseCoupon(coupon.code, req.user.id);
        res.status(400).json({ message: err.message });
    }
}));

// ========== MY ORDERS (logged-in customer) ==========
router.get('/mine', authenticate, wrap(async (req, res) => {
    const orders = await Order.find({ user: req.user.id, hiddenByCustomer: { $ne: true } }).sort('-createdAt');
    res.json(orders.map((o) => toClient(o)));
}));

// ========== TRACK ONE ORDER by order number (the customer's own, or any for an admin) ==========
router.get('/track/:ref', authenticate, wrap(async (req, res) => {
    const ref = req.params.ref.replace(/^#/, '');
    const order = await Order.findOne({
        $or: [{ orderId: ref }, ...(mongoose.isValidObjectId(ref) ? [{ _id: ref }] : [])]
    });
    if (!order || (String(order.user) !== req.user.id && req.user.role !== 'admin')) {
        return res.status(404).json({ message: 'Order not found' });
    }
    res.json(toClient(order));
}));

// ========== CANCEL ORDER (the customer, only while Processing) ==========
router.put('/:id/cancel', authenticate, wrap(async (req, res) => {
    const order = await Order.findOneAndUpdate(
        { _id: req.params.id, user: req.user.id, status: 'Processing' },
        {
            $set: {
                status: 'Cancelled',
                cancellationReason: clean(req.body.reason) || 'No reason given',
                cancelledAt: new Date()
            },
            $push: { history: { status: 'Cancelled' } }
        },
        { new: true }
    );
    if (!order) return res.status(400).json({ message: 'This order can no longer be cancelled' });

    order.refundStatus = order.paymentMethod === 'Cash on Delivery' ? 'Not required' : 'Processing';
    await order.save();
    await restoreStock(order.items.map(({ product, quantity }) => ({ product, quantity })));
    if (order.couponCode) await releaseCoupon(order.couponCode, order.user); // the customer can use the coupon again
    await emailCustomer(order, 'cancelled');
    res.json(toClient(order));
}));

// ========== REMOVE A CANCELLED ORDER FROM MY HISTORY (the customer) ==========
router.delete('/:id', authenticate, wrap(async (req, res) => {
    const order = await Order.findOneAndUpdate(
        { _id: req.params.id, user: req.user.id, status: 'Cancelled' },
        { hiddenByCustomer: true }
    );
    if (!order) return res.status(400).json({ message: 'Only cancelled orders can be removed' });
    res.json({ message: 'Order removed from your history' });
}));

// ========== ALL ORDERS (admin only) ==========
router.get('/', admin, wrap(async (req, res) => {
    const orders = await Order.find().populate('user', 'First_name Last_name Email Mobile').sort('-createdAt');
    res.json(orders.map((o) => toClient(o)));
}));

// ========== CHANGE STATUS (admin only) ==========
// Shipped -> Out for Delivery -> Delivered, and the customer gets an email each time
router.put('/:id/status', admin, wrap(async (req, res) => {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const step = NEXT[order.status];
    if (!step || step[0] !== req.body.status) {
        return res.status(400).json({
            message: step
                ? `A ${order.status} order can only move to "${step[0]}"`
                : `A ${order.status} order cannot be changed`
        });
    }

    const updated = await Order.findOneAndUpdate(
        { _id: order._id, status: order.status },
        { $set: { status: step[0] }, $push: { history: { status: step[0] } } },
        { new: true }
    ).populate('user', 'First_name Last_name Email Mobile');
    if (!updated) return res.status(409).json({ message: 'This order was just changed. Please refresh.' });

    await emailCustomer(updated, step[1]);
    res.json(toClient(updated));
}));

module.exports = router;