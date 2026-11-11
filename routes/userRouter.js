const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/userModel');
const AdminRequest = require('../models/adminRequestModel');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const ownerOnly = require('../middleware/ownerOnly');
const sendMail = require('../utils/sendMail');
const { signToken } = require('../utils/token');

const owner = [authenticate, ownerOnly];
const googleClient = new OAuth2Client();
const OTP_MINUTES = 10;
const WEAK = 'Password must be at least 8 characters and include a letter, a number and a special character';

// Same password rule as the website
const strongPassword = (p) =>
    typeof p === 'string' && p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);

// Reset tokens use their own secret, so they can never be used as login tokens
const resetSecret = () => process.env.JWT_SECRET + '-reset';
const hashOtp = (otp) => crypto.createHash('sha256').update(otp + process.env.JWT_SECRET).digest('hex');

// Customer details sent to the website (never the password). verified = the email code was entered.
const profile = (u) => ({
    id: u._id,
    name: `${u.First_name || ''} ${u.Last_name || ''}`.trim(),
    email: u.Email,
    phone: u.Mobile || '',
    dob: u.DOB || '',
    verified: u.emailVerified === true
});

// Send an email. Always "await" it: on Vercel the function stops as soon as the answer is sent.
// copy = also send a hidden copy to the official website inbox.
const notify = (to, subject, message, copy = false) =>
    sendMail(to, subject, message, copy).catch((err) => console.log('Mail error:', err.message));

// Email a 6-digit verification code (valid 10 minutes). Skipped if one was sent less than a minute ago.
// The user must have been loaded with select('+verifyOtpExpires').
const sendVerifyCode = async (user) => {
    if (user.verifyOtpExpires && user.verifyOtpExpires - Date.now() > (OTP_MINUTES - 1) * 60 * 1000) return;
    const otp = String(crypto.randomInt(100000, 1000000));
    user.verifyOtp = hashOtp(otp);
    user.verifyOtpExpires = new Date(Date.now() + OTP_MINUTES * 60 * 1000);
    user.verifyOtpTries = 0;
    await user.save();
    await notify(user.Email, 'Verify your HomeHub email',
        `Your verification code is ${otp}. It is valid for ${OTP_MINUTES} minutes. If you did not ask for it, you can ignore this email.`);
};

// Catches errors in async routes
const wrap = (fn) => (req, res) =>
    fn(req, res).catch((err) => {
        const status = err.name === 'CastError' ? 400 : err.code === 11000 ? 409 : 500;
        res.status(status).json({ message: err.code === 11000 ? 'This email is already in use' : err.message });
    });

const clean = (value) => String(value || '').trim();

// ========== REGISTER (public, always a customer) ==========
router.post('/', wrap(async (req, res) => {
    const { First_name, Last_name, Email, Password, Mobile, DOB } = req.body;
    if (!First_name || !Email || !Password) {
        return res.status(400).json({ message: 'First name, email and password are required' });
    }
    if (!strongPassword(Password)) return res.status(400).json({ message: WEAK });

    const email = clean(Email).toLowerCase();
    if (await User.findOne({ Email: email })) return res.status(409).json({ message: 'You are already registered' });

    // only the allowed fields are taken from req.body; the email must be verified before login
    const user = await User.create({
        First_name, Last_name, Email: email, Mobile, DOB,
        Password: await bcrypt.hash(Password, 10),
        role: 'customer',
        emailVerified: false
    });
    await sendVerifyCode(user);
    res.status(201).json({ message: 'Registered successfully', needsVerification: true });
}));

// ========== VERIFY EMAIL (public, 5 tries): checks the code from the email ==========
router.post('/verify-email', wrap(async (req, res) => {
    const user = await User.findOne({ Email: clean(req.body.Email).toLowerCase() })
        .select('+verifyOtp +verifyOtpExpires +verifyOtpTries');
    const bad = () => res.status(400).json({ message: 'Invalid or expired code. Please try again.' });

    if (!user || !user.verifyOtp || user.verifyOtpExpires < Date.now() || user.verifyOtpTries >= 5) return bad();

    if (user.verifyOtp !== hashOtp(clean(req.body.otp))) {
        user.verifyOtpTries += 1;
        await user.save();
        return bad();
    }

    // right code: the account is verified and the code works only once
    user.emailVerified = true;
    user.verifyOtp = undefined;
    user.verifyOtpExpires = undefined;
    user.verifyOtpTries = 0;
    await user.save();
    res.json({ message: 'Email verified' });
}));

