require('dotenv').config();
const express = require('express');
const { MercadoPagoConfig, PreApproval } = require('mercadopago');
const mongoose = require('mongoose');
const cors = require('cors'); // Recomendado si llamás desde web, opcional si solo es app/webhook

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
  planType: { type: String, default: 'free' }, // 'free', 'pro', 'black'
  updatedAt: Date
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
      user = new User({ uid, email, displayName, isPro: false });
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
    
    // Devolvemos el estado REAL (Si el webhook lo puso PRO, acá devolvemos true)
    res.json({ 
        success: true, 
        isPro: user.isPro, 
        planType: user.planType,
        homeAddress: user.homeAddress 
    });
  } catch (error) {
    console.error("Error Mongo Sync:", error);
    res.status(500).json({ error: "Error de base de datos" });
  }
});

// ---------------------------------------------------------
// RUTA 2: WEBHOOK (Con lógica de Pre-Creación)
// ---------------------------------------------------------
app.post('/webhook', async (req, res) => {
    const { type, data } = req.body;

    try {
        if (type === 'subscription_preapproval') {
            const preapproval = new PreApproval(client);
            const sub = await preapproval.get({ id: data.id });
            
            // Debug: Si el mail viene vacío, esto nos va a mostrar qué está llegando
            if (!sub.payer_email) console.log("DATAZO MP:", JSON.stringify(sub, null, 2));

            const status = sub.status;      
            const payerEmail = sub.payer_email; 
            const reason = sub.reason;      

            console.log(`🔔 Webhook: ${payerEmail} | Estado: ${status}`);

            if (status === 'authorized' && payerEmail) {
                let nuevoPlan = 'pro';
                if (reason && reason.toUpperCase().includes('BLACK')) nuevoPlan = 'black';

                // 1. Buscamos si el usuario YA existe
                let user = await User.findOne({ email: payerEmail });

                if (user) {
                    // CASO A: El usuario ya usaba la app -> Lo actualizamos
                    user.isPro = true;
                    user.planType = nuevoPlan;
                    user.subscriptionId = data.id;
                    user.updatedAt = new Date();
                    await user.save();
                    console.log(`✅ Usuario existente ${payerEmail} actualizado a PRO.`);
                } else {
                    // CASO B (EL TUYO): Pagó desde la web y nunca entró a la app -> LO CREAMOS
                    const newUser = new User({
                        uid: null, // Todavía no tiene UID de Firebase
                        email: payerEmail,
                        displayName: 'Usuario Web (Pendiente)', // Nombre temporal
                        isPro: true,
                        planType: nuevoPlan,
                        subscriptionId: data.id,
                        createdAt: new Date()
                    });
                    await newUser.save();
                    console.log(`🆕 Usuario Web PRE-CREADO: ${payerEmail}. Esperando que baje la app...`);
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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server RutAR corriendo en puerto ${port}`));