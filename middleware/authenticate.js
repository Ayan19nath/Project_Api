const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
    const token = req.header('Authorization')?.split(' ')[1];
    if (!token) {
        return res.status(401).json({
            message: "Access denied. no token provided."
        });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        console.log('JWT error:', err.message);   // remove this once it works
        return res.status(401).json({
            message: "Invalid token."
        });
    }
}

module.exports = authenticate;