const mongoose = require('mongoose');
require('./categoryModel');

const itemSchema=mongoose.Schema({
    title:{type:string},
    description:{type:string},
    price:{type:number},
    imageUrl:{type:string},
    cloudinary_id
