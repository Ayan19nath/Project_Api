const express = require('express');
require('dotenv').config();
const app = express();


app.use(express.json());
const mongoose=require('mongoose');
//const mongoURI=process.env.mongodb_URL 

mongoose.connect("mongodb+srv://20ayannath06_db_user:3fxdKNyCLdNARVte@cluster0.ihzsssa.mongodb.net/HomeAppliance").then(() =>{
    console.log('connection established with MONGODB')
}).catch((err)=>{console.log('connection Error ' +err)});

const category=require("./routes/categoryRouter");




app.get('/', (req, res) => {
    res.send('Welcome to the Category API');
});

app.use('/category', category);

app.listen(4500, () => {
    console.log('Server running on port 4500');
});