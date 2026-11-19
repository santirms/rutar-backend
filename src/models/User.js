const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  uid: String,
  email: { type: String, unique: true, required: true },
  
  // CORRECCIÓN AQUÍ 👇: Usamos displayName y quitamos el 'required' estricto de name
  displayName: String, 
  
  photoURL: String,

  isPro: { type: Boolean, default: false },
  subscriptionId: String,
  lastLogin: Date,
  activeDeviceId: { type: String, default: null },
  activeDeviceSince: { type: Date, default: null },
  homeAddress: {
    description: String,
    lat: Number,
    lng: Number
  },
  
  // CONTROL DE LÍMITES
  planType: { type: String, default: 'free' },
  dailyOptimizations: { type: Number, default: 0 },
  lastOptimizationDate: Date,
  
  updatedAt: Date,
  createdAt: Date,
  
  // ESTADÍSTICAS
  stats: {
    delivered: { type: Number, default: 0 },
    failed: { type: Number, default: 0 }
  }
});

module.exports = mongoose.model('User', UserSchema);
