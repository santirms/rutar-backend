const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const { MercadoPagoConfig, PreApproval, Payment } = require('mercadopago');

require('dotenv').config();

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
  const { uid, email, displayName, photoURL } = req.body;
  try {
    let user = await User.findOne({ email });

    if (!user) {
      // Usuario Nuevo
      user = new User({ 
          uid, email, displayName, photoURL,
          isPro: false,
          stats: { delivered: 0, failed: 0 }
      });
      await user.save();
      console.log(`🆕 Nuevo usuario creado: ${email}`);
    } else {
      // USUARIO EXISTENTE
      if (!user.uid) user.uid = uid;
      
      // Actualizamos nombre y foto si vienen nuevos
      if (displayName) user.displayName = displayName;
      if (photoURL) user.photoURL = photoURL; // <--- Actualizamos la foto al loguearse
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
// RUTA 4: WEBHOOK (Versión "Cazador de Pagos" 🏹)
// ---------------------------------------------------------
app.post('/webhook', async (req, res) => {
    // A veces MP manda 'data.id', a veces manda el ID en 'data' directo, o por query.
    // Normalizamos para encontrar el ID y el Tipo.
    const body = req.body;
    const query = req.query;
    
    // Prioridad 1: Tipo en el body (JSON). Prioridad 2: Topic en la URL.
    const type = body.type || query.topic; 
    const dataId = body.data?.id || body.id || query.id;

    console.log(`📨 Webhook recibido: ${type} | ID: ${dataId}`);

    try {
        // CASO 1: ES UN PAGO REAL (Sea suscripción o pago único)
        if (type === 'payment') {
            const paymentClient = new Payment(client);
            const payment = await paymentClient.get({ id: dataId });
            
            // AQUI ESTÁ LA MAGIA: Buscamos external_reference (lo que pusimos en el modal)
            const emailReferencia = payment.external_reference;
            const emailPagador = payment.payer.email;
            const status = payment.status;
            
            // El email definitivo es: La referencia (prioridad) O el email de la tarjeta
            const emailFinal = emailReferencia || emailPagador;

            console.log(`💰 Pago Detectado (${status}) | Ref: ${emailReferencia} | Payer: ${emailPagador}`);

            if (status === 'approved' && emailFinal) {
                // Lógica de activación
                let user = await User.findOne({ email: emailFinal });

                if (user) {
                    user.isPro = true;
                    user.planType = 'pro'; // O 'black' según el monto payment.transaction_amount
                    user.updatedAt = new Date();
                    await user.save();
                    console.log(`✅ USUARIO ACTIVADO: ${emailFinal}`);
                } else {
                    // Crear usuario "fantasma" esperando que se registre
                    const newUser = new User({
                        uid: null, 
                        email: emailFinal, 
                        displayName: 'Usuario Web', 
                        photoURL: "",
                        isPro: true, 
                        planType: 'pro', 
                        createdAt: new Date(), 
                        stats: { delivered: 0, failed: 0 }
                    });
                    await newUser.save();
                    console.log(`🆕 USUARIO CREADO (Pago Web): ${emailFinal}`);
                }
            }
        }

        // CASO 2: BAJAS DE SUSCRIPCIÓN (Esto sigue igual)
        if (type === 'subscription_preapproval') {
            const preapproval = new PreApproval(client);
            const sub = await preapproval.get({ id: dataId });
            
            if (sub.status === 'cancelled' || sub.status === 'paused') {
                const email = sub.external_reference || sub.payer_email;
                console.log(`📉 Baja detectada para: ${email}`);
                
                if (email) {
                    const user = await User.findOne({ email: email });
                    if (user) {
                        user.isPro = false;
                        user.planType = 'free';
                        await user.save();
                        console.log("❌ Usuario pasado a FREE.");
                    }
                }
            }
        }

        res.sendStatus(200);
    } catch (error) {
        console.error("❌ Error Webhook:", error.message);
        // Respondemos 200 igual para que MP no se enoje
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