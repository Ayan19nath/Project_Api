/*const express = require('express');
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
*/
const express = require('express');
require('dotenv').config();
const mongoose = require('mongoose');
const category = require('./routes/categoryRouter');
const user = require('./routes/userRouter');

const app = express();
app.use(express.json());

const mongoURI = process.env.mongodb_URL;

// reuse one connection attempt (important on Vercel)
let connectionPromise = null;
function connectDB() {
    if (mongoose.connection.readyState === 1) return Promise.resolve();
    if (!connectionPromise) {
        connectionPromise = mongoose
            .connect(mongoURI, { serverSelectionTimeoutMS: 8000 })
            .then(() => console.log('connection established with MONGODB'))
            .finally(() => { connectionPromise = null; });
    }
    return connectionPromise;
}

// make sure the DB is connected before any route runs
app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        res.status(500).json({ message: 'Database connection error: ' + err.message });
    }
});

app.get('/', (req, res) => {
    res.send('Welcome to the Category API');
});

app.use('/category', category);
app.use('/user', user);

// only listen when running locally (node index.js)
if (require.main === module) {
    app.listen(4500, () => {
        console.log('Server running on port 4500');
    });
}

module.exports = app;