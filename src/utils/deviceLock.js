// src/utils/deviceLock.js
//
// Un dispositivo activo por cuenta ("gana el último que inició sesión").
//
// Variable de entorno DEVICE_LOCK:
//   off      -> no hace nada
//   log      -> (por defecto) solo registra en los logs qué cuentas se usan
//               desde más de un dispositivo, sin bloquear a nadie
//   enforce  -> responde 409 DEVICE_CONFLICT al dispositivo que no es el activo

function modo() {
  return (process.env.DEVICE_LOCK || 'log').toLowerCase();
}

function leerDeviceId(req) {
  const id = req.headers['x-device-id'];
  return typeof id === 'string' && /^[a-zA-Z0-9-]{16,64}$/.test(id) ? id : null;
}

const corto = (id) => (id ? id.slice(0, 6) : '(ninguno)');

// Se llama en el inicio de sesión explícito (claim: true en /sync_user).
// Este dispositivo pasa a ser el activo. Hay que hacer user.save() después.
function reclamar(user, deviceId) {
  if (!deviceId || modo() === 'off') return;
  if (user.activeDeviceId !== deviceId) {
    console.log(`📱 [device] ${user.email}: activo ${corto(user.activeDeviceId)} → ${corto(deviceId)}`);
    user.activeDeviceId = deviceId;
    user.activeDeviceSince = new Date();
  }
}

// Se llama en las rutas que cuestan plata (check_optimization).
// Devuelve { ok, adopted }. Si adopted es true hay que guardar el user.
function validar(user, deviceId, ruta) {
  const m = modo();
  if (m === 'off') return { ok: true, adopted: false };

  if (!deviceId) {
    console.warn(`📱 [device] ${user.email} en ${ruta}: SIN x-device-id (app vieja)`);
    return { ok: m !== 'enforce', adopted: false };
  }

  // Cuentas anteriores a esta función: el primer dispositivo que consulta queda como activo
  if (!user.activeDeviceId) {
    user.activeDeviceId = deviceId;
    user.activeDeviceSince = new Date();
    console.log(`📱 [device] ${user.email}: primer dispositivo ${corto(deviceId)}`);
    return { ok: true, adopted: true };
  }

  if (user.activeDeviceId === deviceId) return { ok: true, adopted: false };

  console.warn(`📱 [device] ${user.email} en ${ruta}: dispositivo ${corto(deviceId)} != activo ${corto(user.activeDeviceId)} (modo ${m})`);
  return { ok: m !== 'enforce', adopted: false };
}

module.exports = { leerDeviceId, reclamar, validar };
