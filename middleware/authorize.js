function authorize(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({
                message: "Access denied, you are not authorized to access this resource."
            });
        }
        next();
    };
}

module.exports = authorize;