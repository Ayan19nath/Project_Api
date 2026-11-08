const express = require('express');
const fs = require('fs');
const router = express.Router();
const Item = require('../models/itemModel');
const cloudinary = require('../config/cloudinary');
const upload = require('../middleware/multer');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const admin = [authenticate, authorize('admin')];

// Four image slots: Front, Back, Side, Detail
const imageFields = upload.fields([0, 1, 2, 3].map((i) => ({ name: `image${i}`, maxCount: 1 })));

// Shape of a product sent to the website
const toClient = (item) => {
    const o = item.toObject();
    const old = o.oldPrice || 0;
    return {
        id: o._id,
        name: o.name,
        description: o.description,
        brand: o.brand,
        category: o.category?.cat_name || '',
        categoryId: o.category?._id || o.category,
        price: o.price,
        oldPrice: old,
        discount: old > o.price ? Math.round(((old - o.price) / old) * 100) : 0,
        rating: o.rating,
        reviews: o.reviews,
        stock: o.stock,
        features: o.features,
        images: o.images.map((img) => img.url),
        image: o.images[0]?.url || ''
    };
};

// Text fields from the admin form
const readFields = (b) => ({
    name: b.name,
    description: b.description,
    brand: b.brand,
    category: b.category,
    price: b.price,
    oldPrice: b.oldPrice || 0,
    rating: b.rating || 0,
    reviews: b.reviews || 0,
    stock: b.stock || 0,
    features: String(b.features || '').split(',').map((f) => f.trim()).filter(Boolean)
});

// Delete the temporary upload files
const cleanup = (req) =>
    Object.values(req.files || {}).flat().forEach((f) => fs.unlink(f.path, () => {}));

// Delete one image from Cloudinary
const destroy = (img) =>
    img.cloudinaryId ? cloudinary.uploader.destroy(img.cloudinaryId).catch(() => {}) : null;

// Work out the new image list from the 4 slots.
// next = images to keep, old = replaced or removed images (to delete from Cloudinary)
async function applyImages(req, current = []) {
    const files = req.files || {};
    const removed = [].concat(req.body.removeImages || []).map(Number);
    const next = [];
    const old = [];

    for (let i = 0; i < 4; i++) {
        const file = files[`image${i}`]?.[0];
        const existing = current[i];

        if (file) {
            const result = await cloudinary.uploader.upload(file.path, { folder: 'homehub/products' });
            next.push({ url: result.secure_url, cloudinaryId: result.public_id });
            if (existing) old.push(existing);
        } else if (existing && !removed.includes(i)) {
            next.push({ url: existing.url, cloudinaryId: existing.cloudinaryId });
        } else if (existing) {
            old.push(existing);
        }
    }
    return { next, old };
}

// ========== GET ALL PRODUCTS (public) ==========
router.get('/', async (req, res) => {
    try {
        const items = await Item.find().populate('category').sort('_id');
        res.json(items.map((item) => toClient(item)));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ========== GET ONE PRODUCT (public) ==========
router.get('/:id', async (req, res) => {
    try {
        const item = await Item.findById(req.params.id).populate('category');
        if (!item) return res.status(404).json({ message: 'Product not found' });
        res.json(toClient(item));
    } catch {
        res.status(404).json({ message: 'Product not found' });
    }
});

// ========== ADD PRODUCT (admin only) ==========
router.post('/', admin, imageFields, async (req, res) => {
    try {
        if (!req.files?.image0) return res.status(400).json({ message: 'The first (Front) image is required' });

        const { next } = await applyImages(req);
        const item = await Item.create({ ...readFields(req.body), images: next });
        res.status(201).json(toClient(await item.populate('category')));
    } catch (err) {
        res.status(400).json({ message: err.message });
    } finally {
        cleanup(req);
    }
});

// ========== EDIT PRODUCT (admin only, images are optional) ==========
router.put('/:id', admin, imageFields, async (req, res) => {
    try {
        const item = await Item.findById(req.params.id);
        if (!item) return res.status(404).json({ message: 'Product not found' });

        const { next, old } = await applyImages(req, item.images);
        if (next.length === 0) return res.status(400).json({ message: 'A product needs at least one image' });

        item.set({ ...readFields(req.body), images: next });
        const saved = await item.save();

        await Promise.all(old.map(destroy));
        res.json(toClient(await saved.populate('category')));
    } catch (err) {
        res.status(400).json({ message: err.message });
    } finally {
        cleanup(req);
    }
});

// ========== DELETE PRODUCT (admin only, also deletes its images) ==========
router.delete('/:id', admin, async (req, res) => {
    try {
        const item = await Item.findByIdAndDelete(req.params.id);
        if (!item) return res.status(404).json({ message: 'Product not found' });

        await Promise.all(item.images.map(destroy));
        res.json({ message: 'Product deleted' });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Upload errors (wrong file type, file too big) are sent as a message
router.use((err, req, res, next) => res.status(400).json({ message: err.message }));

module.exports = router;