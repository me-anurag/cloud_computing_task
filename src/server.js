const cors = require('cors');
const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3001;
const INSTANCE_ID = process.env.INSTANCE_ID || `server-${PORT}`;

// S3 Client
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME;

// Multer config — memory storage, 2MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Only JPG and PNG images are allowed'), false);
    }
    cb(null, true);
  },
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', instance: INSTANCE_ID, port: PORT });
});

// Upload endpoint
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File too large. Max size is 20MB.' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const fileName = `${Date.now()}-${uuidv4()}${ext}`;

    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: fileName,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    };

    await s3.send(new PutObjectCommand(uploadParams));

    const url = `https://${BUCKET_NAME}.s3.amazonaws.com/${fileName}`;

    console.log(`[${INSTANCE_ID}] Uploaded: ${fileName} (${req.file.size} bytes)`);

    res.status(200).json({ url });
  } catch (err) {
    console.error(`[${INSTANCE_ID}] Upload error:`, err.message);
    if (err.message.includes('Only JPG')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Upload failed', details: err.message });
  }
});

// Multer error handler
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large. Max size is 2MB.' });
  }
  if (err.message && err.message.includes('Only JPG')) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`[${INSTANCE_ID}] Running on port ${PORT}`);
});

module.exports = app;
