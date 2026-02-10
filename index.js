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
// RUTA 1: SINCRONIZAR USUARIO (Llamada desde Flutter)
// ---------------------------------------------------------
app.post('/sync_user', async (req, res) => {
  const { uid, email, displayName } = req.body;

  try {
    let user = await User.findOne({ email });

    if (!user) {
      user = new User({ uid, email, displayName, isPro: false });
      await user.save();
      console.log(`🆕 Usuario creado en Mongo: ${email}`);
    } else {
      user.lastLogin = new Date();
      // Si el UID cambió (raro, pero pasa si reinstalan), lo actualizamos
      if (uid && user.uid !== uid) user.uid = uid;
      await user.save();
      console.log(`👋 Usuario existente: ${email}`);
    }
    
    // Devolvemos el estado real del plan
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
// RUTA 2: WEBHOOK (EL CEREBRO DE LAS SUSCRIPCIONES 🧠)
// ---------------------------------------------------------
app.post('/webhook', async (req, res) => {
    const { type, data } = req.body;

    try {
        // Solo nos interesa si es una suscripción (preapproval)
        if (type === 'subscription_preapproval') {
            
            // 1. Preguntamos a MP los detalles de esta suscripción
            const preapproval = new PreApproval(client);
            const sub = await preapproval.get({ id: data.id });
            
            const status = sub.status;       // 'authorized' = activo
            const payerEmail = sub.payer_email; // El mail de quien pagó
            const reason = sub.reason;       // Ej: "Suscripción RutAR PRO"

            console.log(`🔔 Webhook recibido: ${payerEmail} | Plan: ${reason} | Estado: ${status}`);

            if (status === 'authorized') {
                // 2. Determinamos si es PRO o BLACK según el nombre del plan
                let nuevoPlan = 'pro';
                if (reason && reason.toUpperCase().includes('BLACK')) {
                    nuevoPlan = 'black';
                }

                // 3. Buscamos al usuario en Mongo por su EMAIL y actualizamos
                const updatedUser = await User.findOneAndUpdate(
                    { email: payerEmail }, 
                    { 
                        isPro: true, 
                        planType: nuevoPlan, 
                        subscriptionId: data.id,
                        updatedAt: new Date()
                    },
                    { new: true } // Para que devuelva el doc actualizado
                );

                if (updatedUser) {
                    console.log(`✅ ¡ÉXITO! Usuario ${payerEmail} actualizado a ${nuevoPlan.toUpperCase()}.`);
                } else {
                    console.error(`⚠️ ALERTA: Pago recibido de ${payerEmail} pero NO existe en la App. (Posible email distinto)`);
                }
            }
            
            // (Opcional) Si el estado es 'cancelled', podrías poner isPro: false
            if (status === 'cancelled') {
                 await User.findOneAndUpdate(
                    { email: payerEmail }, 
                    { isPro: false, planType: 'free' }
                );
                console.log(`❌ Suscripción cancelada para ${payerEmail}`);
            }
        }

        // Siempre responder 200 a Mercado Pago para que no reintente
        res.sendStatus(200);

    } catch (error) {
        console.error("❌ Error en Webhook:", error);
        // Respondemos 200 igual para evitar bucles de error con MP, pero logueamos el error
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