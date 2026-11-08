const mongoose = require('mongoose');
require('./categoryModel'); // registers the category model used by populate

// One product image (stored on Cloudinary)
const imageSchema = new mongoose.Schema({ url: String, cloudinaryId: String }, { _id: false });

const itemSchema = mongoose.Schema({
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    brand: { type: String, trim: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'category', required: true },
    price: { type: Number, required: true, min: 0 },
    oldPrice: { type: Number, min: 0, default: 0 },
    rating: { type: Number, min: 0, max: 5, default: 0 },
    reviews: { type: Number, min: 0, default: 0 },
    stock: { type: Number, min: 0, default: 0 },
    features: [String],
    images: [imageSchema] // up to 4 images, the first one is the main image
}, { timestamps: true });

module.exports = mongoose.model('Item', itemSchema);