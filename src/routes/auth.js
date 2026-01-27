// src/routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');

// @route   POST api/auth/register
// @desc    Registrar un nuevo usuario
// @access  Public
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    // 1. Verificar si el usuario ya existe
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ msg: 'El usuario ya existe' });
    }

    // 2. Crear el nuevo objeto de usuario
    user = new User({
      name,
      email,
      password
    });

    // 3. Encriptar la contraseña (Salt & Hash)
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);

    // 4. Guardar en Base de Datos
    await user.save();

    res.status(201).json({ msg: 'Usuario registrado exitosamente', userId: user._id });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Error en el servidor');
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Buscar si el usuario existe
    let user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ msg: 'Credenciales inválidas' });
    }

    // 🛡️ SEGURIDAD ANTI-HACKER (La parte clave)
    // Si el usuario entró con Google, su password en la DB es null o undefined.
    if (!user.password) {
      return res.status(400).json({ 
        msg: 'Este usuario se registró con Google. Por favor, usá el botón de "Continuar con Google".' 
      });
    }

    // 2. Verificar la contraseña (Si tiene una)
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: 'Credenciales inválidas' });
    }

    // 3. Si todo está bien, le devolvemos sus datos (o un Token JWT si usás)
    res.json({
      msg: 'Login exitoso',
      userId: user._id,
      name: user.name,
      role: user.role
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Error en el servidor');
  }
});
module.exports = router;