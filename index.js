require('dotenv').config();
const express = require('express');
const { MercadoPagoConfig, PreApproval, Payment } = require('mercadopago');
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
// RUTA 4: WEBHOOK MERCADO PAGO (Versión "Follow the Money" 💰)
// ---------------------------------------------------------
app.post('/webhook', async (req, res) => {
    const { type, data } = req.body;
    
    // Logueamos qué llegó para debug
    console.log(`📨 Webhook recibido: ${type} | ID: ${data?.id}`);

    try {
        // CASO 1: SE APROBÓ UN PAGO (Aquí sacamos el email real)
        if (type === 'subscription_authorized_payment') {
            const paymentClient = new Payment(client);
            const payment = await paymentClient.get({ id: data.id });
            
            // Datos clave
            const payerEmail = payment.payer.email;
            const status = payment.status;
            
            // A veces el ID de suscripción viene en 'external_reference' del pago o en 'metadata'
            // Pero lo más importante es vincular el EMAIL.
            console.log(`💰 Pago detectado: ${status} | Email: ${payerEmail}`);

            if (status === 'approved' && payerEmail) {
                // Buscamos o creamos al usuario
                let user = await User.findOne({ email: payerEmail });

                if (user) {
                    user.isPro = true;
                    user.planType = 'pro';
                    user.updatedAt = new Date();
                    await user.save();
                    console.log(`✅ ${payerEmail} actualizado a PRO (vía Pago)`);
                } else {
                    // Si el usuario pagó pero no se registró en la app todavía
                    const newUser = new User({
                        uid: null, 
                        email: payerEmail, 
                        displayName: 'Usuario Web', 
                        photoURL: "",
                        isPro: true, 
                        planType: 'pro', 
                        createdAt: new Date(), 
                        stats: { delivered: 0, failed: 0 }
                    });
                    await newUser.save();
                    console.log(`🆕 Usuario Web CREADO: ${payerEmail} (vía Pago)`);
                }
            }
        }

        // CASO 2: NOVEDADES DE LA SUSCRIPCIÓN (Para bajas o pausas)
        if (type === 'subscription_preapproval') {
            const preapproval = new PreApproval(client);
            const sub = await preapproval.get({ id: data.id });
            
            const status = sub.status;
            // Intentamos leer el email por si acaso viene
            const payerEmail = sub.payer_email || (sub.payer && sub.payer.email) || sub.external_reference;

            console.log(`📋 Suscripción: ${status} | Email en contrato: ${payerEmail || 'No detectado'}`);

            // Solo nos importan las BAJAS aquí (las altas las manejamos arriba con el pago)
            if (status === 'cancelled' || status === 'paused') {
                let query = {};
                if (payerEmail) {
                    query = { email: payerEmail };
                } else {
                    // Si no hay email, buscamos por ID de suscripción (si lo hubiéramos guardado)
                    // O simplemente logueamos el error
                    console.log(`⚠️ Baja recibida sin email. ID Suscripción: ${data.id}`);
                    return res.sendStatus(200);
                }

                const user = await User.findOne(query);
                if (user) {
                    user.isPro = false;
                    user.planType = 'free';
                    user.updatedAt = new Date();
                    await user.save();
                    console.log(`❌ Usuario ${user.email} volvió a FREE (Baja detectada).`);
                }
            }
        }

        res.sendStatus(200);
    } catch (error) {
        console.error("❌ Error en Webhook:", error);
        // Respondemos 200 para que MP no siga reintentando
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