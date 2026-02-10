// crear_plan_pro.js
// Si usas "type": "module" en package.json, cambiá los require por import
const { MercadoPagoConfig, PreApprovalPlan } = require('mercadopago');
require('dotenv').config(); // Solo necesario si lo corrés local, en Render ya están las vars

// 1. Configuración del Cliente
// Asegurate que tu variable de entorno se llame así o cambialo acá
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

const plan = new PreApprovalPlan(client);

// 2. Datos del Plan
const planData = {
  reason: "Suscripción RutAR PRO",
  auto_recurring: {
    frequency: 1,
    frequency_type: "months",
    transaction_amount: 8999, // EL PRECIO QUE QUIERAS
    currency_id: "ARS"
  },
  back_url: "https://rutar.tech/pago-pro-exitoso", // TU PÁGINA DE ÉXITO
  status: "active"
};

// 3. Ejecución
async function generar() {
  try {
    const response = await plan.create({ body: planData });
    console.log("=========================================");
    console.log("¡PLAN CREADO EXITOSAMENTE! 🚀");
    console.log("COPIÁ ESTE LINK EN TU BOTÓN DE WORDPRESS:");
    console.log("👉 " + response.init_point);
    console.log("=========================================");
    console.log("ID del Plan (Guardalo por las dudas):", response.id);
  } catch (error) {
    console.error("❌ Error creando el plan:", error);
  }
}

generar();