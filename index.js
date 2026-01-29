require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./src/config/db.js');
const { MercadoPagoConfig, PreApproval } = require('mercadopago');
const app = express();

// Middlewares (Configuraciones)
app.use(cors()); // Permite conexiones desde cualquier lado (luego lo restringimos a tu web)
app.use(express.json()); // Permite leer JSON que venga del Frontend

// Conectar a Base de Datos
connectDB();

// Rutas de Prueba (Health Check)
app.use('/api/auth', require('./src/routes/auth'));
app.get('/', (req, res) => {
    res.send('🚀 RutAR Backend está funcionando correctamente!');
});

// Configurar el Cliente (USÁ TU ACCESS TOKEN DE PRODUCCIÓN O TEST)
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

// Crear la ruta para generar el cobro
app.post('/create_preference', async (req, res) => {
  try {
    const payerEmail = req.body.email || "test_user_1234@testuser.com"; 

    console.log("📩 Intentando crear suscripción para:", payerEmail);

    const preapproval = new PreApproval(client);

    const result = await preapproval.create({
      body: {
        reason: "Suscripción RutAR PRO",
        external_reference: "RUTAR_APP_V1",
        payer_email: payerEmail, 
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: 8999,
          currency_id: "ARS"
        },
        back_url: "https://www.google.com", // Usamos google temporalmente para descartar errores de URL
        // status: "authorized"  <-- COMENTAMOS ESTO, suele causar error 400
      }
    });

    console.log("✅ Éxito! Link generado:", result.init_point);
    res.json({ id: result.id, init_point: result.init_point });
    
  } catch (error) {
    // 🔍 LOG MEJORADO PARA VER EL DETALLE REAL
    console.error("❌ ERROR AL CREAR SUSCRIPCIÓN:");
    
    // Intentamos mostrar la 'cause' que es donde MP esconde el detalle
    if (error.cause) {
      console.error("DETALLE DEL ERROR (cause):", JSON.stringify(error.cause, null, 2));
    } else {
      console.error("ERROR CRUDO:", error);
    }

    res.status(400).json({ 
      msg: 'Error creando suscripción', 
      error_detail: error.cause || error.message 
    });
  }
});

app.post('/webhook', async (req, res) => {
  const payment = req.query;

  if (payment.type === 'payment') {
    const paymentId = payment['data.id'];
    console.log(`💰 Pago recibido ID: ${paymentId}`);
    
    // ACÁ ES DONDE ACTIVÁS EL PLAN PRO EN TU BASE DE DATOS
    // 1. Buscar el pago en MP para ver quién pagó (email).
    // 2. Buscar ese email en tu Mongo DB.
    // 3. Actualizar user.isPro = true;
  }

  res.sendStatus(200); // Responder OK a Mercado Pago
});

// Iniciar Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`📡 Servidor escuchando en puerto ${PORT}`);
});