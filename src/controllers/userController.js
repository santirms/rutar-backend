// controllers/userController.js
const mongoose = require('mongoose');
const User = require('../models/User'); // Asegurate de que esta ruta sea correcta
const Stop = require('../models/Stop'); 

// 1. FUNCIÓN PARA GUARDAR UNA ENTREGA (La app llamará a esto al finalizar)
const saveStop = async (req, res) => {
  try {
    // AHORA PEDIMOS TAMBIÉN EL EMAIL PARA PODER ACTUALIZAR EL PERFIL
    const { uid, email, address, lat, lng, status } = req.body;

    if (!uid || !status) {
      return res.status(400).json({ ok: false, msg: 'Faltan datos' });
    }

    // A. GUARDAR EN EL HISTORIAL (Colección 'stops')
    const newStop = new Stop({
      driverUid: uid,
      address: address || "Sin dirección", // Evitamos error si viene vacío
      lat: lat || 0,
      lng: lng || 0,
      status: status // 'DONE' o 'FAILED'
    });

    await newStop.save();

    // B. ACTUALIZAR ESTADÍSTICAS DEL USUARIO (Colección 'users')
    // Esto es lo nuevo que faltaba 👇
    if (email) {
        const updateField = status === 'DONE' ? 'stats.delivered' : 'stats.failed';
        
        await User.findOneAndUpdate(
            { email: email },
            { $inc: { [updateField]: 1 } } // Sumamos +1 al contador
        );
        console.log(`📊 Stats actualizadas para ${email}: ${status}`);
    }

    res.json({ ok: true, msg: 'Parada y estadísticas guardadas' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, msg: 'Error al guardar parada' });
  }
};

// 2. FUNCIÓN PARA LEER ESTADÍSTICAS (Para el perfil)
const getUserProfileStats = async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({ ok: false, msg: 'Falta el UID' });
    }

    // Buscamos todas las paradas de este chofer
    const totalStops = await Stop.find({ driverUid: uid });
    
    // Filtramos las exitosas
    const deliveredStops = totalStops.filter(stop => stop.status === 'DONE');
    
    const total = totalStops.length;
    const delivered = deliveredStops.length;

    let effectiveness = 0;
    if (total > 0) {
      effectiveness = ((delivered / total) * 100).toFixed(1);
    }

    res.json({
      ok: true,
      stats: {
        total_asignados: total,
        total_entregados: delivered,
        efectividad: effectiveness
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, msg: 'Error calculando estadísticas' });
  }
};

module.exports = { saveStop, getUserProfileStats };