const mongoose = require('mongoose');

const categorySchema = mongoose.Schema({
    cat_name: { type: String, required: true, trim: true },
    cat_image: String,
    cat_description: String
});

module.exports = mongoose.model('category', categorySchema);