// ========== SEND A NEW VERIFICATION CODE (public, same answer for every email) ==========
router.post('/resend-verification', wrap(async (req, res) => {
    const user = await User.findOne({ Email: clean(req.body.Email).toLowerCase() }).select('+verifyOtpExpires');
    if (user && user.emailVerified !== true) await sendVerifyCode(user);
    res.json({ message: 'If this email needs verification, a new code has been sent.' });
}));

// ========== LOGIN (customers and admins) ==========
router.post('/login', wrap(async (req, res) => {
    const { Email, Password } = req.body;
    if (!Email || !Password) return res.status(400).json({ message: 'Email and password are required' });

    // select('+Password') is needed because the schema hides it by default
    const user = await User.findOne({ Email: clean(Email).toLowerCase() }).select('+Password +verifyOtpExpires');

    // same message for both cases so nobody can find out which emails exist
    if (!user || !(await user.comparePassword(String(Password)))) {
        return res.status(401).json({ message: 'Invalid email or password' });
    }

    // new accounts must verify the email first (older accounts can verify later from the profile)
    if (user.emailVerified === false) {
        await sendVerifyCode(user);
        return res.status(403).json({ message: 'Please verify your email. We sent you a 6-digit code.', needsVerification: true, email: user.Email });
    }
    res.json({ message: 'Login successful', token: signToken(user), role: user.role, isOwner: user.isOwner, user: profile(user) });
}));

// ========== LOGIN WITH GOOGLE (public) ==========
// The website sends the Google sign-in token. The account is created on the first visit.
router.post('/google', wrap(async (req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ message: 'Google login is not set up yet' });

    let info;
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: String(req.body.credential || ''),
            audience: process.env.GOOGLE_CLIENT_ID
        });
        info = ticket.getPayload();
    } catch {
        return res.status(401).json({ message: 'Google sign-in failed. Please try again.' });
    }
    if (!info?.email || !info.email_verified) return res.status(400).json({ message: 'Your Google email is not verified' });

    const email = info.email.toLowerCase();
    let user = await User.findOne({ Email: email });
    if (user?.role === 'admin') {
        return res.status(403).json({ message: 'Admin accounts must log in from the Admin tab with their password.' });
    }

    if (!user) {
        user = await User.create({
            First_name: info.given_name || info.name,
            Last_name: info.family_name,
            Email: email,
            Password: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10), // unused; "Forgot password" can set a real one
            role: 'customer',
            emailVerified: true // Google already verified this email
        });
    } else if (user.emailVerified !== true) {
        user.emailVerified = true;
        await user.save();
    }
    res.json({ message: 'Login successful', token: signToken(user), role: user.role, isOwner: false, user: profile(user) });
}));

// ========== MY PROFILE (logged-in user) ==========
router.get('/me', authenticate, wrap(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'Account not found' });
    res.json(profile(user));
}));

router.put('/me', authenticate, wrap(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'Account not found' });
    if (!clean(req.body.name)) return res.status(400).json({ message: 'Please enter your name' });

    // the first word is the first name, the rest is the last name (the email cannot be changed)
    const [first, ...rest] = clean(req.body.name).split(/\s+/);
    user.First_name = first;
    user.Last_name = rest.join(' ');
    user.Mobile = clean(req.body.phone);
    user.DOB = clean(req.body.dob);
    await user.save();
    res.json(profile(user));
}));

