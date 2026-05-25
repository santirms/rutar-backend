// routes/optimize.js
const express = require('express');
const router = express.Router();
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');

const auth = new GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

router.post('/optimize', async (req, res) => {
  try {
    const { paradas, origin } = req.body;

    if (!paradas || !paradas.length) {
      return res.status(400).json({ error: 'paradas requeridas' });
    }

    // Obtener token OAuth2
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    // Armar request para Route Optimization
    const shipments = paradas.map((p) => ({
      deliveries: [{
        arrivalLocation: {
          latitude: p.lat,
          longitude: p.lng,
        }
      }]
    }));

    const body = {
      model: {
        shipments,
        vehicles: [{
          startLocation: {
            latitude: origin.lat,
            longitude: origin.lng,
          },
          endLocation: {
            latitude: origin.lat,
            longitude: origin.lng,
          },
          costPerKilometer: 1.0,
        }]
      }
    };

    const PROJECT_ID = process.env.GOOGLE_PROJECT_ID;
    const url = `https://routeoptimization.googleapis.com/v1/projects/${PROJECT_ID}:optimizeTours`;

    const response = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${token.token}`,
        'Content-Type': 'application/json',
      }
    });

    const routes = response.data.routes;
    if (!routes || !routes.length) {
      return res.json({ orden: paradas.map((_, i) => i) });
    }

    const visits = routes[0].visits || [];
    const orden = visits.map((v) => v.shipmentIndex ?? 0);

    // Agregar índices que no quedaron en visits
    for (let i = 0; i < paradas.length; i++) {
      if (!orden.includes(i)) orden.push(i);
    }

    res.json({ orden });

  } catch (error) {
    console.error('[Optimize] Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Error optimizando ruta' });
  }
});

module.exports = router;