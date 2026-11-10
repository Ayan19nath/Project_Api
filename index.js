const express = require('express');
require('dotenv').config();
const mongoose = require('mongoose');
const cors = require('cors'); // lets the React frontend call this API
const category = require('./routes/categoryRouter');
const user = require('./routes/userRouter');
const item = require('./routes/itemRouter');
const order = require('./routes/orderRouter');

const app = express();

// Only the website may call this API from a browser (set FRONTEND_URL, no trailing slash).
// Without FRONTEND_URL every website is allowed, which is fine on your own computer.
app.use(cors({
    origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',').map((s) => s.trim()) : true,
    exposedHeaders: ['x-new-token'] // lets the website read the renewed login token
}));
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
    res.send('Welcome to the Project API');
});

// routes
app.use('/category', category);
app.use('/user', user);
app.use('/item', item);
app.use('/order', order);

// only listen when running locally (node index.js)
if (require.main === module) {
    app.listen(4500, () => {
        console.log('Server running on port 4500');
    });
}

module.exports = app;