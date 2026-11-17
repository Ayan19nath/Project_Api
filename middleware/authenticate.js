const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const { signToken } = require('../utils/token');

const RENEW_AFTER = 24 * 60 * 60; // seconds

// Checks the login token. A token older than a day is replaced by a fresh one
// (sent back in the x-new-token header), so people who keep using the site stay logged in.
// An admin is also checked in the database on every request, so a removed admin loses access at once.
async function authenticate(req, res, next) {
    const token = req.header('Authorization')?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Access denied. no token provided.' });

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return res.status(401).json({ message: 'Invalid token.' });
    }
    req.user = decoded;

    const old = Date.now() / 1000 - decoded.iat > RENEW_AFTER;
    if (old || decoded.role === 'admin') {
        try {
            const user = await User.findById(decoded.id);
            // the account was deleted, or an admin is not an admin any more
            if (!user || (decoded.role === 'admin' && user.role !== 'admin')) {
                return res.status(401).json({ message: 'Invalid token.' });
            }
            if (old) {
                const fresh = signToken(user);
                req.user = jwt.decode(fresh); // up-to-date role and owner flag
                res.set('x-new-token', fresh);
            }
        } catch {
            return res.status(401).json({ message: 'Invalid token.' });
        }
    }
    next();
}

module.exports = authenticate;