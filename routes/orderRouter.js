const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const router = express.Router();
const Order = require('../models/orderModel');
const Item = require('../models/itemModel');
const User = require('../models/userModel');
const sendMail = require('../utils/sendMail');
const razorpay = require('../utils/razorpay');
const { checkCoupon, claimCoupon, releaseCoupon } = require('../utils/coupon');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const admin = [authenticate, authorize('admin')];

const COD = 'Cash on Delivery';
const ONLINE = 'Online Payment';
const ADDRESS_FIELDS = ['name', 'phone', 'address', 'city', 'state', 'pincode', 'country'];
const PAY_MINUTES = 30; // an online order must be paid within this time, or it is cancelled
const ACTIVE = ['Processing', 'Shipped', 'Out for Delivery']; // the delivery code is shown only while the order is active

// The admin can only move an order one step forward: current status -> [next status, email type]
const NEXT = {
    Processing: ['Shipped', 'shipped'],
    Shipped: ['Out for Delivery', 'out_for_delivery'],
    'Out for Delivery': ['Delivered', 'delivered']
};

// Catches errors in async routes
const wrap = (fn) => (req, res) =>
    fn(req, res).catch((err) => res.status(err.name === 'CastError' ? 400 : 500).json({ message: err.message }));

// Shape of an order sent to the website. withOtp = also send the delivery code (only to the customer who owns the order).
const toClient = (order, withOtp = false) => {
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
        paymentStatus: o.paymentStatus,
        paymentDeadline: o.paymentDeadline,
        paidAt: o.paidAt,
        paymentId: u ? o.razorpayPaymentId : undefined, // only the admin list shows it
        notes: o.notes,
        subtotal: o.subtotal,
        discount: o.discount,
        couponCode: o.couponCode,
        couponDiscount: o.couponDiscount,
        shipping: o.shipping,
        total: o.total,
        deliveryOtp: withOtp && ACTIVE.includes(o.status) ? o.deliveryOtp : undefined,
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

// Payment text used in emails
const payLabel = (o) =>
    o.paymentMethod === ONLINE ? `${ONLINE} (${o.paymentStatus === 'Paid' ? 'Paid' : 'not paid yet'})` : o.paymentMethod;

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
            payment: payLabel(order),
            reason: order.cancellationReason,
            deliveryOtp: order.deliveryOtp, // shown only in the "placed" and "out for delivery" emails
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
            `A new order was placed.\n\nOrder: ${order.orderId}\nCustomer: ${buyer?.First_name || ''} ${buyer?.Last_name || ''} (${buyer?.Email || '-'}, ${a.phone})\nPayment: ${payLabel(order)}\n${coupon}Total: ₹${order.total}\n\nItems:\n${lines}\n\nDeliver to: ${[a.name, a.address, a.city, a.state, a.pincode, a.country].filter(Boolean).join(', ')}\n\nOpen the admin dashboard to manage this order.`,
            true
        );
    } catch (err) {
        console.log('Owner mail error:', err.message);
    }
};

const clean = (value, max = 200) => String(value || '').trim().slice(0, max);

// Details the website needs to open the Razorpay payment window
const paymentInfo = (o) => ({
    keyId: process.env.RAZORPAY_KEY_ID,
    orderId: o.razorpayOrderId,
    amount: Math.round(o.total * 100),
    currency: 'INR'
});

// Send the money back through Razorpay and remember the result
const refundOrder = async (order) => {
    try {
        const refund = await razorpay.refund(order.razorpayPaymentId);
        order.refundId = refund.id;
        order.refundStatus = 'Refund initiated';
    } catch (err) {
        console.log('Refund error:', err.message);
        order.refundStatus = 'Refund failed'; // the admin can retry from the dashboard
    }
    await order.save();
};

// Cancel online orders that were not paid in time (the stock and the coupon go back)
const expireUnpaid = async () => {
    const stale = await Order.find({ status: 'Awaiting Payment', paymentDeadline: { $lt: new Date() } }).limit(20);
    for (const o of stale) {
        const done = await Order.findOneAndUpdate(
            { _id: o._id, status: 'Awaiting Payment' },
            {
                $set: {
                    status: 'Cancelled',
                    cancellationReason: 'Payment was not completed in time',
                    cancelledAt: new Date(),
                    refundStatus: 'Not required'
                },
                $push: { history: { status: 'Cancelled' } }
            }
        );
        if (!done) continue; // it was paid or cancelled just now
        await restoreStock(o.items.map(({ product, quantity }) => ({ product, quantity })));
        if (o.couponCode) await releaseCoupon(o.couponCode, o.user);
    }
};

