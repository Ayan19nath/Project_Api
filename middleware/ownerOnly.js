// Allows only the owner admin (isOwner is stored inside the login token)
function ownerOnly(req, res, next) {
    if (!req.user?.isOwner) {
        return res.status(403).json({ message: 'Only the owner can do this.' });
    }
    next();
}

module.exports = ownerOnly;