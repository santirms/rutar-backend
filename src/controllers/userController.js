const mongoose = require('mongoose');
const User = require('../models/User'); // Asegurate de que la ruta sea correcta
const Stop = require('../models/Stop');

// 1. FUNCIÓN PARA GUARDAR UNA ENTREGA
const saveStop = async (req, res) => {
  try {
    // RECIBIMOS EL EMAIL DESDE LA APP
    const { uid, email, address, lat, lng, status } = req.body;

    // Validación básica
    if (!uid || !status) {
      return res.status(400).json({ ok: false, msg: 'Faltan datos' });
    }
    
    // Debug: Ver en la consola de Render qué está llegando
    console.log("📨 Datos recibidos en save_stop:", { email, status, address });

    // A. GUARDAR EN EL HISTORIAL (Esto ya lo hacías)
    const newStop = new Stop({
      driverUid: uid,
      address: address || "Sin dirección",
      lat: lat || 0,
      lng: lng || 0,
      status: status
    });
    await newStop.save();

    // B. ACTUALIZAR ESTADÍSTICAS DEL USUARIO (ESTO ES LO QUE FALTA) 🚨
    if (email) {
        const updateField = status === 'DONE' ? 'stats.delivered' : 'stats.failed';
        
        // Buscamos al usuario por email y le sumamos 1
        const usuarioActualizado = await User.findOneAndUpdate(
            { email: email },
            { $inc: { [updateField]: 1 } }, // $inc suma 1
            { new: true } // Para que nos devuelva el usuario actualizado en la variable
        );
        
        if (usuarioActualizado) {
             console.log(`📊 Stats actualizadas. Entregados: ${usuarioActualizado.stats.delivered}`);
        } else {
             console.log(`⚠️ No se encontró usuario con email: ${email}`);
        }
    } else {
        console.log("⚠️ No llegó el email desde la App, no se pueden actualizar stats.");
    }

    res.json({ ok: true, msg: 'Parada guardada y procesada' });

  } catch (error) {
    console.error("Error en saveStop:", error);
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