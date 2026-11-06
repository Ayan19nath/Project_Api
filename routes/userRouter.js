const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/userModel');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

// build the JWT (role must be inside it, authorize() reads req.user.role)
function makeToken(user) {
    return jwt.sign(
        {
            id: user._id,
            First_name: user.First_name,
            Last_name: user.Last_name,
            role: user.role
        },
        process.env.JWT_SECRET,   // must be the same value used in authenticate.js
        { expiresIn: '1h' }
    );
}

// REGISTER (public, always creates a customer)
router.post('/', async (req, res) => {
    try {
        const { First_name, Last_name, Email, Password, Mobile } = req.body;

        if (!First_name || !Email || !Password) {
            return res.status(400).json({
                message: "First name, email and password are required"
            });
        }

        const email = Email.toLowerCase().trim();

        const user = await User.findOne({ Email: email });
        if (user) {
            return res.status(409).json({
                message: "You are already registered"
            });
        }

        const hashedPassword = await bcrypt.hash(Password, 10);

        // only the allowed fields are taken from req.body
        const newUser = new User({
            First_name,
            Last_name,
            Email: email,
            Mobile,
            Password: hashedPassword,
            role: 'customer'
        });
        const save = await newUser.save();

        const { Password: _removed, ...safeUser } = save.toObject();
        res.status(201).json(safeUser);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// LOGIN (customers and admins)
router.post('/login', async (req, res) => {
    try {
        const { Email, Password } = req.body;

        if (!Email || !Password) {
            return res.status(400).json({
                message: "Email and password are required"
            });
        }

        // select('+Password') is needed because the schema hides it by default
        const user = await User.findOne({
            Email: Email.toLowerCase().trim()
        }).select('+Password');

        // same message for both cases so nobody can find out which emails exist
        if (!user) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        const isPassCorrect = await user.comparePassword(Password);
        if (!isPassCorrect) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        res.json({
            message: "Login successful",
            token: makeToken(user),
            role: user.role
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// CREATE ADMIN (admin only: an existing admin creates another admin)
router.post('/create-admin', authenticate, authorize('admin'), async (req, res) => {
    try {
        const { First_name, Last_name, Email, Password, Mobile } = req.body;

        if (!First_name || !Email || !Password) {
            return res.status(400).json({
                message: "First name, email and password are required"
            });
        }

        const email = Email.toLowerCase().trim();

        const exists = await User.findOne({ Email: email });
        if (exists) {
            return res.status(409).json({ message: "Email already registered" });
        }

        const admin = await User.create({
            First_name,
            Last_name,
            Email: email,
            Mobile,
            Password: await bcrypt.hash(Password, 10),
            role: 'admin'
        });

        const { Password: _removed, ...safeUser } = admin.toObject();
        res.status(201).json(safeUser);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// GET ALL USERS (admin only, for the dashboard)
router.get('/', authenticate, authorize('admin'), async (req, res) => {
    try {
        const users = await User.find().sort({ createdAt: -1 });
        res.json(users);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// UPDATE user (the user themselves, or an admin)
router.put('/:id', authenticate, async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin';
        const isOwner = req.user.id === req.params.id;

        if (!isAdmin && !isOwner) {
            return res.status(403).json({
                message: "You can only update your own account"
            });
        }

        const updates = { ...req.body };

        // only an admin may change a role
        if (!isAdmin) delete updates.role;

        if (updates.Email) {
            updates.Email = updates.Email.toLowerCase().trim();
        }

        // re-hash the password only if a new one was sent
        if (updates.Password) {
            updates.Password = await bcrypt.hash(updates.Password, 10);
        }

        const updated = await User.findByIdAndUpdate(
            req.params.id,
            { $set: updates },
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(404).json({ message: 'User not found' });
        }

        const { Password, ...safeUser } = updated.toObject();
        res.status(200).json(safeUser);
    } catch (err) {
        if (err.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid user id' });
        }
        if (err.code === 11000) {
            return res.status(409).json({ message: 'Email already in use' });
        }
        res.status(500).json({ message: err.message });
    }
});

// DELETE user (admin only)
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
    try {
        const deleted = await User.findByIdAndDelete(req.params.id);

        if (!deleted) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json({ message: 'User deleted successfully' });
    } catch (err) {
        if (err.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid user id' });
        }
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;