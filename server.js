const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Set development mode for better error messages
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('.'));

// Request logging middleware
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  }
  next();
});

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://quantoom44_db_user:MULJCLTbREzLweuW@cluster0.g6wtztz.mongodb.net/gracelog?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
}).then(() => {
  console.log('MongoDB connected successfully');
}).catch((err) => {
  console.error('MongoDB connection error:', err.message);
  console.error('Server will continue but database operations may fail');
  // Don't exit - let server run even if MongoDB fails
});

// Handle MongoDB connection events
mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected');
});

// Quote Schema
const quoteSchema = new mongoose.Schema({
  referenceNo: { type: String, required: true, unique: true },
  // Contact Information
  firstName: { type: String, required: true },
  lastName: { type: String, default: '' },
  email: { type: String, required: true },
  phone: { type: String, default: '' },
  company: { type: String },
  
  // Shipment Information
  serviceType: { type: String, required: true, enum: ['air', 'sea', 'road'] },
  incoterms: { type: String, enum: ['EXW', 'FCA', 'FAS', 'FOB', 'CPT', 'CFR', 'CIF', 'CIP', 'DAP', 'DPU', 'DDP'] },
  originCountry: { type: String, required: true },
  originCity: { type: String, required: true },
  destCountry: { type: String, required: true },
  destCity: { type: String, required: true },
  
  // Cargo Information
  totalWeight: { type: Number, required: true },
  totalCBM: { type: Number },
  
  // Additional Services (from gracelogistics.com.tr format)
  additionalServices: {
    fragile: { type: Boolean, default: false },
    express: { type: Boolean, default: false },
    insurance: { type: Boolean, default: false },
    packaging: { type: Boolean, default: false }
  },
  
  // Additional Information
  notes: { type: String },
  
  // Status and Metadata
  status: { type: String, enum: ['pending', 'processing', 'quoted', 'accepted', 'rejected'], default: 'pending' },
  language: { type: String, default: 'tr' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// CBM Calculation Schema
const cbmCalculationSchema = new mongoose.Schema({
  sessionId: { type: String, required: true },
  calculationType: { type: String, enum: ['single', 'multiple'], required: true },
  
  // Single calculation data
  singleBox: {
    length: { type: Number },
    width: { type: Number },
    height: { type: Number },
    weight: { type: Number },
    quantity: { type: Number }
  },
  
  // Multiple calculation data
  multipleBoxes: [{
    length: { type: Number },
    width: { type: Number },
    height: { type: Number },
    weight: { type: Number },
    quantity: { type: Number }
  }],
  
  // Results
  results: {
    totalCBM: { type: Number },
    totalWeight: { type: Number },
    volumetricWeight: { type: Number },
    boxCount: { type: Number }
  },
  
  // Metadata
  ipAddress: { type: String },
  userAgent: { type: String },
  language: { type: String, default: 'tr' },
  createdAt: { type: Date, default: Date.now }
});

// Contact Form Schema
const contactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String },
  subject: { type: String },
  message: { type: String },
  formType: { type: String, enum: ['contact', 'quick_quote'], default: 'contact' },
  status: { type: String, enum: ['new', 'read', 'replied', 'closed'], default: 'new' },
  language: { type: String, default: 'tr' },
  createdAt: { type: Date, default: Date.now }
});

// Newsletter Schema
const newsletterSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  status: { type: String, enum: ['active', 'unsubscribed'], default: 'active' },
  language: { type: String, default: 'tr' },
  createdAt: { type: Date, default: Date.now }
});

// Models
const Quote = mongoose.model('Quote', quoteSchema);
const CBMCalculation = mongoose.model('CBMCalculation', cbmCalculationSchema);
const Contact = mongoose.model('Contact', contactSchema);
const Newsletter = mongoose.model('Newsletter', newsletterSchema);

// API Routes

