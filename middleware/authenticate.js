const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
    const token = req.header('Authorization')?.split(' ')[1];
    if (!token) {
        return res.status(401).json({
            message: "Access denied. no token provided."
        });
    }
    try {
        const decoded = jwt.verify(token, "2?u3,39M|/@,+{92,;?4yAPBH)^.=jY0*w@]Ru#AOj+");
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