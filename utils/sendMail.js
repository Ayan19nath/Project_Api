// Calls the separate Mail_Api server (secret key required, so only this backend can send mail)
const call = async (path, body) => {
    const res = await fetch(`${process.env.MAIL_API_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.MAIL_API_KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000) // do not wait forever if the mail server is down
    });
    if (!res.ok) throw new Error('Mail API failed');
};

// Plain email. copy = true also sends a hidden copy to the official website inbox.
const sendMail = (to, subject, message, copy = false) => call('/send', { to, subject, message, copy });

// Order email: type is placed, new_order, cancelled, shipped, out_for_delivery or delivered
sendMail.sendOrderMail = (data) => call('/order-mail', data);

module.exports = sendMail;