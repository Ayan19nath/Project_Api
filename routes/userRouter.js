const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const User = require('../models/userModel');

router.post('/', async (req, res) => {
    try {
        // hash the password before saving
        const hashedPassword = await bcrypt.hash(req.body.Password, 10);

        const newUser = new User({
            ...req.body,
            Password: hashedPassword
        });
        const save = await newUser.save();

        // don't send the password back to the client
        const { Password, ...safeUser } = save.toObject();
        res.status(201).json(safeUser);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});


// UPDATE user (only the fields sent)
router.put('/:id', async (req, res) => {
    try {
        const updates = { ...req.body };

        // re-hash the password only if a new one was sent
        if (updates.Password) {
            updates.Password = await bcrypt.hash(updates.Password, 10);
        }

        const updated = await User.findByIdAndUpdate(
            req.params.id,
            { $set: updates },
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(404).json({ message: 'User not found' });
        }

        // don't send the password back to the client
        const { Password, ...safeUser } = updated.toObject();
        res.status(200).json(safeUser);
    } catch (err) {
        if (err.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid user id' });
        }
        res.status(500).json({ message: err.message });
    }
});

// DELETE user
router.delete('/:id', async (req, res) => {
    try {
        const deleted = await User.findByIdAndDelete(req.params.id);

        if (!deleted) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json({ message: 'User deleted successfully' });
    } catch (err) {
        if (err.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid user id' });
        }
        res.status(500).json({ message: err.message });
    }
});

/*router.get('/' ,async  (req,res) => {
    try{
    const allcategory =  await Category.find()
    res.json(allcategory)
    }catch(err){
        res.json({
        message:err.message})
    }
} );*/

/*router.post('/' ,async  (req,res) => {
    try{
        const newUser=new User(req.body);
        //console.log(req.body)
        const save= await newUser.save();
        res.json(save);
    }catch(err){
        res.json({message:err.message})
    }
});*/

/*router.delete('/:id',async (req, res)=>{
    id=req.params.id
    try{
        const delCategory= await Category.findByIdAndDelete(id)
        if(!delCategory){
            return res.status(400).json({
                message:"Category details not found."
            })
        }else{
            return res.json(delCategory);
        }
    }catch(err){
        return res.json({
            message:err.message
        })
    }
});

router.put('/:id', async (req, res) => {
    try {
        const updCategory = await Category.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        );
        if (!updCategory) {
            return res.json({
                message: "Category not updated"
            });
        }
        return res.json(updCategory);
    } catch (err) {
        return res.json({
            message: err.message
        });
    }
});*/

module.exports=router;