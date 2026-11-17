const mongoose = require('mongoose');

// Last known position of the delivery person for one order (deleted automatically 24 hours after the last update)
const trackingSchema = mongoose.Schema({
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', unique: true, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    at: { type: Date, default: Date.now, expires: 60 * 60 * 24 }
});

module.exports = mongoose.model('Tracking', trackingSchema);