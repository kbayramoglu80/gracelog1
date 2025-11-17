// Test MongoDB connection
const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb+srv://quantoom44_db_user:MULJCLTbREzLweuW@cluster0.g6wtztz.mongodb.net/gracelog?retryWrites=true&w=majority&appName=Cluster0';

console.log('Testing MongoDB connection...');

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
}).then(() => {
  console.log('✅ MongoDB connected successfully!');
  process.exit(0);
}).catch((err) => {
  console.error('❌ MongoDB connection failed:');
  console.error('Error message:', err.message);
  console.error('Error name:', err.name);
  process.exit(1);
});











