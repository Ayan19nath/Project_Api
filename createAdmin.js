require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/userModel');

const [email, password] = process.argv.slice(2);

(async () => {
    if (!email || !password) {
        console.log('Usage: node createAdmin.js <email> <password>');
        process.exit(1);
    }
    await mongoose.connect(process.env.mongodb_URL);

    const exists = await User.findOne({ Email: email.toLowerCase() });
    if (exists) {
        console.log('A user with this email already exists');
    } else {
        await User.create({
            First_name: 'Admin',
            Last_name: 'User',
            Email: email,
            Password: await bcrypt.hash(password, 10),
            role: 'admin'
        });
        console.log('Admin created');
    }
    process.exit();
})();