// Mark an online order as paid. Only the first call wins (the browser and the webhook can both arrive).
const settle = async (order, paymentId) => {
    const paid = await Order.findOneAndUpdate(
        { _id: order._id, status: 'Awaiting Payment' },
        {
            $set: { status: 'Processing', paymentStatus: 'Paid', razorpayPaymentId: paymentId, paidAt: new Date() },
            $push: { history: { status: 'Processing' } }
        },
        { new: true }
    ).select('+deliveryOtp'); // the confirmation email contains the delivery code
    if (paid) {
        await Promise.all([emailCustomer(paid, 'placed'), emailOwner(paid)]);
        return paid;
    }

    // The order was cancelled or expired before the money arrived: give the money back
    const late = await Order.findOneAndUpdate(
        { _id: order._id, status: 'Cancelled', paymentStatus: 'Pending' },
        { $set: { paymentStatus: 'Paid', razorpayPaymentId: paymentId, paidAt: new Date() } },
        { new: true }
    );
    if (late) await refundOrder(late);
    return late || Order.findById(order._id);
};

// ========== RAZORPAY WEBHOOK (called by Razorpay, protected by its signature) ==========
// index.js gives this route the raw request body
router.post('/webhook', async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!razorpay.verifyWebhook(raw, req.header('x-razorpay-signature'))) {
        return res.status(400).json({ message: 'Invalid signature' });
    }

    try {
        const { event, payload } = JSON.parse(raw);

        // money received (also covers customers who paid and then closed the page)
        if (event === 'payment.captured') {
            const p = payload.payment.entity;
            const order = await Order.findOne({ razorpayOrderId: p.order_id });
            if (order) await settle(order, p.id);
        }

        // refund finished
        if (event === 'refund.processed') {
            const r = payload.refund.entity;
            await Order.updateOne({ razorpayPaymentId: r.payment_id }, { $set: { refundStatus: 'Refunded' } });
        }
        res.json({ received: true });
    } catch (err) {
        console.log('Webhook error:', err.message);
        res.status(500).json({ message: 'Webhook failed' });
    }
});

// ========== PLACE ORDER (logged-in customer) ==========
// The website sends only product ids, quantities and the coupon code. Prices, stock and the discount come from the database.
router.post('/', authenticate, wrap(async (req, res) => {
    const { items, address, paymentMethod, notes } = req.body;
    const online = paymentMethod === ONLINE;

    if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
        return res.status(400).json({ message: 'Your cart is empty' });
    }
    if (!address || ADDRESS_FIELDS.some((f) => !clean(address[f]))) {
        return res.status(400).json({ message: 'Please fill all address details' });
    }
    if (![COD, ONLINE].includes(paymentMethod)) {
        return res.status(400).json({ message: 'Invalid payment method' });
    }
    if (online && !razorpay.enabled()) {
        return res.status(503).json({ message: 'Online payment is not available right now. Please choose Cash on Delivery.' });
    }
    if (items.some((i) => !mongoose.isValidObjectId(i.id))) {
        return res.status(400).json({ message: 'Invalid product in your cart' });
    }

    await expireUnpaid(); // unpaid orders give their stock back first

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
        const orderId = `HH${Date.now()}${Math.floor(10 + Math.random() * 90)}`;
        const total = subtotal - couponDiscount;
        const gateway = online ? await razorpay.createOrder(total, orderId) : null; // the amount is set here, never by the website

        const order = await Order.create({
            orderId,
            user: req.user.id,
            items: lines,
            address: Object.fromEntries(ADDRESS_FIELDS.map((f) => [f, clean(address[f])])),
            paymentMethod,
            paymentStatus: online ? 'Pending' : 'Pay on delivery',
            ...(online && { razorpayOrderId: gateway.id, paymentDeadline: new Date(Date.now() + PAY_MINUTES * 60 * 1000) }),
            notes: clean(notes),
            subtotal,
            discount,
            couponCode: coupon?.code,
            couponDiscount,
            total,
            deliveryOtp: String(crypto.randomInt(100000, 1000000)), // the customer gives this code to the delivery person
            status: online ? 'Awaiting Payment' : 'Processing',
            history: [{ status: online ? 'Awaiting Payment' : 'Processing' }]
        });

        // online: the order waits for the money, the website opens the payment window with these details
        if (online) return res.status(201).json({ ...toClient(order), payment: paymentInfo(order) });

        // cash on delivery: customer confirmation and owner alert are sent together
        await Promise.all([emailCustomer(order, 'placed'), emailOwner(order)]);
        res.status(201).json(toClient(order, true));
    } catch (err) {
        await restoreStock(lines);
        if (coupon) await releaseCoupon(coupon.code, req.user.id);
        res.status(400).json({ message: err.message });
    }
}));

// ========== MY ORDERS (logged-in customer, with the delivery codes) ==========
router.get('/mine', authenticate, wrap(async (req, res) => {
    await expireUnpaid();
    const orders = await Order.find({ user: req.user.id, hiddenByCustomer: { $ne: true } })
        .select('+deliveryOtp')
        .sort('-createdAt');
    res.json(orders.map((o) => toClient(o, true)));
}));

