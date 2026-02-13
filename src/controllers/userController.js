const mongoose = require('mongoose');
// IMPORTANTE: La ruta relativa depende de dónde esté este archivo.
// Si está en src/controllers, subir un nivel (..) lleva a src, y de ahí a models.
const User = require('../models/User'); 
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
    
    // Debug
    console.log("📨 Datos recibidos en save_stop:", { email, status, address });

    // A. GUARDAR EN EL HISTORIAL (Stop)
    const newStop = new Stop({
      driverUid: uid,
      address: address || "Sin dirección",
      lat: lat || 0,
      lng: lng || 0,
      status: status
    });
    await newStop.save();

    // B. ACTUALIZAR ESTADÍSTICAS DEL USUARIO (User)
    if (email) {
        const updateField = status === 'DONE' ? 'stats.delivered' : 'stats.failed';
        
        // Buscamos al usuario por email y le sumamos 1
        const usuarioActualizado = await User.findOneAndUpdate(
            { email: email },
            { $inc: { [updateField]: 1 } }, // $inc suma 1
            { new: true } // Nos devuelve el usuario ya actualizado
        );
        
        if (usuarioActualizado) {
             // Verificamos que stats exista antes de acceder
             const delivered = usuarioActualizado.stats ? usuarioActualizado.stats.delivered : '?';
             console.log(`📊 Stats actualizadas. Entregados: ${delivered}`);
        } else {
             console.log(`⚠️ ALERTA: Se guardó la parada pero NO SE ENCONTRÓ al usuario con email: ${email}`);
        }
    } else {
        console.log("⚠️ No llegó el email desde la App, solo se guardó historial.");
    }

    res.json({ ok: true, msg: 'Parada procesada correctamente' });

  } catch (error) {
    console.error("❌ Error en saveStop:", error);
    res.status(500).json({ ok: false, msg: 'Error al guardar parada' });
  }
};

// 2. FUNCIÓN PARA LEER ESTADÍSTICAS (Opcional, pero dejala por las dudas)
const getUserProfileStats = async (req, res) => {
  try {
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ ok: false, msg: 'Falta el UID' });

    const totalStops = await Stop.find({ driverUid: uid });
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