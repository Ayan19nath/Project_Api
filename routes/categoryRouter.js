const router = require('express').Router();
const Category = require('../models/categoryModel');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const admin = [authenticate, authorize('admin')];

router.get('/', async (req, res) => {
    try {
        res.json(await Category.find());
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/', admin, async (req, res) => {
    try {
        res.status(201).json(await Category.create(req.body));
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

router.put('/:id', admin, async (req, res) => {
    try {
        const cat = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!cat) return res.status(404).json({ message: 'Category not found' });
        res.json(cat);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

router.delete('/:id', admin, async (req, res) => {
    try {
        const cat = await Category.findByIdAndDelete(req.params.id);
        if (!cat) return res.status(404).json({ message: 'Category not found' });
        res.json({ message: 'Category deleted' });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

module.exports = router;