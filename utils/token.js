const jwt = require('jsonwebtoken');

// How long a login lasts if the person stops using the site (it renews itself while they keep using it)
const LIFETIME = { admin: '30d', customer: '365d' };

// Login token for a customer or an admin
const signToken = (user) =>
    jwt.sign(
        { id: user._id, First_name: user.First_name, Last_name: user.Last_name, role: user.role, isOwner: user.isOwner },
        process.env.JWT_SECRET, // must be the same value everywhere
        { expiresIn: LIFETIME[user.role] || LIFETIME.customer }
    );

module.exports = { signToken };