require('dotenv').config();
const mongoose = require('mongoose');
const cloudinary = require('./config/cloudinary');
const Category = require('./models/categoryModel');
const Item = require('./models/itemModel');

// Run once:               node seedProducts.js
// Delete all products first: node seedProducts.js --reset

// [name, category, brand, rating, reviews, price, oldPrice, image, features]
const data = [
    ["Samsung Refrigerator", "Home Appliances", "Samsung", 4.5, 124, 45999, 52999, "https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?auto=format&fit=crop&w=600&q=80", ["Double Door", "Frost Free", "Energy Efficient"]],
    ["LG Washing Machine", "Home Appliances", "LG", 4.6, 98, 32999, 38999, "https://images.unsplash.com/photo-1626806787461-102c1bfaaea1?auto=format&fit=crop&w=600&q=80", ["Fully Automatic", "Front Load", "Inverter Motor"]],
    ["Voltas AC", "Air Conditioners", "Voltas", 4.4, 76, 28999, 32999, "https://tse3.mm.bing.net/th/id/OIP.7x_RpW_l3mesRmf76RykxAHaE7?r=0&pid=Api&P=0&h=180", ["1.5 Ton", "5 Star Rating", "Inverter AC"]],
    ["Bajaj Microwave Oven", "Home Appliances", "Bajaj", 4.3, 65, 12499, 14999, "https://images.unsplash.com/photo-1585659722983-3a675dabf23d?auto=format&fit=crop&w=600&q=80", ["Convection", "20 L Capacity", "Auto Cook"]],
    ["Philips Mixer Grinder", "Kitchen Appliances", "Philips", 4.5, 110, 4999, 6099, "https://images.unsplash.com/photo-1570222094114-d054a817e56b?auto=format&fit=crop&w=600&q=80", ["750W Motor", "3 Jars", "Powerful Grinding"]],
    ['Sony TV 43"', "Televisions", "Sony", 4.6, 142, 34999, 43999, "https://images.unsplash.com/photo-1593784991095-a205069470b6?auto=format&fit=crop&w=600&q=80", ["43 Inch", "4K Ultra HD", "Smart TV"]],
    ["Honeywell Air Purifier", "Home Appliances", "Honeywell", 4.4, 87, 16999, 19999, "https://images.unsplash.com/photo-1585776245991-cf89dd7fc73a?auto=format&fit=crop&w=600&q=80", ["HEPA Filter", "Air Quality Monitor", "Silent Operation"]],
    ["Kent Water Purifier", "Water Purifiers", "Kent", 4.3, 52, 14999, 17999, "https://images.unsplash.com/photo-1564419320461-6870880221ad?auto=format&fit=crop&w=600&q=80", ["RO + UV", "8 L Capacity", "Mineral Protection"]],
    ["Philips Air Fryer", "Small Appliances", "Philips", 4.4, 73, 6999, 8499, "https://images.unsplash.com/photo-1585515320310-259814833e62?auto=format&fit=crop&w=600&q=80", ["4.1 L Capacity", "Rapid Air Technology", "Easy Cleaning"]],
];

(async () => {
    await mongoose.connect(process.env.mongodb_URL);

    // Remove old products and their images
    if (process.argv.includes('--reset')) {
        for (const old of await Item.find()) {
            await Promise.all(old.images.map((img) => img.cloudinaryId && cloudinary.uploader.destroy(img.cloudinaryId).catch(() => {})));
        }
        await Item.deleteMany({});
        console.log('Old products removed.');
    }

    for (const [name, categoryName, brand, rating, reviews, price, oldPrice, image, features] of data) {
        if (await Item.findOne({ name })) {
            console.log(`Skipped (already exists): ${name}`);
            continue;
        }

        const category = await Category.findOne({ cat_name: categoryName });
        if (!category) {
            console.log(`Category "${categoryName}" not found, skipped: ${name}`);
            continue;
        }

        // Upload the image to Cloudinary; if it fails, keep the original link
        let img = { url: image };
        try {
            const result = await cloudinary.uploader.upload(image, { folder: 'homehub/products' });
            img = { url: result.secure_url, cloudinaryId: result.public_id };
        } catch {
            console.log(`Image upload failed for ${name}, using the original link.`);
        }

        await Item.create({ name, category: category._id, brand, rating, reviews, price, oldPrice, stock: 25, features, images: [img] });
        console.log(`Added: ${name}`);
    }
    process.exit();
})();