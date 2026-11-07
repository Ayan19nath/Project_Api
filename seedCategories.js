require('dotenv').config();
const mongoose = require('mongoose');
const cloudinary = require('./config/cloudinary');
const Category = require('./models/categoryModel');

// First run:  node seedCategories.js --reset   (also removes the old test categories)
// Later runs: node seedCategories.js           (only adds categories that are missing)

// [name, description, icon, image]
const data = [
    ["Home Appliances", "Refrigerators, Washing Machines, Microwaves & more.", "Refrigerator", "https://tse2.mm.bing.net/th/id/OIP.8OxfSWFa92c6GxCm2oYA5gHaEO?r=0&pid=Api&P=0&h=180"],
    ["Televisions", "Smart TVs, LED, 4K UHD and more.", "Tv", "https://tse3.mm.bing.net/th/id/OIP.qzmIFSQFX4KV9I0FlYWYegHaE9?r=0&pid=Api&P=0&h=180"],
    ["Audio & Music", "Speakers, Headphones, Soundbars & more.", "Music2", "https://tse2.mm.bing.net/th/id/OIP.z9KPIi84i35lDYZDk-VVcQHaEK?r=0&pid=Api&P=0&h=180"],
    ["Kitchen Appliances", "Mixer Grinder, Induction Cooktop, OTG & more.", "CookingPot", "https://images.unsplash.com/photo-1556911220-e15b29be8c8f?auto=format&fit=crop&w=900&q=80"],
    ["Small Appliances", "Electric Kettle, Toaster, Vacuum Cleaner & more.", "Fan", "https://images.unsplash.com/photo-1585515320310-259814833e62?auto=format&fit=crop&w=900&q=80"],
    ["Air Conditioners", "Split, Window, Inverter AC & more.", "Snowflake", "https://tse3.mm.bing.net/th/id/OIP.gs22c9q60Ohnr6PvK4Z8lwHaD3?r=0&pid=Api&P=0&h=180"],
    ["Water Purifiers", "RO, UV, and more.", "Droplets", "https://tse4.mm.bing.net/th/id/OIP.YFTva5SDQJvm4-b_v_3mSQAAAA?r=0&pid=Api&P=0&h=180"],
    ["Personal Care", "Shavers, Hair Dryers, Grooming Kit & more.", "Headphones", "https://sourcing-media.hktdc.com/product/14-in-1-grooming-kit/14eec92f74ea4546b86aa100fee7446b"],
    ["Accessories", "Cables, Adapters, Remote, Batteries & more.", "Plug", "https://tse3.mm.bing.net/th/id/OIP.I3kc_VT4RpA8MsRjZOGyOwHaEO?r=0&pid=Api&P=0&h=180"],
];

(async () => {
    await mongoose.connect(process.env.mongodb_URL);

    // Remove the old test categories (and their images)
    if (process.argv.includes('--reset')) {
        for (const old of await Category.find()) {
            if (old.cloudinaryId) await cloudinary.uploader.destroy(old.cloudinaryId).catch(() => {});
        }
        await Category.deleteMany({});
        console.log('Old categories removed.');
    }

    for (const [cat_name, cat_description, cat_icon, image] of data) {
        if (await Category.findOne({ cat_name })) {
            console.log(`Skipped (already exists): ${cat_name}`);
            continue;
        }

        // Upload the image to Cloudinary; if it fails, keep the original link
        let cat_image = image;
        let cloudinaryId;
        try {
            const result = await cloudinary.uploader.upload(image, { folder: 'homehub/categories' });
            cat_image = result.secure_url;
            cloudinaryId = result.public_id;
        } catch {
            console.log(`Image upload failed for ${cat_name}, using the original link.`);
        }

        await Category.create({ cat_name, cat_description, cat_icon, cat_image, cloudinaryId });
        console.log(`Added: ${cat_name}`);
    }
    process.exit();
})();