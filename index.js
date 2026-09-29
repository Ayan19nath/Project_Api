const express = require('express');
require('dotenv').config();
const app = express();


app.use(express.json());
const mongoose=require('mongoose');
const category=require("./routes/categoryRouter");
const user=require("./routes/userRouter");
const mongoURI=process.env.mongodb_URL 

mongoose.connect(mongoURI).then(() =>{
    console.log('connection established with MONGODB')
}).catch((err)=>{console.log('connection Error ' +err)});






app.get('/', (req, res) => {
    res.send('Welcome to the Category API');
});

app.use('/category', category);
app.use('/user', user);
app.listen(4500, () => {
    console.log('Server running on port 4500');
});