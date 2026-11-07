const express = require('express');
const fs = require('fs');
const router = express.Router();
const Category = require('../models/categoryModel');
const Item = require('../models/itemModel');
const cloudinary = require('../config/cloudinary');
const upload = require('../middleware/multer');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const admin = [authenticate, authorize('admin')];

// Upload the chosen image to Cloudinary, then delete the temporary file
async function uploadImage(file) {
    try {
        return await cloudinary.uploader.upload(file.path, { folder: 'homehub/categories' });
    } finally {
        fs.unlink(file.path, () => {});
    }
}

// ========== GET ALL CATEGORIES (public) ==========
router.get('/', async (req, res) => {
    try {
        res.json(await Category.find().sort('_id'));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ========== ADD CATEGORY (admin only) ==========
router.post('/', admin, upload.single('image'), async (req, res) => {
    try {
        const { cat_name, cat_description, cat_icon } = req.body;
        const data = { cat_name, cat_description, cat_icon };

        if (req.file) {
            const result = await uploadImage(req.file);
            data.cat_image = result.secure_url;
            data.cloudinaryId = result.public_id;
        }
        res.status(201).json(await Category.create(data));
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// ========== EDIT CATEGORY (admin only, image is optional) ==========
router.put('/:id', admin, upload.single('image'), async (req, res) => {
    try {
        const cat = await Category.findById(req.params.id);
        if (!cat) return res.status(404).json({ message: 'Category not found' });

        ['cat_name', 'cat_description', 'cat_icon'].forEach((field) => {
            if (req.body[field] !== undefined) cat[field] = req.body[field];
        });

        // a new image replaces the old one
        const oldImageId = cat.cloudinaryId;
        if (req.file) {
            const result = await uploadImage(req.file);
            cat.cat_image = result.secure_url;
            cat.cloudinaryId = result.public_id;
        }

        const saved = await cat.save();
        if (req.file && oldImageId) await cloudinary.uploader.destroy(oldImageId).catch(() => {});
        res.json(saved);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// ========== DELETE CATEGORY (admin only) ==========
router.delete('/:id', admin, async (req, res) => {
    try {
        // do not leave products without a category
        if (await Item.exists({ category: req.params.id })) {
            return res.status(400).json({ message: 'This category still has products. Delete or move them first.' });
        }

        const cat = await Category.findByIdAndDelete(req.params.id);
        if (!cat) return res.status(404).json({ message: 'Category not found' });

        if (cat.cloudinaryId) await cloudinary.uploader.destroy(cat.cloudinaryId).catch(() => {});
        res.json({ message: 'Category deleted' });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

module.exports = router;