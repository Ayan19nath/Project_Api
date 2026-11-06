const mongoose = require('mongoose');
require('./categoryModel');

const itemSchema=mongoose.Schema({
    title:{type:string},
    description:{type:string},
    price:{type:number},
    imageUrl:{type:string},
    cloudinaryId:{type:String},
    category:{type:mongoose.Schema.Types.ObjectId,ref:'category'}
},{timestamps:true});

module.exports=mongoose.model("Item", itemSchema);


