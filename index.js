require('dotenv').config();
const express = require('express');
const { MercadoPagoConfig, PreApproval } = require('mercadopago');
const mongoose = require('mongoose');
const cors = require('cors');

// 👇 1. IMPORTAMOS TU CONTROLADOR (Aquí está la magia)
const userController = require('../controllers/userController');
const User = require('../models/User'); // Asegurate de tener el modelo User también importado si usas lógica inline

const app = express();
app.use(express.json());
app.use(cors());

// CONEXIÓN A MONGODB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🍃 MongoDB Conectado'))
  .catch(err => console.error('Error Mongo:', err));

// CONFIG MERCADO PAGO
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

// ==========================================
//              RUTAS (ENDPOINTS)
// ==========================================

// ---------------------------------------------------------
// RUTA 1: SINCRONIZAR USUARIO (Mantenemos la lógica inline si te funcionaba bien)
// ---------------------------------------------------------
app.post('/sync_user', async (req, res) => {
  const { uid, email, displayName } = req.body;
  try {
    let user = await User.findOne({ email });
    if (!user) {
      user = new User({ 
          uid, email, displayName, isPro: false,
          stats: { delivered: 0, failed: 0 }
      });
      await user.save();
      console.log(`🆕 Nuevo usuario: ${email}`);
    } else {
      if (!user.uid) { user.uid = uid; user.displayName = displayName || user.displayName; }
      user.lastLogin = new Date();
      await user.save();
    }
    res.json({ 
        success: true, 
        isPro: user.isPro, 
        planType: user.planType,
        homeAddress: user.homeAddress,
        stats: user.stats || { delivered: 0, failed: 0 }
    });
  } catch (error) {
    console.error("Error Mongo Sync:", error);
    res.status(500).json({ error: "Error de base de datos" });
  }
});

// ---------------------------------------------------------
// RUTA 2: GUARDAR ENTREGA (Conectado al Controlador) 🚨 ¡AQUÍ ESTABA EL ERROR 404!
// ---------------------------------------------------------
// Le decimos a Express: "Cuando te llamen a /save_stop, usá la función saveStop del controlador"
app.post('/save_stop', userController.saveStop); 


// ---------------------------------------------------------
// RUTA 3: CONTROL DE LÍMITES (Optimización)
// ---------------------------------------------------------
app.post('/check_optimization', async (req, res) => {
    // ... (Tu lógica de check_optimization que vimos antes) ...
    // Si querés te la pego completa aquí, pero lo importante es el save_stop arriba
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
        
        if (user.isPro) return res.json({ allowed: true });

        const hoy = new Date();
        const ultimoUso = user.lastOptimizationDate ? new Date(user.lastOptimizationDate) : null;
        const esMismoDia = ultimoUso && hoy.toDateString() === ultimoUso.toDateString();

        if (!esMismoDia) user.dailyOptimizations = 0;

        if (user.dailyOptimizations >= 1) return res.json({ allowed: false });

        user.dailyOptimizations += 1;
        user.lastOptimizationDate = new Date();
        await user.save();
        res.json({ allowed: true });
    } catch (e) { res.status(500).json({ error: "Error" }); }
});

// ---------------------------------------------------------
// RUTA 4: WEBHOOK
// ---------------------------------------------------------
app.post('/webhook', async (req, res) => {
    // ... (Tu lógica de Webhook que ya funcionaba) ...
    // Resumido para no hacer spam de código, asegurate de tenerlo
    res.sendStatus(200);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server RutAR corriendo en puerto ${port}`));