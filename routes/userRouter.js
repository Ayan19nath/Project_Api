const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/userModel');
const AdminRequest = require('../models/adminRequestModel');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const ownerOnly = require('../middleware/ownerOnly');
const sendMail = require('../utils/sendMail');

const owner = [authenticate, ownerOnly];

// Build the login token (role and isOwner are read by the middleware)
function makeToken(user) {
    return jwt.sign(
        {
            id: user._id,
            First_name: user.First_name,
            Last_name: user.Last_name,
            role: user.role,
            isOwner: user.isOwner
        },
        process.env.JWT_SECRET, // must be the same value used in authenticate.js
        { expiresIn: '1h' }
    );
}

// Send an email without breaking the request if the mail server is down
const notify = (to, subject, message) =>
    sendMail(to, subject, message).catch((err) => console.log('Mail error:', err.message));

// ========== REGISTER (public, always a customer) ==========
router.post('/', async (req, res) => {
    try {
        const { First_name, Last_name, Email, Password, Mobile } = req.body;

        if (!First_name || !Email || !Password) {
            return res.status(400).json({ message: "First name, email and password are required" });
        }

        const email = Email.toLowerCase().trim();

        if (await User.findOne({ Email: email })) {
            return res.status(409).json({ message: "You are already registered" });
        }

        // only the allowed fields are taken from req.body
        const newUser = await User.create({
            First_name,
            Last_name,
            Email: email,
            Mobile,
            Password: await bcrypt.hash(Password, 10),
            role: 'customer'
        });

        const { Password: _removed, ...safeUser } = newUser.toObject();
        res.status(201).json(safeUser);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ========== LOGIN (customers and admins) ==========
router.post('/login', async (req, res) => {
    try {
        const { Email, Password } = req.body;

        if (!Email || !Password) {
            return res.status(400).json({ message: "Email and password are required" });
        }

        // select('+Password') is needed because the schema hides it by default
        const user = await User.findOne({ Email: Email.toLowerCase().trim() }).select('+Password');

        // same message for both cases so nobody can find out which emails exist
        if (!user || !(await user.comparePassword(Password))) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        res.json({
            message: "Login successful",
            token: makeToken(user),
            role: user.role,
            isOwner: user.isOwner
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ========== ADMIN REQUEST (public) ==========
// Saves a pending request and emails the owner
router.post('/admin-request', async (req, res) => {
    try {
        const { First_name, Last_name, Email, Password, Mobile } = req.body;

        if (!First_name || !Email || !Password) {
            return res.status(400).json({ message: "First name, email and password are required" });
        }
        if (Password.length < 8) {
            return res.status(400).json({ message: "Password must be at least 8 characters long" });
        }

        const email = Email.toLowerCase().trim();

        if (await User.findOne({ Email: email })) {
            return res.status(409).json({ message: "This email is already registered" });
        }
        if (await AdminRequest.findOne({ Email: email })) {
            return res.status(409).json({ message: "A request for this email is already pending" });
        }

        await AdminRequest.create({
            First_name,
            Last_name,
            Email: email,
            Mobile,
            Password: await bcrypt.hash(Password, 10)
        });

        // email the owner (the password is never included)
        const boss = await User.findOne({ isOwner: true });
        if (boss) {
            notify(
                boss.Email,
                'New admin access request',
                `${First_name} ${Last_name || ''} wants to become an admin.\n\nEmail: ${email}\nMobile: ${Mobile || '-'}\n\nOpen the admin dashboard and go to Admin Requests to approve or reject.`
            );
        }

        res.status(201).json({ message: "Request sent. You will get an email after the owner decides." });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ========== LIST PENDING REQUESTS (owner only) ==========
router.get('/admin-requests', owner, async (req, res) => {
    try {
        res.json(await AdminRequest.find().select('-Password').sort({ createdAt: -1 }));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ========== APPROVE REQUEST (owner only) ==========
// Creates the admin account (isOwner stays false) and removes the request
router.put('/admin-requests/:id/approve', owner, async (req, res) => {
    try {
        const request = await AdminRequest.findById(req.params.id);
        if (!request) return res.status(404).json({ message: "Request not found" });

        await User.create({
            First_name: request.First_name,
            Last_name: request.Last_name,
            Email: request.Email,
            Mobile: request.Mobile,
            Password: request.Password,
            role: 'admin'
        });
        await request.deleteOne();

        notify(request.Email, 'Admin request approved', 'Your admin request was approved. You can now log in as Admin on the HomeHub login page.');
        res.json({ message: "Admin approved" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ========== REJECT REQUEST (owner only) ==========
router.delete('/admin-requests/:id', owner, async (req, res) => {
    try {
        const request = await AdminRequest.findByIdAndDelete(req.params.id);
        if (!request) return res.status(404).json({ message: "Request not found" });

        notify(request.Email, 'Admin request rejected', 'Sorry, your admin request was not approved.');
        res.json({ message: "Request rejected" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ========== GET ALL USERS (admin only) ==========
router.get('/', authenticate, authorize('admin'), async (req, res) => {
    try {
        res.json(await User.find().sort({ createdAt: -1 }));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ========== UPDATE USER (the user themselves, or an admin) ==========
router.put('/:id', authenticate, async (req, res) => {
    try {
        const isSelf = req.user.id === req.params.id;

        if (!isSelf && req.user.role !== 'admin') {
            return res.status(403).json({ message: "You can only update your own account" });
        }

        const target = await User.findById(req.params.id);
        if (!target) return res.status(404).json({ message: 'User not found' });

        // only the owner can edit another admin
        if (target.role === 'admin' && !isSelf && !req.user.isOwner) {
            return res.status(403).json({ message: "Only the owner can edit an admin" });
        }

        const updates = { ...req.body };
        delete updates.isOwner;                      // nobody can change this
        if (!req.user.isOwner) delete updates.role;  // only the owner can change roles

        if (updates.Email) updates.Email = updates.Email.toLowerCase().trim();

        // re-hash the password only if a new one was sent
        if (updates.Password) updates.Password = await bcrypt.hash(updates.Password, 10);

        const updated = await User.findByIdAndUpdate(
            req.params.id,
            { $set: updates },
            { new: true, runValidators: true }
        );

        const { Password, ...safeUser } = updated.toObject();
        res.status(200).json(safeUser);
    } catch (err) {
        if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid user id' });
        if (err.code === 11000) return res.status(409).json({ message: 'Email already in use' });
        res.status(500).json({ message: err.message });
    }
});

// ========== DELETE USER (admin only) ==========
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
    try {
        const target = await User.findById(req.params.id);
        if (!target) return res.status(404).json({ message: 'User not found' });

        if (target.isOwner) {
            return res.status(403).json({ message: "The owner account cannot be deleted" });
        }
        if (target.role === 'admin' && !req.user.isOwner) {
            return res.status(403).json({ message: "Only the owner can remove an admin" });
        }

        await target.deleteOne();
        res.status(200).json({ message: 'User deleted successfully' });
    } catch (err) {
        if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid user id' });
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;