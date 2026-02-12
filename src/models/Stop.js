// models/Stop.js
const mongoose = require('mongoose');

const StopSchema = new mongoose.Schema({
  driverUid: {
    type: String,
    required: true,
    index: true // Para buscar rápido por chofer
  },
  address: {
    type: String,
    required: true
  },
  lat: Number,
  lng: Number,
  status: {
    type: String,
    enum: ['DONE', 'FAILED'], // Solo guardamos lo completado
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now // Guarda la hora exacta automáticamente
  }
});

module.exports = mongoose.model('Stop', StopSchema);