const mongoose = require('mongoose');

const categorySchema=mongoose.Schema({
    cat_name:{type:String},
    cat_email:{type:String},
    cat_city:{type:String}
});

const Category = mongoose.model('category', categorySchema);
module.exports = Category;