// ========== CHANGE MY PASSWORD (logged-in user) ==========
router.put('/me/password', authenticate, wrap(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id).select('+Password');

    // 400, not 401, so the website does not log the user out
    if (!user || !(await user.comparePassword(String(currentPassword || '')))) {
        return res.status(400).json({ message: 'Current password is incorrect.' });
    }
    if (!strongPassword(newPassword)) return res.status(400).json({ message: WEAK });
    if (newPassword === currentPassword) {
        return res.status(400).json({ message: 'New password must be different from your current password.' });
    }

    user.Password = await bcrypt.hash(newPassword, 10);
    user.passwordChangedAt = new Date();
    await user.save();
    res.json({ message: 'Password updated' });
}));

// ========== SEND A VERIFICATION CODE TO MY OWN EMAIL (logged-in user, customer or admin) ==========
router.post('/me/send-verification', authenticate, wrap(async (req, res) => {
    const user = await User.findById(req.user.id).select('+verifyOtpExpires');
    if (!user) return res.status(404).json({ message: 'Account not found' });
    if (user.emailVerified === true) return res.json({ message: 'Your email is already verified', verified: true });

    await sendVerifyCode(user);
    res.json({ message: 'We sent a 6-digit code to your email.' });
}));

// ========== FORGOT PASSWORD, STEP 1: email a 6-digit code (public) ==========
router.post('/forgot-password', wrap(async (req, res) => {
    const reply = { message: 'If this email is registered, a 6-digit code has been sent.' };
    const user = await User.findOne({ Email: clean(req.body.Email).toLowerCase() }).select('+resetOtpExpires');

    // no account, or a code was sent less than a minute ago: answer the same way
    if (!user || (user.resetOtpExpires && user.resetOtpExpires - Date.now() > (OTP_MINUTES - 1) * 60 * 1000)) {
        return res.json(reply);
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    user.resetOtp = hashOtp(otp);
    user.resetOtpExpires = new Date(Date.now() + OTP_MINUTES * 60 * 1000);
    user.resetOtpTries = 0;
    await user.save();

    await notify(user.Email, 'Your HomeHub password reset code',
        `Your code is ${otp}. It is valid for ${OTP_MINUTES} minutes. If you did not ask for it, you can ignore this email.`);
    res.json(reply);
}));

// ========== FORGOT PASSWORD, STEP 2: check the code (public, 5 tries) ==========
router.post('/verify-otp', wrap(async (req, res) => {
    const user = await User.findOne({ Email: clean(req.body.Email).toLowerCase() })
        .select('+resetOtp +resetOtpExpires +resetOtpTries');
    const bad = () => res.status(400).json({ message: 'Invalid or expired code. Please try again.' });

    if (!user || !user.resetOtp || user.resetOtpExpires < Date.now() || user.resetOtpTries >= 5) return bad();

    if (user.resetOtp !== hashOtp(clean(req.body.otp))) {
        user.resetOtpTries += 1;
        await user.save();
        return bad();
    }

    // right code: it works only once
    user.resetOtp = undefined;
    user.resetOtpExpires = undefined;
    user.resetOtpTries = 0;
    await user.save();
    res.json({ resetToken: jwt.sign({ id: user._id }, resetSecret(), { expiresIn: '10m' }) });
}));

// ========== FORGOT PASSWORD, STEP 3: set the new password (public) ==========
router.post('/reset-password', wrap(async (req, res) => {
    const { resetToken, newPassword } = req.body;
    const expired = () => res.status(400).json({ message: 'This reset session has expired. Please start again.' });

    let payload;
    try {
        payload = jwt.verify(String(resetToken || ''), resetSecret());
    } catch {
        return expired();
    }
    if (!strongPassword(newPassword)) return res.status(400).json({ message: WEAK });

    const user = await User.findById(payload.id);
    // a reset session works only once
    if (!user || (user.passwordChangedAt && payload.iat * 1000 < user.passwordChangedAt.getTime())) return expired();

    user.Password = await bcrypt.hash(newPassword, 10);
    user.passwordChangedAt = new Date();
    await user.save();
    res.json({ message: 'Password reset successfully' });
}));

// ========== ADMIN REQUEST (public): saves a pending request and emails the owner ==========
router.post('/admin-request', wrap(async (req, res) => {
    const { First_name, Last_name, Email, Password, Mobile } = req.body;
    if (!First_name || !Email || !Password) {
        return res.status(400).json({ message: 'First name, email and password are required' });
    }
    if (!strongPassword(Password)) return res.status(400).json({ message: WEAK });

    const email = clean(Email).toLowerCase();
    if (await User.findOne({ Email: email })) return res.status(409).json({ message: 'This email is already registered' });
    if (await AdminRequest.findOne({ Email: email })) return res.status(409).json({ message: 'A request for this email is already pending' });

    await AdminRequest.create({ First_name, Last_name, Email: email, Mobile, Password: await bcrypt.hash(Password, 10) });

    // email the owner, with a hidden copy to the official inbox (the password is never included)
    const boss = await User.findOne({ isOwner: true });
    if (boss) {
        await notify(boss.Email, 'New admin access request',
            `${First_name} ${Last_name || ''} wants to become an admin.\n\nEmail: ${email}\nMobile: ${Mobile || '-'}\n\nOpen the admin dashboard and go to Admin Requests to approve or reject.`, true);
    }
    res.status(201).json({ message: 'Request sent. You will get an email after the owner decides.' });
}));

// ========== LIST PENDING REQUESTS (owner only) ==========
router.get('/admin-requests', owner, wrap(async (req, res) => {
    res.json(await AdminRequest.find().select('-Password').sort({ createdAt: -1 }));
}));

// ========== APPROVE REQUEST (owner only): creates the admin and removes the request ==========
router.put('/admin-requests/:id/approve', owner, wrap(async (req, res) => {
    const request = await AdminRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });

    // the new admin verifies the email with a code at the first login
    await User.create({
        First_name: request.First_name, Last_name: request.Last_name, Email: request.Email,
        Mobile: request.Mobile, Password: request.Password, role: 'admin', emailVerified: false
    });
    await request.deleteOne();

    await notify(request.Email, 'Admin request approved', 'Your admin request was approved. Log in as Admin on the HomeHub login page; you will be asked to verify your email with a 6-digit code the first time.');
    res.json({ message: 'Admin approved' });
}));

