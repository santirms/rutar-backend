// controllers/userController.js
const mongoose = require('mongoose');
const User = require('../models/User');
const Stop = require('../models/Stop'); // Ahora sí existe este archivo

// 1. FUNCIÓN PARA GUARDAR UNA ENTREGA (La app llamará a esto al finalizar)
const saveStop = async (req, res) => {
  try {
    const { uid, address, lat, lng, status } = req.body;

    if (!uid || !status) {
      return res.status(400).json({ ok: false, msg: 'Faltan datos' });
    }

    // Creamos la nueva parada en la base de datos
    const newStop = new Stop({
      driverUid: uid,
      address,
      lat,
      lng,
      status // 'DONE' o 'FAILED'
    });

    await newStop.save();

    res.json({ ok: true, msg: 'Parada guardada' });
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