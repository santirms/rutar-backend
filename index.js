require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./src/config/db.js');
const { MercadoPagoConfig, PreApproval } = require('mercadopago');
const admin = require('firebase-admin');
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

// 1. INICIALIZAR FIREBASE (Usando el archivo secreto)
// Nota: En local tenés que tener el archivo. En Render, Secret Files lo crea por vos.
try {
  const serviceAccount = require('./serviceAccountKey.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log("🔥 Firebase Admin conectado exitosamente");
} catch (e) {
  console.error("Error conectando Firebase:", e);
}

const db = admin.firestore(); // Referencia a la base de datos

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
  const query = req.query;
  const topic = query.topic || query.type; 
  const id = query.id || query['data.id'];

  try {
    if (topic === 'payment') {
      // Consultamos a MP el estado del pago
      const payment = await new mercadopago.Payment(client).get({ id: id });
      
      const status = payment.status;
      const payerEmail = payment.payer.email; // El mail del que pagó
      
      console.log(`💰 Pago de: ${payerEmail} | Estado: ${status}`);

      if (status === 'approved') {
        console.log(`✅ PAGO APROBADO. Buscando usuario ${payerEmail} en Firebase...`);
        
        // --- BUSCAR USUARIO Y DARLE EL PLAN PRO ---
        
        // 1. Buscamos en la colección 'users' si existe alguien con ese email
        // (Asumimos que guardaste los usuarios con el email como campo, o el ID es el email)
        
        // OPCIÓN A: Si usás el email como ID del documento (recomendado para empezar)
        // const userRef = db.collection('users').doc(payerEmail);
        
        // OPCIÓN B: Si usás el UID de Auth y el email es un campo interno (lo más común)
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('email', '==', payerEmail).get();

        if (snapshot.empty) {
          console.log('⚠️ No se encontró usuario con ese email en la BD.');
          // Opcional: Podrías crearlo o guardarlo en una colección "pagos_huérfanos" para revisar
        } else {
          // Actualizamos todos los usuarios con ese mail (debería ser uno solo)
          snapshot.forEach(async doc => {
             await doc.ref.update({ 
               isPro: true,
               subscriptionDate: new Date(),
               paymentId: id
             });
             console.log(`👑 Usuario ${doc.id} actualizado a PRO!`);
          });
        }
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("Error en webhook:", error);
    res.sendStatus(500);
  }
});

// Iniciar Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`📡 Servidor escuchando en puerto ${PORT}`);
});