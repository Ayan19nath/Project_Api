const mongoose = require('mongoose');

const userSchema=mongoose.Schema({
    First_name:{type:String},
    Last_name:{type:String},
    Email:{type:String},
    Password:{type:String},
    Mobile:{type:String},
    role:{
    type:String,
    enum:['customer','admin'],
    default:'customer'
}
});

const User = mongoose.model('User', userSchema);
module.exports = User;