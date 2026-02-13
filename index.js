require('dotenv').config();
const express = require('express');
const { MercadoPagoConfig, PreApproval } = require('mercadopago');
const mongoose = require('mongoose');
const cors = require('cors');

// --- IMPORTAMOS LOS MODELOS ---
// Asegurate de que Stop.js esté en la carpeta models
const Stop = require('./src/models/Stop'); 

const app = express();
app.use(express.json());
app.use(cors());

// 1. CONEXIÓN A MONGODB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🍃 MongoDB Conectado'))
  .catch(err => console.error('Error Mongo:', err));

// 2. MODELO DE USUARIO (SCHEMA)
const UserSchema = new mongoose.Schema({
  uid: String,
  email: { type: String, unique: true, required: true },
  displayName: String,
  isPro: { type: Boolean, default: false },
  subscriptionId: String,
  lastLogin: Date,
  homeAddress: { description: String, lat: Number, lng: Number },
  
  // CONTROL DE LÍMITES
  planType: { type: String, default: 'free' },
  dailyOptimizations: { type: Number, default: 0 },
  lastOptimizationDate: Date,
  
  updatedAt: Date,
  createdAt: Date,
  
  // ESTADÍSTICAS RÁPIDAS
  stats: {
    delivered: { type: Number, default: 0 },
    failed: { type: Number, default: 0 }
  }
});

const User = mongoose.model('User', UserSchema);

// CONFIG MERCADO PAGO
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });


// ==========================================
//              RUTAS (ENDPOINTS)
// ==========================================

// ---------------------------------------------------------
// RUTA 1: SINCRONIZAR USUARIO (Login / Inicio)
// ---------------------------------------------------------
app.post('/sync_user', async (req, res) => {
  const { uid, email, displayName, photoURL } = req.body;

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
      console.log(`👋 Usuario sync: ${email}`);
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
// RUTA 2: GUARDAR ENTREGA (HISTORIAL + ESTADÍSTICAS) 🚛 ✅
// ---------------------------------------------------------
// OJO: En la App asegurate de llamar a este nombre: /report_delivery
app.post('/report_delivery', async (req, res) => {
    // Recibimos más datos para el historial
    const { email, uid, status, address, lat, lng } = req.body; 

    try {
        // 1. GUARDAR EL DETALLE EN LA COLECCIÓN 'stops' (Historial)
        if (uid && address) {
            const newStop = new Stop({
                driverUid: uid,
                address: address,
                lat: lat || 0,
                lng: lng || 0,
                status: status, // 'DONE' o 'FAILED'
                timestamp: new Date()
            });
            await newStop.save();
            console.log(`📝 Parada guardada en historial: ${address}`);
        }

        // 2. ACTUALIZAR CONTADOR EN EL USUARIO (Perfil Rápido)
        const updateField = status === 'DONE' ? 'stats.delivered' : 'stats.failed';
        await User.findOneAndUpdate(
            { email },
            { $inc: { [updateField]: 1 } } 
        );
        
        console.log(`📊 Contador actualizado para ${email}: ${status}`);
        res.json({ success: true });
    } catch (error) {
        console.error("Error reportando entrega:", error);
        res.status(500).json({ error: "Error de servidor" });
    }
});

// ---------------------------------------------------------
// RUTA 3: CONTROL DE LÍMITES (OPTIMIZACIONES) 🚧
// ---------------------------------------------------------
app.post('/check_optimization', async (req, res) => {
    const { email } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

        if (user.isPro) {
            return res.json({ allowed: true, msg: "Usuario PRO ilimitado" });
        }

        const hoy = new Date();
        const ultimoUso = user.lastOptimizationDate ? new Date(user.lastOptimizationDate) : null;

        // Verificar si es el mismo día
        const esMismoDia = ultimoUso && 
                           hoy.getDate() === ultimoUso.getDate() && 
                           hoy.getMonth() === ultimoUso.getMonth() && 
                           hoy.getFullYear() === ultimoUso.getFullYear();

        if (!esMismoDia) user.dailyOptimizations = 0;

        // Límite: 1 por día para FREE
        if (user.dailyOptimizations >= 1) {
            return res.json({ allowed: false, msg: "Límite diario alcanzado." });
        }

        user.dailyOptimizations += 1;
        user.lastOptimizationDate = new Date();
        await user.save();

        console.log(`📉 Optimización usada por ${email}. Total hoy: ${user.dailyOptimizations}`);
        res.json({ allowed: true, usage: user.dailyOptimizations });

    } catch (error) {
        console.error("Check Optimization Error:", error);
        res.status(500).json({ error: "Error" });
    }
});

// ---------------------------------------------------------
// RUTA 4: WEBHOOK (Suscripciones)
// ---------------------------------------------------------
app.post('/webhook', async (req, res) => {
    const { type, data } = req.body;
    try {
        if (type === 'subscription_preapproval') {
            const preapproval = new PreApproval(client);
            const sub = await preapproval.get({ id: data.id });
            const status = sub.status;      
            const payerEmail = sub.payer_email; 
            const reason = sub.reason;      

            console.log(`🔔 Webhook: ${payerEmail} | Estado: ${status}`);

            // ALTA
            if (status === 'authorized' && payerEmail) {
                let nuevoPlan = 'pro';
                if (reason && reason.toUpperCase().includes('BLACK')) nuevoPlan = 'black';

                let user = await User.findOne({ email: payerEmail });
                if (user) {
                    user.isPro = true;
                    user.planType = nuevoPlan;
                    user.subscriptionId = data.id;
                    user.updatedAt = new Date();
                    await user.save();
                } else {
                    const newUser = new User({
                        uid: null, email: payerEmail, displayName: 'Usuario Web', 
                        isPro: true, planType: nuevoPlan, subscriptionId: data.id,
                        createdAt: new Date(), stats: { delivered: 0, failed: 0 }
                    });
                    await newUser.save();
                }
                console.log(`✅ ${payerEmail} ahora es PRO`);
            }

            // BAJA
            if ((status === 'cancelled' || status === 'paused') && payerEmail) {
                await User.findOneAndUpdate(
                    { email: payerEmail },
                    { isPro: false, planType: 'free', updatedAt: new Date() }
                );
                console.log(`❌ ${payerEmail} volvió a FREE`);
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error("Webhook Error:", error);
        res.sendStatus(200);
    }
});

// ---------------------------------------------------------
// RUTA 5: UPDATE PROFILE
// ---------------------------------------------------------
app.post('/update_profile', async (req, res) => {
  const { email, homeAddress } = req.body;
  try {
    await User.findOneAndUpdate({ email }, { homeAddress });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server RutAR corriendo en puerto ${port}`));