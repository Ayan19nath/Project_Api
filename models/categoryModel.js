const mongoose = require('mongoose');

const categorySchema = mongoose.Schema({
    cat_name: { type: String, required: true, unique: true, trim: true },
    cat_description: { type: String, trim: true },
    cat_image: String,     // image link (Cloudinary)
    cat_icon: String,      // icon name shown on the site, e.g. "Refrigerator"
    cloudinaryId: String   // used to delete the image from Cloudinary
});

module.exports = mongoose.model('category', categorySchema);