// ========== REJECT REQUEST (owner only) ==========
router.delete('/admin-requests/:id', owner, wrap(async (req, res) => {
    const request = await AdminRequest.findByIdAndDelete(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });

    await notify(request.Email, 'Admin request rejected', 'Sorry, your admin request was not approved.');
    res.json({ message: 'Request rejected' });
}));

// ========== GET ALL USERS (admin only) ==========
router.get('/', authenticate, authorize('admin'), wrap(async (req, res) => {
    res.json(await User.find().sort({ _id: -1 }));
}));

// ========== UPDATE A USER (the user themselves, or an admin) ==========
router.put('/:id', authenticate, wrap(async (req, res) => {
    const isSelf = req.user.id === req.params.id;
    if (!isSelf && req.user.role !== 'admin') {
        return res.status(403).json({ message: 'You can only update your own account' });
    }

    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found' });
    if (target.role === 'admin' && !isSelf && !req.user.isOwner) {
        return res.status(403).json({ message: 'Only the owner can edit an admin' });
    }

    // only these fields can be changed here (passwords use /user/me/password)
    ['First_name', 'Last_name', 'Mobile', 'DOB'].forEach((f) => req.body[f] !== undefined && (target[f] = req.body[f]));
    // only the owner can change a role
    if (req.user.isOwner && !target.isOwner && ['customer', 'admin'].includes(req.body.role)) target.role = req.body.role;

    await target.save();
    res.json(profile(target));
}));

// ========== DELETE A USER (admin only) ==========
router.delete('/:id', authenticate, authorize('admin'), wrap(async (req, res) => {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found' });

    if (target.isOwner) return res.status(403).json({ message: 'The owner account cannot be deleted' });
    if (target.role === 'admin' && !req.user.isOwner) return res.status(403).json({ message: 'Only the owner can remove an admin' });

    await target.deleteOne();
    res.json({ message: 'User deleted successfully' });
}));

module.exports = router;