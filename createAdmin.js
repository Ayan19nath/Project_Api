require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/userModel');

// Usage: node createAdmin.js <email> <password> "<First name>" "<Last name>"
const [email, password, firstName = 'Admin', lastName = ''] = process.argv.slice(2);

(async () => {
    if (!email || !password) {
        console.log('Usage: node createAdmin.js <email> <password> "<First name>" "<Last name>"');
        process.exit(1);
    }
    await mongoose.connect(process.env.mongodb_URL);

    // Only one owner is allowed
    if (await User.findOne({ isOwner: true })) {
        console.log('An owner already exists.');
        process.exit(1);
    }

    // Email must not be used already
    if (await User.findOne({ Email: email.toLowerCase() })) {
        console.log('A user with this email already exists.');
        process.exit(1);
    }

    await User.create({
        First_name: firstName,
        Last_name: lastName,
        Email: email,
        Password: await bcrypt.hash(password, 10),
        role: 'admin',
        isOwner: true
    });
    console.log('Owner admin created.');
    process.exit();
})();