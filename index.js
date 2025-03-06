const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const mongoose = require('mongoose');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const Customer = require('./models/Customer');
const Message = require('./models/Message');

const app = express();
let sock; // Global WhatsApp socket

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from 'public'

// MongoDB connection
mongoose.connect('mongodb+srv://krao53127:Pinkcity%407557@cluster0.sgxwf.mongodb.net/?retryWrites=true&w=majority')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Initialize WhatsApp bot
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: require('pino')({ level: 'warn' }),
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;
    if (qr) {
      console.log('Scan this QR with your WhatsApp:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      console.log('Bot connected to WhatsApp!');
      await sendPendingMessages();
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        setTimeout(startBot, 5000);
      } else {
        console.log('Logged out. Please re-authenticate.');
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.key.fromMe && msg.message?.conversation) {
      const phoneNumber = msg.key.remoteJid.split('@')[0];
      const text = msg.message.conversation.toLowerCase();
      if (text === 'hi') {
        await sock.sendMessage(msg.key.remoteJid, { text: `Hello ${phoneNumber}! How can I assist you?` });
      } else if (text === 'stop') {
        await Customer.updateOne({ phoneNumber }, { status: 'opted-out' });
        await sock.sendMessage(msg.key.remoteJid, { text: 'You’ve been unsubscribed.' });
      }
    }
  });
}

// Send pending messages with delay
async function sendPendingMessages() {
  if (!sock) {
    console.log('WhatsApp not connected yet. Messages will send when connected.');
    return;
  }
  const pendingMessages = await Message.find({ status: 'pending' }).populate('customerId');
  for (const msg of pendingMessages) {
    try {
      const jid = `${msg.phoneNumber}@s.whatsapp.net`;
      await sock.sendMessage(jid, { text: msg.content });
      msg.status = 'sent';
      msg.sentAt = new Date();
      await msg.save();
      console.log(`Sent to ${msg.phoneNumber}: ${msg.content}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`Failed to send to ${msg.phoneNumber}:`, error);
      msg.status = 'failed';
      await msg.save();
    }
  }
}

// API: Add customer and message
app.post('/api/add', async (req, res) => {
  const { phoneNumber, name, messageContent } = req.body;
  if (!phoneNumber || !messageContent) {
    return res.status(400).json({ error: 'Phone number and message content are required' });
  }
  try {
    let customer = await Customer.findOne({ phoneNumber });
    if (!customer) {
      customer = new Customer({ phoneNumber, name: name || 'Unknown' });
      await customer.save();
    }
    const message = new Message({
      customerId: customer._id,
      phoneNumber,
      content: messageContent,
    });
    await message.save();
    if (sock) await sendPendingMessages();
    res.status(201).json({ message: 'Customer and message added', phoneNumber });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add: ' + error.message });
  }
});

// API: Get all messages
app.get('/api/messages', async (req, res) => {
  const messages = await Message.find().populate('customerId');
  res.json(messages);
});

// Serve the frontend explicitly (fallback if static middleware fails)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server and bot
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startBot();
});