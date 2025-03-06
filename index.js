const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const mongoose = require('mongoose');
const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parse');
const Customer = require('./models/Customer');
const Message = require('./models/Message');

const app = express();
let sock;
let isSending = false; // Global flag to control sending

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
const upload = multer({ dest: 'uploads/' });

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
    if (qr) console.log('Scan this QR:', qrcode.generate(qr, { small: true }));
    if (connection === 'open') console.log('Bot connected to WhatsApp!');
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) setTimeout(startBot, 5000);
      else console.log('Logged out. Please re-authenticate.');
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

// Send pending messages with custom settings
async function sendPendingMessages(batchSize = 10, minDelay = 1000, maxDelay = 5000, breakAfter = 50, breakDuration = 600000) {
  if (!sock) return { status: 'error', message: 'WhatsApp not connected' };
  if (!isSending) return { status: 'stopped', message: 'Sending stopped' };

  const pendingMessages = await Message.find({ status: 'pending' }).populate('customerId').limit(batchSize);
  let sentCount = 0;

  for (const msg of pendingMessages) {
    if (!isSending) {
      console.log('Sending stopped by user');
      return { status: 'stopped', sent: sentCount, message: 'Sending interrupted' };
    }
    try {
      const jid = `${msg.phoneNumber}@s.whatsapp.net`;
      const messageContent = msg.filePath ? { [msg.fileType]: { url: msg.filePath }, caption: msg.content } : { text: msg.content };
      await sock.sendMessage(jid, messageContent);
      msg.status = 'sent';
      msg.sentAt = new Date();
      await msg.save();
      console.log(`Sent to ${msg.phoneNumber}: ${msg.content}`);
      sentCount++;

      if (sentCount % breakAfter === 0 && sentCount < pendingMessages.length) {
        console.log(`Taking a break for ${breakDuration / 60000} minutes...`);
        await new Promise(resolve => setTimeout(resolve, breakDuration));
      } else {
        const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (error) {
      console.error(`Failed to send to ${msg.phoneNumber}:`, error);
      msg.status = 'failed';
      await msg.save();
    }
  }
  return { status: 'success', sent: sentCount };
}

// API: Upload CSV and optional file
app.post('/api/upload', upload.fields([{ name: 'csvFile' }, { name: 'mediaFile' }]), async (req, res) => {
  const { messageContent } = req.body;
  const csvFile = req.files['csvFile']?.[0];
  const mediaFile = req.files['mediaFile']?.[0];

  if (!csvFile || !messageContent) {
    return res.status(400).json({ error: 'CSV file and message content are required' });
  }

  const phoneNumbers = [];
  fs.createReadStream(csvFile.path)
    .pipe(csv.parse({ columns: true, trim: true }))
    .on('data', (row) => {
      if (row.phoneNumber) phoneNumbers.push({ phoneNumber: row.phoneNumber, name: row.name || 'Unknown' });
    })
    .on('end', async () => {
      for (const { phoneNumber, name } of phoneNumbers) {
        let customer = await Customer.findOne({ phoneNumber });
        if (!customer) {
          customer = new Customer({ phoneNumber, name });
          await customer.save();
        }
        const message = new Message({
          customerId: customer._id,
          phoneNumber,
          content: messageContent,
          filePath: mediaFile ? path.join(__dirname, 'uploads', mediaFile.filename) : null,
          fileType: mediaFile ? (mediaFile.mimetype.startsWith('image') ? 'image' : 'document') : null,
        });
        await message.save();
      }
      fs.unlinkSync(csvFile.path);
      if (mediaFile) fs.renameSync(mediaFile.path, path.join(__dirname, 'uploads', mediaFile.filename));
      res.status(201).json({ message: `${phoneNumbers.length} numbers added` });
    })
    .on('error', (error) => res.status(500).json({ error: 'CSV parsing failed: ' + error.message }));
});

// API: Start sending
app.post('/api/start', async (req, res) => {
  const { batchSize, minDelay, maxDelay, breakAfter, breakDuration } = req.body;
  if (isSending) return res.json({ status: 'running', message: 'Already sending' });
  isSending = true;
  const result = await sendPendingMessages(
    parseInt(batchSize) || 10,
    parseInt(minDelay) || 1000,
    parseInt(maxDelay) || 5000,
    parseInt(breakAfter) || 50,
    parseInt(breakDuration) || 600000
  );
  isSending = false; // Reset when done
  res.json(result);
});

// API: Stop sending
app.post('/api/stop', (req, res) => {
  isSending = false;
  res.json({ status: 'stopped', message: 'Sending stopped' });
});

// API: Update message content
app.put('/api/message/:id', async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Content is required' });
  try {
    const message = await Message.findById(id);
    if (!message || message.status !== 'pending') {
      return res.status(404).json({ error: 'Message not found or not editable' });
    }
    message.content = content;
    await message.save();
    res.json({ message: 'Content updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update: ' + error.message });
  }
});

// API: Get pending messages
app.get('/api/pending', async (req, res) => {
  const pending = await Message.find({ status: 'pending' }).populate('customerId');
  res.json(pending);
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startBot();
});