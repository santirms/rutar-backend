// src/middleware/auth.js
//
// Verifica el ID token de Firebase que manda la app en cada request:
//   Authorization: Bearer <idToken>
//
// MODO PERMISIVO (por defecto): si el request NO trae token, se deja pasar
// como hoy (se confía en el email del body) y se loguea una advertencia.
// Así las versiones viejas de la app siguen funcionando.
// Cuando todos estén actualizados, poné AUTH_REQUIRED=true en Render y
// los requests sin token pasan a rechazarse con 401.
//
// Si el request trae token, SIEMPRE se verifica; un token inválido es 401,
// y el email/uid del token pisan los que vengan en el body.
// Para usuarios de email/contraseña sin verificar ver el comentario más abajo.
//
// Variables de entorno:
//   FIREBASE_PROJECT_ID  (obligatoria) project_id de Firebase, el mismo que
//                        figura en android/app/google-services.json
//   AUTH_REQUIRED        'true' para exigir token (opcional)
//   OPTIMIZE_API_KEY     clave compartida para que Zupply web use /api/optimize
//                        (opcional)

const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
}

const authRequired = () => process.env.AUTH_REQUIRED === 'true';

function leerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

async function verificarUsuario(req, res, next) {
  const token = leerToken(req);

  if (!token) {
    if (authRequired()) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    console.warn(`⚠️ [auth] request SIN token a ${req.path} (modo permisivo) email=${(req.body && req.body.email) || '?'}`);
    return next();
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);

    if (!decoded.email) {
      return res.status(401).json({ error: 'Token sin email' });
    }

    // Con email/contraseña cualquiera puede registrar un mail ajeno sin
    // verificarlo. En modo permisivo solo lo avisamos en los logs (la app
    // todavía no manda el mail de verificación); con AUTH_REQUIRED=true se
    // rechaza.
    const proveedor = decoded.firebase && decoded.firebase.sign_in_provider;
    if (proveedor === 'password' && !decoded.email_verified) {
      if (authRequired()) {
        return res.status(401).json({ error: 'Email no verificado' });
      }
      console.warn(`⚠️ [auth] email SIN verificar (password): ${decoded.email} en ${req.path} (modo permisivo)`);
    }

    req.authUser = { uid: decoded.uid, email: decoded.email };
    if (process.env.AUTH_DEBUG === 'true') {
      console.log(`✅ [auth] ${decoded.email} ${req.path}`);
    }

    // El token manda sobre lo que diga el body
    req.body = req.body || {};
    req.body.email = decoded.email;
    req.body.uid = decoded.uid;

    return next();
  } catch (e) {
    console.warn(`⚠️ [auth] token inválido en ${req.path}: ${e.code || e.message}`);
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// Para /api/optimize: la app usa el token de Firebase; Zupply web usa una
// clave compartida en el header x-api-key.
function verificarOptimize(req, res, next) {
  const clave = process.env.OPTIMIZE_API_KEY;
  const recibida = req.headers['x-api-key'];

  if (clave && recibida) {
    const a = Buffer.from(String(recibida));
    const b = Buffer.from(clave);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return next();
    }
    return res.status(401).json({ error: 'API key inválida' });
  }

  return verificarUsuario(req, res, next);
}

module.exports = { verificarUsuario, verificarOptimize };
