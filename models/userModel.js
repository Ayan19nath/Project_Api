const mongoose = require('mongoose');
const bcrypt = require ('bcryptjs');

const userSchema = mongoose.Schema({
    First_name: { type: String, trim: true },
    Last_name: { type: String, trim: true },
    Email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    Password: {
        type: String,
        required: true,
        select: false
    },
    Mobile: { type: String, trim: true },
    role: {
        type: String,
        enum: ['customer', 'admin'],
        default: 'customer'
    }
});

userSchema.methods.comparePassword = function (plainPassword) {
    return bcrypt.compare(plainPassword, this.Password);
};

userSchema.pre('save', async function(next){
    if(!this.isModified('password')){
        this.password = await bcrypt.hash(this.password, 10);
    }
});

const User = mongoose.model('User', userSchema);
module.exports = User;