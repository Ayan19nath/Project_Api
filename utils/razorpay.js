const crypto = require('crypto');

const API = 'https://api.razorpay.com/v1';

// The secret key stays on the server. Razorpay checks it with this header.
const authHeader = () =>
    'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');

// Call the Razorpay API (money is in paise: 1 rupee = 100 paise)
const call = async (path, body) => {
    const res = await fetch(API + path, {
        method: 'POST',
        headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000) // do not wait forever
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.description || 'Payment gateway error');
    return data;
};

// Safe comparison of two signatures
const same = (a, b) => {
    const x = Buffer.from(String(a || ''));
    const y = Buffer.from(String(b || ''));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const sign = (text, secret) => crypto.createHmac('sha256', secret).update(text).digest('hex');

module.exports = {
    // Online payment works only when the keys are set
    enabled: () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),

    // Create a payment order for this amount (in rupees)
    createOrder: (rupees, receipt) => call('/orders', { amount: Math.round(rupees * 100), currency: 'INR', receipt }),

    // Give the whole payment back
    refund: (paymentId) => call(`/payments/${paymentId}/refund`, { speed: 'normal' }),

    // The website sends these values after paying. They match only if Razorpay really received the money.
    verifyPayment: (orderId, paymentId, signature) =>
        Boolean(process.env.RAZORPAY_KEY_SECRET) &&
        same(sign(`${orderId}|${paymentId}`, process.env.RAZORPAY_KEY_SECRET), signature),

    // Check that a webhook call really comes from Razorpay (uses the raw request text)
    verifyWebhook: (rawBody, signature) =>
        Boolean(process.env.RAZORPAY_WEBHOOK_SECRET) &&
        same(sign(rawBody, process.env.RAZORPAY_WEBHOOK_SECRET), signature)
};