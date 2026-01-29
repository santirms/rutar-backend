require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./src/config/db.js');
const { MercadoPagoConfig, Preference } = require('mercadopago');

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
const client = new MercadoPagoConfig({ accessToken: 'TU_ACCESS_TOKEN_DE_MERCADOPAGO' });

// Crear la ruta para generar el cobro
app.post('/create_preference', async (req, res) => {
  try {
    const body = {
      items: [
        {
          title: 'Suscripción RutAR PRO (Mensual)',
          quantity: 1,
          unit_price: 4500, // Precio en pesos
          currency_id: 'ARS',
        },
      ],
      back_urls: {
        success: 'https://tu-web.com/success', // O un deep link a tu app
        failure: 'https://tu-web.com/failure',
        pending: 'https://tu-web.com/pending',
      },
      auto_return: 'approved',
    };

    const preference = new Preference(client);
    const result = await preference.create({ body });

    // Devolvemos el ID de la preferencia al celular
    res.json({ id: result.id });
    
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Error al crear la preferencia' });
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