const express = require('express');
const router = express.Router();
const Item = require('../models/itemModel');
const cloudinary = require('../config/cloudinary');
const upload = require('../middleware/multer');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

// CREATE item
router.post('/', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Image is required' });
        }
        const result = await cloudinary.uploader.upload(req.file.path);
        const newItem = new Item({
            title: req.body.title,
            description: req.body.description,
            price: req.body.price,
            imageUrl: result.secure_url,
            cloudinaryId: result.public_id,
            category: req.body.category
        });
        const saved = await newItem.save();
        res.status(201).json(saved);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// GET all items (optional filter: /item?category=<categoryId>)
router.get('/', async (req, res) => {
    try {
        const filter = {};
        if (req.query.category) filter.category = req.query.category;
        const items = await Item.find(filter)
            .populate('category')
            .sort({ createdAt: -1 });
        res.json(items);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// GET one item
router.get('/:id', async (req, res) => {
    try {
        const item = await Item.findById(req.params.id).populate('category');
        if (!item) return res.status(404).json({ message: 'Item not found' });
        res.json(item);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// UPDATE item (image is optional)
router.put('/:id', upload.single('image'), async (req, res) => {
    try {
        const item = await Item.findById(req.params.id);
        if (!item) return res.status(404).json({ message: 'Item not found' });

        // if a new image was sent, replace the old one on Cloudinary
        if (req.file) {
            await cloudinary.uploader.destroy(item.cloudinaryId);
            const result = await cloudinary.uploader.upload(req.file.path);
            item.imageUrl = result.secure_url;
            item.cloudinaryId = result.public_id;
        }

        if (req.body.title !== undefined) item.title = req.body.title;
        if (req.body.description !== undefined) item.description = req.body.description;
        if (req.body.price !== undefined) item.price = req.body.price;
        if (req.body.category !== undefined) item.category = req.body.category;

        const updated = await item.save();
        res.json(updated);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// DELETE item (also removes image from Cloudinary)
router.delete('/:id', async (req, res) => {
    try {
        const item = await Item.findById(req.params.id);
        if (!item) return res.status(404).json({ message: 'Item not found' });

        await cloudinary.uploader.destroy(item.cloudinaryId);
        await item.deleteOne();
        res.json({ message: 'Item deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;