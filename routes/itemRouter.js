const express = require('express');
const router = express.Router();
const Item = require('../models/itemModel');
const cloudinary = require('../config/cloudinary');
const upload = require('../middleware/multer');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');


router.post('/', upload.single('image'), async(req, res) => {
    try {
        const result=await cloudinary.uploader.upload(req.file.path);
        const newItem = new Item({
            title: req.body.name,
            description: req.body.description,
            price: req.body.price,
            imageUrl: result.secure_url,
            cloudinaryId: result.public_id,
            category: req.body.category
        });
        const save=await newItem.save();
        res.json(save);
    } catch (err){
        res.status(400).json({ message: err.message });
    }
});