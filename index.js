require('dotenv').config();
const express = require('express');
const { MercadoPagoConfig, PreApproval } = require('mercadopago');
const mongoose = require('mongoose');
const cors = require('cors');

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
  homeAddress: {
    description: String,
    lat: Number,
    lng: Number
  },
  planType: { type: String, default: 'free' },
  updatedAt: Date,
  createdAt: Date,
  
  // --- NUEVO: ESTADÍSTICAS ---
  stats: {
    delivered: { type: Number, default: 0 },
    failed: { type: Number, default: 0 }
  }
});

const User = mongoose.model('User', UserSchema);

// CONFIG MERCADO PAGO
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

// ---------------------------------------------------------
// RUTA 1: SINCRONIZAR USUARIO (Vinculación Inteligente)
// ---------------------------------------------------------
app.post('/sync_user', async (req, res) => {
  const { uid, email, displayName, photoURL } = req.body;

  try {
    let user = await User.findOne({ email });

    if (!user) {
      // CASO 1: Usuario nuevo total (No pagó, no existe) -> Lo creamos Free
      user = new User({ 
          uid, 
          email, 
          displayName, 
          isPro: false,
          stats: { delivered: 0, failed: 0 } // Inicializamos stats
      });
      await user.save();
      console.log(`🆕 Nuevo usuario App: ${email}`);
    } else {
      // CASO 2: Usuario que ya existía (O lo creó el Webhook antes)
      console.log(`👋 Usuario reconocido: ${email}`);
      
      // Si el usuario fue creado por el Webhook, no tenía UID. Se lo ponemos ahora.
      if (!user.uid) {
          user.uid = uid;
          user.displayName = displayName || user.displayName;
          console.log(`🔗 ¡Cuenta Web vinculada con App exitosamente!`);
      }
      
      // Actualizamos datos básicos siempre
      user.lastLogin = new Date();
      await user.save();
    }
    
    // Devolvemos el estado REAL + LAS ESTADÍSTICAS
    res.json({ 
        success: true, 
        isPro: user.isPro, 
        planType: user.planType,
        homeAddress: user.homeAddress,
        stats: user.stats || { delivered: 0, failed: 0 } // <--- ESTO ES IMPORTANTE PARA TU PERFIL
    });
  } catch (error) {
    console.error("Error Mongo Sync:", error);
    res.status(500).json({ error: "Error de base de datos" });
  }
});

// ---------------------------------------------------------
// RUTA 2: WEBHOOK (Alta y Baja automática)
// ---------------------------------------------------------
app.post('/webhook', async (req, res) => {
    const { type, data } = req.body;

    try {
        if (type === 'subscription_preapproval') {
            const preapproval = new PreApproval(client);
            const sub = await preapproval.get({ id: data.id });
            
            if (!sub.payer_email) console.log("DATAZO MP:", JSON.stringify(sub, null, 2));

            const status = sub.status;      
            const payerEmail = sub.payer_email; 
            const reason = sub.reason;      

            console.log(`🔔 Webhook: ${payerEmail} | Estado: ${status}`);

            // CASO 1: ALTA DE SUSCRIPCIÓN (Authorized)
            if (status === 'authorized' && payerEmail) {
                let nuevoPlan = 'pro';
                if (reason && reason.toUpperCase().includes('BLACK')) nuevoPlan = 'black';

                // Buscamos si el usuario YA existe
                let user = await User.findOne({ email: payerEmail });

                if (user) {
                    // Usuario existente -> Lo hacemos PRO
                    user.isPro = true;
                    user.planType = nuevoPlan;
                    user.subscriptionId = data.id;
                    user.updatedAt = new Date();
                    await user.save();
                    console.log(`✅ Usuario existente ${payerEmail} actualizado a PRO.`);
                } else {
                    // Usuario Web (No tiene App aún) -> Lo PRE-CREAMOS
                    const newUser = new User({
                        uid: null, 
                        email: payerEmail,
                        displayName: 'Usuario Web (Pendiente)', 
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

            // CASO 2: BAJA DE SUSCRIPCIÓN (Cancelled o Paused)
            if ((status === 'cancelled' || status === 'paused') && payerEmail) {
                const userBaja = await User.findOneAndUpdate(
                    { email: payerEmail },
                    { 
                        isPro: false, 
                        planType: 'free',
                        updatedAt: new Date()
                    },
                    { new: true }
                );

                if (userBaja) {
                    console.log(`❌ Suscripción cancelada/pausada para ${payerEmail}. Vuelve a FREE.`);
                } else {
                    console.log(`⚠️ Llegó baja para ${payerEmail} pero el usuario no existe en la DB.`);
                }
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error("❌ Error en Webhook:", error);
        res.sendStatus(200);
    }
});

// ---------------------------------------------------------
// RUTA 3: GUARDAR DIRECCIÓN DE CASA
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

// ---------------------------------------------------------
// RUTA 4: REPORTAR ENTREGA (NUEVO) 📊
// ---------------------------------------------------------
app.post('/report_delivery', async (req, res) => {
    const { email, status } = req.body; // status: 'DONE' o 'FAILED'

    try {
        const updateField = status === 'DONE' ? 'stats.delivered' : 'stats.failed';
        
        await User.findOneAndUpdate(
            { email },
            { $inc: { [updateField]: 1 } } // Incrementa +1
        );
        
        console.log(`📊 Stats actualizadas para ${email}: ${status}`);
        res.json({ success: true });
    } catch (error) {
        console.error("Error reportando entrega:", error);
        res.status(500).json({ error: "Error de servidor" });
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server RutAR corriendo en puerto ${port}`));