// ========== TRACK ONE ORDER by order number (the customer's own, or any for an admin) ==========
router.get('/track/:ref', authenticate, wrap(async (req, res) => {
    const ref = req.params.ref.replace(/^#/, '');
    const order = await Order.findOne({
        $or: [{ orderId: ref }, ...(mongoose.isValidObjectId(ref) ? [{ _id: ref }] : [])]
    }).select('+deliveryOtp');

    const mine = order && String(order.user) === req.user.id;
    if (!order || (!mine && req.user.role !== 'admin')) {
        return res.status(404).json({ message: 'Order not found' });
    }
    res.json(toClient(order, mine)); // the code goes only to the customer who owns the order
}));

// ========== PAY NOW: payment details for an order that is still waiting for its payment ==========
router.post('/:id/pay', authenticate, wrap(async (req, res) => {
    await expireUnpaid();
    const order = await Order.findOne({ _id: req.params.id, user: req.user.id, status: 'Awaiting Payment' });
    if (!order) return res.status(400).json({ message: 'This order is no longer waiting for payment' });
    res.json({ id: order._id, orderId: order.orderId, total: order.total, payment: paymentInfo(order) });
}));

// ========== CHECK A PAYMENT after the customer paid (the signature proves Razorpay got the money) ==========
router.post('/:id/verify', authenticate, wrap(async (req, res) => {
    const { razorpay_order_id: gatewayOrder, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body;
    const order = await Order.findOne({ _id: req.params.id, user: req.user.id });

    if (!order || !paymentId || order.razorpayOrderId !== gatewayOrder || !razorpay.verifyPayment(gatewayOrder, paymentId, signature)) {
        return res.status(400).json({ message: 'Payment could not be verified' });
    }
    res.json(toClient(await settle(order, paymentId)));
}));

// ========== CANCEL ORDER (the customer, while Processing or still waiting for payment) ==========
router.put('/:id/cancel', authenticate, wrap(async (req, res) => {
    const order = await Order.findOneAndUpdate(
        { _id: req.params.id, user: req.user.id, status: { $in: ['Processing', 'Awaiting Payment'] } },
        {
            $set: {
                status: 'Cancelled',
                cancellationReason: clean(req.body.reason) || 'No reason given',
                cancelledAt: new Date(),
                refundStatus: 'Not required'
            },
            $push: { history: { status: 'Cancelled' } }
        },
        { new: true }
    );
    if (!order) return res.status(400).json({ message: 'This order can no longer be cancelled' });

    // a paid online order gets its money back
    if (order.paymentStatus === 'Paid' && order.razorpayPaymentId) await refundOrder(order);

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

// ========== ALL ORDERS (admin only, never with the delivery codes) ==========
router.get('/', admin, wrap(async (req, res) => {
    await expireUnpaid();
    const orders = await Order.find().populate('user', 'First_name Last_name Email Mobile').sort('-createdAt');
    res.json(orders.map((o) => toClient(o)));
}));

// ========== CHANGE STATUS (admin only) ==========
// Shipped -> Out for Delivery -> Delivered, and the customer gets an email each time
router.put('/:id/status', admin, wrap(async (req, res) => {
    const order = await Order.findById(req.params.id).select('+deliveryOtp +deliveryOtpTries');
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const step = NEXT[order.status];
    if (!step || step[0] !== req.body.status) {
        return res.status(400).json({
            message: step
                ? `A ${order.status} order can only move to "${step[0]}"`
                : `An order that is "${order.status}" cannot be changed`
        });
    }

    // Delivered needs the customer's delivery code (older orders have none; the owner can skip it)
    if (step[0] === 'Delivered' && order.deliveryOtp && !(req.user.isOwner && req.body.skipOtp === true)) {
        if (order.deliveryOtpTries >= 5) {
            return res.status(400).json({ message: 'Too many wrong codes. Ask the owner to deliver this order.' });
        }
        if (clean(req.body.otp) !== order.deliveryOtp) {
            await Order.updateOne({ _id: order._id }, { $inc: { deliveryOtpTries: 1 } });
            return res.status(400).json({ message: 'Wrong delivery code. Ask the customer for the 6-digit code.' });
        }
    }

    const updated = await Order.findOneAndUpdate(
        { _id: order._id, status: order.status },
        { $set: { status: step[0] }, $push: { history: { status: step[0] } } },
        { new: true }
    ).select('+deliveryOtp').populate('user', 'First_name Last_name Email Mobile');
    if (!updated) return res.status(409).json({ message: 'This order was just changed. Please refresh.' });

    await emailCustomer(updated, step[1]);
    res.json(toClient(updated));
}));

// ========== RETRY A FAILED REFUND (admin only) ==========
router.post('/:id/refund', admin, wrap(async (req, res) => {
    const order = await Order.findOne({ _id: req.params.id, status: 'Cancelled', paymentStatus: 'Paid', refundStatus: 'Refund failed' });
    if (!order) return res.status(400).json({ message: 'There is nothing to refund for this order' });

    await refundOrder(order);
    res.json(toClient(order));
}));

module.exports = router;