// Quote Routes
app.post('/api/quotes', async (req, res) => {
  try {
    console.log('Received quote request:', JSON.stringify(req.body, null, 2));
    
    // Validation first (before MongoDB check)
    const requiredFields = ['firstName', 'email', 'serviceType', 'originCity', 'originCountry', 'destCity', 'destCountry', 'totalWeight'];
    const missingFields = requiredFields.filter(field => {
      const value = req.body[field];
      return value === undefined || value === null || value === '';
    });
    
    if (missingFields.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Eksik alanlar: ${missingFields.join(', ')}`,
        missingFields: missingFields
      });
    }
    
    // Validate serviceType
    const validServiceTypes = ['air', 'sea', 'road'];
    if (!validServiceTypes.includes(req.body.serviceType)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Geçersiz taşıma yolu. Lütfen havalı, deniz veya karayolu seçin.' 
      });
    }
    
    const referenceNo = 'GRL' + Date.now().toString().slice(-8);
    const quoteData = {
      firstName: String(req.body.firstName || '').trim(),
      lastName: String(req.body.lastName || '').trim(),
      email: String(req.body.email || '').trim(),
      phone: String(req.body.phone || '').trim(),
      company: req.body.company ? String(req.body.company).trim() : null,
      serviceType: req.body.serviceType,
      incoterms: req.body.incoterms || null,
      originCountry: String(req.body.originCountry || '').trim(),
      originCity: String(req.body.originCity || '').trim(),
      destCountry: String(req.body.destCountry || '').trim(),
      destCity: String(req.body.destCity || '').trim(),
      totalWeight: parseFloat(req.body.totalWeight) || 0,
      totalCBM: req.body.totalCBM ? parseFloat(req.body.totalCBM) : null,
      additionalServices: req.body.additionalServices || {},
      notes: req.body.notes || null,
      status: 'pending',
      language: req.body.language || 'tr',
      referenceNo,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    console.log('Quote data to save:', JSON.stringify(quoteData, null, 2));
    
    // Ensure MongoDB is connected before saving
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connection lost. Please try again in a moment.',
        error: 'MongoDB not connected'
      });
    }
    
    const quote = new Quote(quoteData);
    await quote.save();
    
    console.log('Quote saved successfully with reference:', referenceNo);
    
    res.json({ 
      success: true, 
      referenceNo,
      message: 'Quote request submitted successfully' 
    });
  } catch (error) {
    console.error('Quote submission error:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      keyPattern: error.keyPattern,
      keyValue: error.keyValue,
      errors: error.errors
    });
    
    // Handle duplicate reference number error
    if (error.code === 11000 && error.keyPattern && error.keyPattern.referenceNo) {
      // Retry with new reference number
      const referenceNo = 'GRL' + Date.now().toString().slice(-8) + Math.random().toString().slice(2, 5);
      try {
        const retryQuoteData = {
          firstName: String(req.body.firstName || '').trim(),
          lastName: String(req.body.lastName || '').trim(),
          email: String(req.body.email || '').trim(),
          phone: String(req.body.phone || '').trim(),
          company: req.body.company ? String(req.body.company).trim() : null,
          serviceType: req.body.serviceType,
          incoterms: req.body.incoterms || null,
          originCountry: String(req.body.originCountry || '').trim(),
          originCity: String(req.body.originCity || '').trim(),
          destCountry: String(req.body.destCountry || '').trim(),
          destCity: String(req.body.destCity || '').trim(),
          totalWeight: parseFloat(req.body.totalWeight) || 0,
          totalCBM: req.body.totalCBM ? parseFloat(req.body.totalCBM) : null,
          additionalServices: req.body.additionalServices || {},
          notes: req.body.notes || null,
          status: 'pending',
          language: req.body.language || 'tr',
          referenceNo,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        const quote = new Quote(retryQuoteData);
        await quote.save();
        console.log('Quote saved successfully on retry with reference:', referenceNo);
        return res.json({ 
          success: true, 
          referenceNo,
          message: 'Quote request submitted successfully' 
        });
      } catch (retryError) {
        console.error('Retry error:', retryError);
        console.error('Retry error stack:', retryError.stack);
      }
    }
    
    // Check if MongoDB is connected
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ 
        success: false, 
        message: 'Veritabanı bağlantısı yok. Lütfen daha sonra tekrar deneyin.',
        error: 'MongoDB not connected'
      });
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ 
        success: false, 
        message: 'Veri doğrulama hatası',
        errors: validationErrors
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Teklif gönderilirken bir hata oluştu',
      error: error.message || 'Unknown error',
      errorDetails: process.env.NODE_ENV === 'development' ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : undefined
    });
  }
});

app.get('/api/quotes', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status;
    const search = req.query.search;
    
    let query = {};
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { referenceNo: { $regex: search, $options: 'i' } },
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } }
      ];
    }
    
    const quotes = await Quote.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await Quote.countDocuments(query);
    
    res.json({
      quotes,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching quotes' });
  }
});

app.put('/api/quotes/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const quote = await Quote.findByIdAndUpdate(
      req.params.id,
      { status, updatedAt: new Date() },
      { new: true }
    );
    res.json({ success: true, quote });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating quote status' });
  }
});

// CBM Calculation Routes
app.post('/api/cbm-calculations', async (req, res) => {
  try {
    const calculationData = {
      ...req.body,
      sessionId: req.sessionID || 'anonymous-' + Date.now(),
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    };
    
    const calculation = new CBMCalculation(calculationData);
    await calculation.save();
    
    res.json({ success: true, message: 'Calculation saved' });
  } catch (error) {
    console.error('CBM calculation error:', error);
    res.status(500).json({ success: false, message: 'Error saving calculation' });
  }
});

app.get('/api/cbm-calculations', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    
    const calculations = await CBMCalculation.find()
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await CBMCalculation.countDocuments();
    
    res.json({
      calculations,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching calculations' });
  }
});

// Contact Routes
app.post('/api/contacts', async (req, res) => {
  try {
    const { name, email, subject, message, formType, language } = req.body;
    
    // Validation
    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'Name and email are required' });
    }
    
    const contact = new Contact({
      name: name.trim(),
      email: email.trim(),
      phone: req.body.phone || null,
      subject: subject ? subject.trim() : null,
      message: message ? message.trim() : null,
      formType: formType || 'contact',
      status: 'new',
      language: language || 'tr'
    });
    
    await contact.save();
    res.json({ success: true, message: 'Contact form submitted successfully' });
  } catch (error) {
    console.error('Contact submission error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error submitting contact form',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Quick Quote Route (for simple quote forms on homepage)
app.post('/api/quick-quote', async (req, res) => {
  try {
    const { name, email, language } = req.body;
    
    // Validation
    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'Name and email are required' });
    }
    
    const quickQuote = new Contact({
      name: name.trim(),
      email: email.trim(),
      message: 'Quick quote request from homepage',
      formType: 'quick_quote',
      status: 'new',
      language: language || 'tr'
    });
    
    await quickQuote.save();
    res.json({ success: true, message: 'Quote request submitted successfully' });
  } catch (error) {
    console.error('Quick quote submission error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error submitting quote request',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/api/contacts', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status;
    const formType = req.query.formType;
    
    let query = {};
    if (status) query.status = status;
    if (formType) query.formType = formType;
    
    const contacts = await Contact.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await Contact.countDocuments(query);
    
    res.json({
      contacts,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ message: 'Error fetching contacts' });
  }
});

// Newsletter Routes
app.post('/api/newsletter', async (req, res) => {
  try {
    const { email, language } = req.body;
    const newsletter = new Newsletter({ email, language });
    await newsletter.save();
    res.json({ success: true, message: 'Newsletter subscription successful' });
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ success: false, message: 'Email already subscribed' });
    } else {
      res.status(500).json({ success: false, message: 'Error subscribing to newsletter' });
    }
  }
});

// Dashboard Statistics
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfWeek = new Date(today.setDate(today.getDate() - today.getDay()));
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    const stats = {
      quotes: {
        total: await Quote.countDocuments(),
        today: await Quote.countDocuments({ createdAt: { $gte: startOfDay } }),
        thisWeek: await Quote.countDocuments({ createdAt: { $gte: startOfWeek } }),
        thisMonth: await Quote.countDocuments({ createdAt: { $gte: startOfMonth } }),
        pending: await Quote.countDocuments({ status: 'pending' }),
        processing: await Quote.countDocuments({ status: 'processing' }),
        quoted: await Quote.countDocuments({ status: 'quoted' })
      },
      calculations: {
        total: await CBMCalculation.countDocuments(),
        today: await CBMCalculation.countDocuments({ createdAt: { $gte: startOfDay } }),
        thisWeek: await CBMCalculation.countDocuments({ createdAt: { $gte: startOfWeek } }),
        thisMonth: await CBMCalculation.countDocuments({ createdAt: { $gte: startOfMonth } })
      },
      contacts: {
        total: await Contact.countDocuments(),
        new: await Contact.countDocuments({ status: 'new' }),
        today: await Contact.countDocuments({ createdAt: { $gte: startOfDay } })
      },
      newsletter: {
        total: await Newsletter.countDocuments({ status: 'active' }),
        today: await Newsletter.countDocuments({ createdAt: { $gte: startOfDay } })
      }
    };
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching dashboard statistics' });
  }
});

// Admin Panel Route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Serve static files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;