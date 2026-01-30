require('dotenv').config();
const express = require('express');
const { MercadoPagoConfig, PreApproval, Payment } = require('mercadopago');
const mongoose = require('mongoose'); // <--- IMPORTANTE

const app = express();
app.use(express.json());

// 1. CONEXIÓN A MONGODB
// Asegurate de tener MONGO_URI en tus variables de entorno de Render
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🍃 MongoDB Conectado'))
  .catch(err => console.error('Error Mongo:', err));

// 2. MODELO DE USUARIO (SCHEMA)
const UserSchema = new mongoose.Schema({
  uid: String,
  email: { type: String, unique: true, required: true },
  displayName: String,
  isPro: { type: Boolean, default: false }, // Acá guardamos si pagó
  subscriptionId: String,
  lastLogin: Date,
  // 🏠 NUEVO: Dirección de Casa
  homeAddress: {
    description: String, // Ej: "Av. Corrientes 1234"
    lat: Number,
    lng: Number
  },

  // 📊 NUEVO: Control de Límites
  planType: { type: String, default: 'free' }, // 'free', 'pro', 'black'
  dailyOptimizations: { type: Number, default: 0 },
  lastOptimizationDate: Date
});
const User = mongoose.model('User', UserSchema);

// CONFIG MERCADO PAGO
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

// ---------------------------------------------------------
// RUTA 1: SINCRONIZAR USUARIO (Llamada desde Flutter)
// ---------------------------------------------------------
app.post('/sync_user', async (req, res) => {
  const { uid, email, displayName } = req.body;

  try {
    // Buscamos si existe, si no existe lo crea (upsert)
    let user = await User.findOne({ email });

    if (!user) {
      user = new User({ uid, email, displayName, isPro: false });
      await user.save();
      console.log(`🆕 Usuario creado en Mongo: ${email}`);
    } else {
      // Actualizamos último login
      user.lastLogin = new Date();
      await user.save();
      console.log(`👋 Usuario existente: ${email}`);
    }
    
    res.json({ success: true, isPro: user.isPro });
  } catch (error) {
    console.error("Error Mongo Sync:", error);
    res.status(500).json({ error: "Error de base de datos" });
  }
});

// ---------------------------------------------------------
// RUTA 2: CREAR PREFERENCIA DE PAGO (Suscripción)
// ---------------------------------------------------------
app.post('/create_preference', async (req, res) => {
  try {
    const payerEmail = req.body.email || "test_user@test.com"; 
    const preapproval = new PreApproval(client);

    const result = await preapproval.create({
      body: {
        reason: "Suscripción RutAR PRO",
        external_reference: payerEmail,
        payer_email: payerEmail, 
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: 4500,
          currency_id: "ARS"
        },
        back_url: "https://www.google.com", 
      }
    });
    res.json({ id: result.id, init_point: result.init_point });
  } catch (error) {
    console.error("❌ MP Error:", error);
    res.status(400).json({ msg: 'Error', details: error });
  }
});

// ---------------------------------------------------------
// RUTA 3: WEBHOOK (Recibe el pago y actualiza Mongo)
// ---------------------------------------------------------
app.post('/webhook', async (req, res) => {
  const query = req.query;
  const topic = query.topic || query.type; 
  const id = query.id || query['data.id'];

  try {
    if (topic === 'payment') {
      const payment = await new Payment(client).get({ id: id });
      const status = payment.status;
      const payerEmail = payment.payer.email;
      const userEmail = payment.external_reference;

      console.log(`💰 Pago de: ${payerEmail} | Estado: ${status}`);

      if (status === 'approved') {
        console.log(`✅ APROBADO. Actualizando MongoDB para ${payerEmail}...`);
        
        // ACTUALIZAMOS EN MONGO DB
        const updatedUser = await User.findOneAndUpdate(
          { email: userEmail }, // Buscamos por mail
          { 
            isPro: true, 
            planType: 'pro', 
            subscriptionId: id,
            updatedAt: new Date()
          }, // Ponemos PRO en true
          { new: true }
        );

        if(updatedUser) {
           console.log("👑 Usuario actualizado a PRO en la DB!");
        } else {
           console.log("⚠️ Usuario no encontrado en la DB (Pago huérfano)");
        }
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("Error Webhook:", error);
    res.sendStatus(500);
  }
});

app.post('/update_profile', async (req, res) => {
  const { email, homeAddress } = req.body;
  try {
    // Upsert: Si existe actualiza, si no (raro) no hace nada
    await User.findOneAndUpdate({ email }, { homeAddress });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server corriendo en puerto ${port}`));