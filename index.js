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
const Campaign = require('./models/Campaign');

const app = express();
let sock;
let isSending = false;

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

// Send pending messages with custom settings and campaign filter
async function sendPendingMessages(campaignId, batchSize = 10, minDelay = 1000, maxDelay = 5000, breakAfter = 50, breakDuration = 600000) {
  if (!sock) return { status: 'error', message: 'WhatsApp not connected' };
  if (!isSending) return { status: 'stopped', message: 'Sending stopped' };

  const query = { status: 'pending' };
  if (campaignId) query.campaignId = campaignId;
  const pendingMessages = await Message.find(query).populate('customerId campaignId').limit(batchSize);
  let sentCount = 0;

  for (const msg of pendingMessages) {
    if (!isSending) {
      console.log('Sending stopped by user');
      return { status: 'stopped', sent: sentCount, message: 'Sending interrupted' };
    }
    try {
      if (!msg.campaignId) throw new Error('No campaign associated with message');
      const jid = `${msg.phoneNumber}@s.whatsapp.net`;
      const messageContent = msg.campaignId.filePath
        ? { [msg.campaignId.fileType]: { url: msg.campaignId.filePath }, caption: msg.campaignId.content }
        : { text: msg.campaignId.content };
      await sock.sendMessage(jid, messageContent);
      msg.status = 'sent';
      msg.sentAt = new Date();
      await msg.save();
      console.log(`Sent to ${msg.phoneNumber}: ${msg.campaignId.content} (Campaign: ${msg.campaignId.name})`);
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

// API: Upload CSV and create campaign
app.post('/api/upload', upload.fields([{ name: 'csvFile' }, { name: 'mediaFile' }]), async (req, res) => {
  const { messageContent, campaignName } = req.body;
  const csvFile = req.files['csvFile']?.[0];
  const mediaFile = req.files['mediaFile']?.[0];

  if (!csvFile || !messageContent || !campaignName) {
    return res.status(400).json({ error: 'CSV file, message content, and campaign name are required' });
  }

  const campaign = new Campaign({
    name: campaignName,
    content: messageContent,
    filePath: mediaFile ? path.join(__dirname, 'uploads', mediaFile.filename) : null,
    fileType: mediaFile ? (mediaFile.mimetype.startsWith('image') ? 'image' : 'document') : null,
  });
  await campaign.save();

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
          campaignId: campaign._id,
          phoneNumber,
        });
        await message.save();
      }
      fs.unlinkSync(csvFile.path);
      if (mediaFile) fs.renameSync(mediaFile.path, path.join(__dirname, 'uploads', mediaFile.filename));
      res.status(201).json({ message: `${phoneNumbers.length} numbers added to campaign "${campaignName}"` });
    })
    .on('error', (error) => res.status(500).json({ error: 'CSV parsing failed: ' + error.message }));
});

// API: Start sending with campaign filter
app.post('/api/start', async (req, res) => {
  const { campaignId, batchSize, minDelay, maxDelay, breakAfter, breakDuration } = req.body;
  if (isSending) return res.json({ status: 'running', message: 'Already sending' });
  isSending = true;
  const result = await sendPendingMessages(
    campaignId || null,
    parseInt(batchSize) || 10,
    parseInt(minDelay) || 1000,
    parseInt(maxDelay) || 5000,
    parseInt(breakAfter) || 50,
    parseInt(breakDuration) || 600000
  );
  isSending = false;
  res.json(result);
});

// API: Stop sending
app.post('/api/stop', (req, res) => {
  isSending = false;
  res.json({ status: 'stopped', message: 'Sending stopped' });
});

// API: Bulk update message content by campaign
app.put('/api/bulk-update', async (req, res) => {
  const { campaignId, content } = req.body;
  if (!content || !campaignId) return res.status(400).json({ error: 'Campaign ID and content are required' });
  try {
    await Campaign.updateOne({ _id: campaignId }, { content });
    res.json({ message: `Campaign updated` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update: ' + error.message });
  }
});

// API: Get pending messages with campaign filter
app.get('/api/pending', async (req, res) => {
  const { campaignId } = req.query;
  const query = { status: 'pending' };
  if (campaignId) query.campaignId = campaignId;
  const pending = await Message.find(query).populate('customerId campaignId');
  res.json(pending);
});

// API: Get all campaigns
app.get('/api/campaigns', async (req, res) => {
  const campaigns = await Campaign.find();
  res.json(campaigns);
});

// API: Get stats for dashboard with campaign filter
app.get('/api/stats', async (req, res) => {
  const { campaignId } = req.query;
  try {
    const stats = {
      totalCampaigns: await Campaign.countDocuments(),
      pendingMessages: await Message.countDocuments(campaignId ? { status: 'pending', campaignId } : { status: 'pending' }),
      sentMessages: await Message.countDocuments(campaignId ? { status: 'sent', campaignId } : { status: 'sent' }),
      failedMessages: await Message.countDocuments(campaignId ? { status: 'failed', campaignId } : { status: 'failed' }),
    };
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats: ' + error.message });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startBot();
});