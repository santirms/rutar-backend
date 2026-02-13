require('dotenv').config();
const express = require('express');
const { MercadoPagoConfig, PreApproval } = require('mercadopago');
const mongoose = require('mongoose');
const cors = require('cors');

// 👇 IMPORTACIONES LOCALES
// Ajusta las rutas según tu estructura real.
// Si index.js está en la raíz, esto busca en carpeta src/
const userController = require('./src/controllers/userController');
const User = require('./src/models/User'); 

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
// RUTA 1: SINCRONIZAR USUARIO (Login / Inicio)
// ---------------------------------------------------------
app.post('/sync_user', async (req, res) => {
  const { uid, email, displayName } = req.body;
  try {
    let user = await User.findOne({ email });

    if (!user) {
      // Usuario Nuevo
      user = new User({ 
          uid, email, displayName, 
          isPro: false,
          stats: { delivered: 0, failed: 0 }
      });
      await user.save();
      console.log(`🆕 Nuevo usuario creado: ${email}`);
    } else {
      // Usuario Existente: Actualizamos datos básicos
      if (!user.uid) { user.uid = uid; user.displayName = displayName || user.displayName; }
      user.lastLogin = new Date();
      await user.save();
    }
    
    // Devolvemos todo al frontend
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
// RUTA 2: GUARDAR ENTREGA
// ---------------------------------------------------------
// Conectamos la ruta con la función del archivo userController.js
app.post('/save_stop', userController.saveStop); 


// ---------------------------------------------------------
// RUTA 3: CONTROL DE LÍMITES (Optimización)
// ---------------------------------------------------------
app.post('/check_optimization', async (req, res) => {
    const { email } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

        // Si es PRO, pase libre
        if (user.isPro) return res.json({ allowed: true, msg: "PRO ilimitado" });

        // Lógica de reseteo diario
        const hoy = new Date();
        const ultimoUso = user.lastOptimizationDate ? new Date(user.lastOptimizationDate) : null;
        
        const esMismoDia = ultimoUso && 
                           hoy.getDate() === ultimoUso.getDate() && 
                           hoy.getMonth() === ultimoUso.getMonth() && 
                           hoy.getFullYear() === ultimoUso.getFullYear();

        if (!esMismoDia) {
            user.dailyOptimizations = 0; // Nuevo día, contador a 0
        }

        // Chequeo de límite (1 por día para Free)
        if (user.dailyOptimizations >= 1) {
            return res.json({ allowed: false, msg: "Límite diario alcanzado" });
        }

        // Si pasa, descontamos
        user.dailyOptimizations += 1;
        user.lastOptimizationDate = new Date();
        await user.save();

        console.log(`📉 Optimización usada por ${email}. Total hoy: ${user.dailyOptimizations}`);
        res.json({ allowed: true, usage: user.dailyOptimizations });

    } catch (error) {
        console.error("Error check_optimization:", error);
        res.status(500).json({ error: "Error de servidor" });
    }
});

// ---------------------------------------------------------
// RUTA 4: WEBHOOK MERCADO PAGO
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

            // CASO A: ALTA (Authorized)
            if (status === 'authorized' && payerEmail) {
                let nuevoPlan = 'pro';
                if (reason && reason.toUpperCase().includes('BLACK')) nuevoPlan = 'black';

                let user = await User.findOne({ email: payerEmail });
                
                if (user) {
                    // Usuario existe -> Upgrade
                    user.isPro = true;
                    user.planType = nuevoPlan;
                    user.subscriptionId = data.id;
                    user.updatedAt = new Date();
                    await user.save();
                    console.log(`✅ ${payerEmail} actualizado a PRO`);
                } else {
                    // Usuario Web (Pre-creación)
                    const newUser = new User({
                        uid: null, 
                        email: payerEmail, 
                        displayName: 'Usuario Web', 
                        isPro: true, 
                        planType: nuevoPlan, 
                        subscriptionId: data.id, 
                        createdAt: new Date(), 
                        stats: { delivered: 0, failed: 0 }
                    });
                    await newUser.save();
                    console.log(`🆕 Usuario Web PRE-CREADO: ${payerEmail}`);
                }
            }

            // CASO B: BAJA (Cancelled / Paused)
            if ((status === 'cancelled' || status === 'paused') && payerEmail) {
                await User.findOneAndUpdate(
                    { email: payerEmail },
                    { 
                        isPro: false, 
                        planType: 'free', 
                        updatedAt: new Date() 
                    }
                );
                console.log(`❌ ${payerEmail} volvió a FREE`);
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error("❌ Error en Webhook:", error);
        res.sendStatus(200);
    }
});

// ---------------------------------------------------------
// RUTA 5: UPDATE PROFILE (Dirección de casa)
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