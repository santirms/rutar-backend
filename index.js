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
const client = new MercadoPagoConfig({ accessToken: 'TEST-1871745565650068-012900-cf6c850bb67cab8c0b2514a37c2750f0-3167179678' });

// Crear la ruta para generar el cobro
app.post('/create_preference', async (req, res) => {
  try {
    const preapproval = new PreApproval(client);

    const result = await preapproval.create({
      body: {
        reason: "Suscripción RutAR PRO",
        external_reference: "USER_ID_123", // Acá podés pasar el ID de tu usuario para saber quién es
        payer_email: "test_user_123@testuser.com", // Idealmente el mail del usuario real
        auto_recurring: {
          frequency: 1,
          frequency_type: "months", // Se cobra cada 1 mes
          transaction_amount: 4500, // Precio mensual
          currency_id: "ARS"
        },
        back_url: "https://www.rutar.com.ar/success", // A donde vuelve después de suscribirse
        status: "authorized"
      }
    });

    // Devolvemos el link de pago (init_point) al celular
    res.json({ id: result.id, init_point: result.init_point });
    
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Error al crear la suscripción' });
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