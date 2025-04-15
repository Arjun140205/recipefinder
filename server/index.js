require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const User = require('./models/User');
const Recipe = require('./models/Recipe');

const app = express();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  },
});
const upload = multer({ storage });

// Connect to MongoDB with error handling
mongoose.connect('mongodb://127.0.0.1:27017/recipeapp')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Get JWT secret from .env file or use a default (for development only)
const JWT_SECRET = process.env.JWT_SECRET || 'mySuperSecretKey123!';

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Middleware for JWT authentication
const authenticateJWT = (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  try {
    const decoded = jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Test route to check if the server is working
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working!' });
});

// Authentication Routes
// Signup Route (Register User) - No JWT required
app.post('/api/signup', async (req, res) => {
  try {
    console.log('Signup request received:', req.body);
    const { username, password } = req.body;
    
    if (!username || !password) {
      console.log('Missing username or password');
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      console.log('User already exists');
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    // Create new user
    console.log('Creating new user');
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashed });
    await user.save();
    
    console.log('User created successfully');
    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to create user', details: error.message });
  }
});

// Login Route (Authenticate User and Generate JWT)
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, userId: user._id });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed', details: error.message });
  }
});

// TheMealDB API Routes

// Search recipes by name
app.get('/api/external-recipes/search', async (req, res) => {
  try {
    const query = req.query.query || '';
    const response = await axios.get(
      `https://www.themealdb.com/api/json/v1/1/search.php?s=${query}`
    );
    res.json(response.data.meals || []);
  } catch (err) {
    console.error('TheMealDB API error:', err);
    res.status(500).json({ error: 'Failed to fetch recipes', details: err.message });
  }
});

// Get recipe categories
app.get('/api/external-recipes/categories', async (req, res) => {
  try {
    const response = await axios.get(
      'https://www.themealdb.com/api/json/v1/1/categories.php'
    );
    res.json(response.data.categories || []);
  } catch (err) {
    console.error('TheMealDB API error:', err);
    res.status(500).json({ error: 'Failed to fetch categories', details: err.message });
  }
});

// Get recipes by category
app.get('/api/external-recipes/category/:category', async (req, res) => {
  try {
    const category = req.params.category;
    const response = await axios.get(
      `https://www.themealdb.com/api/json/v1/1/filter.php?c=${category}`
    );
    res.json(response.data.meals || []);
  } catch (err) {
    console.error('TheMealDB API error:', err);
    res.status(500).json({ error: 'Failed to fetch recipes by category', details: err.message });
  }
});

// Get recipes by ingredient
app.get('/api/external-recipes/ingredient/:ingredient', async (req, res) => {
  try {
    const ingredient = req.params.ingredient;
    const response = await axios.get(
      `https://www.themealdb.com/api/json/v1/1/filter.php?i=${ingredient}`
    );
    res.json(response.data.meals || []);
  } catch (err) {
    console.error('TheMealDB API error:', err);
    res.status(500).json({ error: 'Failed to fetch recipes by ingredient', details: err.message });
  }
});

// Get recipe details by ID
app.get('/api/external-recipes/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const response = await axios.get(
      `https://www.themealdb.com/api/json/v1/1/lookup.php?i=${id}`
    );
    res.json(response.data.meals ? response.data.meals[0] : null);
  } catch (err) {
    console.error('TheMealDB API error:', err);
    res.status(500).json({ error: 'Failed to fetch recipe details', details: err.message });
  }
});

// Custom Recipes CRUD Routes
// Create a new Recipe (Protected Route)
app.post('/api/recipes', authenticateJWT, upload.single('image'), async (req, res) => {
  try {
    const recipe = new Recipe({
      title: req.body.title,
      ingredients: req.body.ingredients,
      instructions: req.body.instructions,
      image: req.file ? req.file.path : '',
      userId: req.user.id, // Get user ID from the JWT payload
    });
    await recipe.save();
    res.status(201).json({ message: 'Recipe created successfully', recipe });
  } catch (error) {
    console.error('Recipe creation error:', error);
    res.status(500).json({ error: 'Failed to create recipe', details: error.message });
  }
});

// Get All Recipes
app.get('/api/recipes', async (req, res) => {
  try {
    const recipes = await Recipe.find();
    res.json(recipes);
  } catch (error) {
    console.error('Get recipes error:', error);
    res.status(500).json({ error: 'Failed to retrieve recipes', details: error.message });
  }
});

// Get Recipe by ID
app.get('/api/recipes/:id', async (req, res) => {
  try {
    const recipe = await Recipe.findById(req.params.id);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    res.json(recipe);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve recipe', details: error.message });
  }
});

// Update Recipe (Protected)
app.put('/api/recipes/:id', authenticateJWT, upload.single('image'), async (req, res) => {
  try {
    const recipe = await Recipe.findOne({ _id: req.params.id, userId: req.user.id });
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found or not authorized' });
    }
    
    // Update fields
    recipe.title = req.body.title || recipe.title;
    recipe.ingredients = req.body.ingredients || recipe.ingredients;
    recipe.instructions = req.body.instructions || recipe.instructions;
    if (req.file) {
      recipe.image = req.file.path;
    }
    
    await recipe.save();
    res.json({ message: 'Recipe updated successfully', recipe });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update recipe', details: error.message });
  }
});

// Delete Recipe (Protected)
app.delete('/api/recipes/:id', authenticateJWT, async (req, res) => {
  try {
    const result = await Recipe.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!result) {
      return res.status(404).json({ error: 'Recipe not found or not authorized' });
    }
    res.json({ message: 'Recipe deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete recipe', details: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Server error', details: err.message });
});

// Start the server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
