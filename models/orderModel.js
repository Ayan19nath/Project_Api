const mongoose = require('mongoose');

// One product inside an order (name, price and image are copied when the order is placed)
const lineSchema = new mongoose.Schema({
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Item' },
    name: String,
    brand: String,
    category: String,
    image: String,
    price: Number,
    oldPrice: Number,
    quantity: { type: Number, min: 1 }
}, { _id: false });

// When each status started
const historySchema = new mongoose.Schema({
    status: String,
    at: { type: Date, default: Date.now }
}, { _id: false });

const orderSchema = mongoose.Schema({
    orderId: { type: String, unique: true },          // shown to the customer, e.g. HH173100000000012
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: [lineSchema],
    address: { name: String, phone: String, address: String, city: String, state: String, pincode: String, country: String },

    // payment: Cash on Delivery or Online Payment (Razorpay)
    paymentMethod: String,
    paymentStatus: { type: String, enum: ['Pay on delivery', 'Pending', 'Paid'], default: 'Pay on delivery' },
    paymentDeadline: Date,                             // an online order must be paid before this time
    razorpayOrderId: String,                           // Razorpay's order for this payment
    razorpayPaymentId: String,                         // Razorpay's payment id (needed for refunds)
    paidAt: Date,

    notes: String,
    subtotal: Number,
    discount: Number,                                  // saving from the old prices of the products
    couponCode: String,                                // coupon used on this order (if any)
    couponDiscount: { type: Number, default: 0 },      // rupees saved with the coupon
    shipping: { type: Number, default: 0 },
    total: Number,
    status: {
        type: String,
        enum: ['Awaiting Payment', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'],
        default: 'Processing'
    },
    history: [historySchema],
    deliveryOtp: { type: String, select: false },      // 6-digit code the customer gives to the delivery person
    deliveryOtpTries: { type: Number, default: 0, select: false }, // wrong codes typed so far
    cancellationReason: String,
    cancelledAt: Date,
    refundStatus: String,                              // Not required, Refund initiated, Refunded or Refund failed
    refundId: String,
    hiddenByCustomer: { type: Boolean, default: false } // "Delete order" in the customer's history
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);