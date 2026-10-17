const express = require('express');
const router = express.Router();
const Category = require('../models/categoryModel');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

// GET all categories (public)
router.get('/', async (req, res) => {
    try {
        const allcategory = await Category.find();
        res.json(allcategory);
    } catch (err) {
        res.status(500).json({
            message: err.message
        });
    }
});

// CREATE category (login required)
router.post('/', authenticate, authorize('admin'), async (req, res) => {
    try {
        const newCat = new Category(req.body);
        const save = await newCat.save();
        res.status(201).json(save);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// DELETE category (login required)
router.delete('/:id', authenticate, async (req, res) => {
    const id = req.params.id;
    try {
        const delCategory = await Category.findByIdAndDelete(id);
        if (!delCategory) {
            return res.status(404).json({
                message: "Category details not found."
            });
        }
        return res.json(delCategory);
    } catch (err) {
        return res.status(500).json({
            message: err.message
        });
    }
});

// UPDATE category (login required)
router.put('/:id', authenticate,authorize('admin'), async (req, res) => {
    try {
        const updCategory = await Category.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        );
        if (!updCategory) {
            return res.status(404).json({
                message: "Category not updated"
            });
        }
        return res.json(updCategory);
    } catch (err) {
        return res.status(500).json({
            message: err.message
        });
    }
});

module.exports = router;