// Sends an email through the separate Mail_Api server
async function sendMail(to, subject, message) {
    const res = await fetch(`${process.env.MAIL_API_URL}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.MAIL_API_KEY },
        body: JSON.stringify({ to, subject, message })
    });
    if (!res.ok) throw new Error('Mail API failed');
}

module.exports = sendMail;