const express=require('express');
const router=express.Router()
const Category=require('../models/categoryModel')

router.get('/' ,async  (req,res) => {
    try{
    const allcategory =  await Category.find()
    res.json(allcategory)
    }catch(err){
        res.json({
        message:err.message})
    }
} );

router.post('/' ,async  (req,res) => {
    try{
        const newCat=new Category(req.body);
        //console.log(req.body)
        const save= await newCat.save();
        res.json(save);
    }catch(err){
        res.json({message:err.message})
    }
});

router.delete('/:id',async (req, res)=>{
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
});

module.exports=router;