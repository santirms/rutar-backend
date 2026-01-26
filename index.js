require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./src/config/db.js');

const app = express();

// 1. Middlewares (Configuraciones)
app.use(cors()); // Permite conexiones desde cualquier lado (luego lo restringimos a tu web)
app.use(express.json()); // Permite leer JSON que venga del Frontend

// 2. Conectar a Base de Datos
connectDB();

// 3. Rutas de Prueba (Health Check)
app.use('/api/auth', require('./src/routes/auth'));
app.get('/', (req, res) => {
    res.send('🚀 RutAR Backend está funcionando correctamente!');
});

// 4. Iniciar Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`📡 Servidor escuchando en puerto ${PORT}`);
});