# Scalable Image Upload Server

A production-style image upload backend with **NGINX load balancing**, **multiple server instances**, **AWS S3 storage**, and a **GitHub Actions CI pipeline** — no database required.

---

## Architecture Overview

```
Client (curl / Postman)
        │
        ▼
  ┌─────────────┐
  │  NGINX :80  │  ← Load Balancer (Round Robin)
  └──────┬──────┘
         │
   ┌─────┴─────┐
   ▼           ▼
[Server 1]  [Server 2]       ← Node.js Express instances
  :3001       :3002
   │           │
   └─────┬─────┘
         ▼
     AWS S3 Bucket           ← Image storage
```

---

## Tech Stack

| Layer         | Technology              |
|---------------|-------------------------|
| Backend       | Node.js + Express       |
| File Upload   | Multer (memory storage) |
| Cloud Storage | AWS S3 (SDK v3)         |
| Load Balancer | NGINX (Round Robin)     |
| Containers    | Docker + Docker Compose |
| CI Pipeline   | GitHub Actions          |

---

## Prerequisites

- **Docker & Docker Compose** installed
- **AWS account** with an S3 bucket
- AWS IAM user with `s3:PutObject` permission on your bucket

### AWS S3 Bucket Setup

1. Go to AWS Console → S3 → Create bucket
2. Choose a unique name (e.g., `my-image-uploads-2024`)
3. Uncheck "Block all public access" if you want public image URLs
4. Add this bucket policy for public read access:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
    }
  ]
}
```

5. Create an IAM user → Attach policy with `s3:PutObject` → Save Access Key + Secret

---

## Setup & Running

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/image-upload-server.git
cd image-upload-server
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your real AWS credentials:

```env
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=abc123...
AWS_REGION=us-east-1
S3_BUCKET_NAME=my-image-uploads-2024
```

### 3. Start all services (Docker — recommended)

```bash
docker-compose up --build
```

This starts:
- `upload-server-1` on internal port 3001
- `upload-server-2` on internal port 3002
- `nginx-lb` on **port 80** (your entry point)

---

## How to Run Multiple Instances (Without Docker)

Install dependencies first:

```bash
npm install
```

Open **two terminals**:

**Terminal 1:**
```bash
PORT=3001 INSTANCE_ID=server-1 \
  AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
  AWS_REGION=us-east-1 S3_BUCKET_NAME=... \
  npm run start:3001
```

**Terminal 2:**
```bash
PORT=3002 INSTANCE_ID=server-2 \
  AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
  AWS_REGION=us-east-1 S3_BUCKET_NAME=... \
  npm run start:3002
```

Then configure NGINX on your machine pointing to `localhost:3001` and `localhost:3002`.

---

## NGINX Configuration

Located at `nginx/nginx.conf`:

```nginx
upstream backend_servers {
    # Round-robin (default) — requests alternate between instances
    server app1:3001;
    server app2:3002;
}

server {
    listen 80;
    client_max_body_size 3M;  # Allow up to ~2MB image + overhead

    location / {
        proxy_pass http://backend_servers;
        proxy_set_header Host            $host;
        proxy_set_header X-Real-IP       $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # Response header shows which backend handled the request
        add_header X-Upstream-Server $upstream_addr always;
    }
}
```

**How round-robin works:** NGINX keeps a pointer to the upstream list and advances it on each new request. Request 1 → server-1, Request 2 → server-2, Request 3 → server-1, and so on.

---

## API Reference

### `POST /upload`

Upload a single image to S3.

**Request:**
- Content-Type: `multipart/form-data`
- Field name: `image`
- Allowed types: `image/jpeg`, `image/png`
- Max file size: **2MB**

**Success Response (200):**
```json
{
  "url": "https://my-bucket.s3.amazonaws.com/1711234567890-uuid-v4.jpg"
}
```

**Error Responses:**

| Status | Reason                        |
|--------|-------------------------------|
| 400    | No file provided              |
| 400    | File type not allowed         |
| 400    | File exceeds 2MB limit        |
| 500    | S3 upload failed              |

---

### `GET /health`

Health check endpoint.

**Response (200):**
```json
{
  "status": "ok",
  "instance": "server-1",
  "port": 3001
}
```

---

## Sample Requests & Responses

### Upload via curl

```bash
curl -X POST http://localhost/upload \
  -F "image=@/path/to/photo.jpg" \
  -v
```

**Sample response:**
```json
{
  "url": "https://my-image-uploads-2024.s3.amazonaws.com/1711234567890-a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg"
}
```

**Check which server handled it** (in the response headers):
```
X-Upstream-Server: 172.20.0.2:3001
```

### Verify load balancing (run 4 times)

```bash
for i in 1 2 3 4; do
  curl -s -X POST http://localhost/upload \
    -F "image=@photo.jpg" \
    -D - | grep X-Upstream-Server
done
```

Expected output — alternating between instances:
```
X-Upstream-Server: 172.20.0.2:3001
X-Upstream-Server: 172.20.0.3:3002
X-Upstream-Server: 172.20.0.2:3001
X-Upstream-Server: 172.20.0.3:3002
```

### Check server logs

```bash
docker-compose logs -f app1 app2
```

You'll see each server printing which files it handled:
```
[server-1] Uploaded: 1711234567890-abc.jpg (145230 bytes)
[server-2] Uploaded: 1711234567891-def.jpg (98120 bytes)
```

### Test validation

```bash
# File too large (>2MB)
curl -X POST http://localhost/upload -F "image=@large-file.jpg"
# → {"error":"File too large. Max size is 2MB."}

# Wrong file type
curl -X POST http://localhost/upload -F "image=@document.pdf"
# → {"error":"Only JPG and PNG images are allowed"}

# No file
curl -X POST http://localhost/upload
# → {"error":"No image file provided"}
```

---

## GitHub Actions CI Pipeline

Located at `.github/workflows/ci.yml`

### Triggers

- Every `push` to any branch
- Every `pull_request`

### Pipeline Stages

```
push / pull_request
       │
       ▼
┌──────────────────┐
│  build-and-test  │
│                  │
│ 1. npm ci        │  Install dependencies (cached)
│ 2. eslint        │  Code quality check
│ 3. jest tests    │  Unit tests (health, validation)
│ 4. server start  │  Verify server boots + /health works
└────────┬─────────┘
         │ (only if all above pass)
         ▼
┌──────────────────┐
│  docker-build    │
│                  │
│ 1. docker build  │  Build the image
│ 2. docker run    │  Start container, hit /health
└──────────────────┘
```

### Why the pipeline uses fake AWS credentials

Unit tests don't hit real AWS — they test validation and server startup only. Real S3 calls require actual credentials and a real bucket, which should never be in CI without proper secrets. In a production setup, you'd add `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as **GitHub repository secrets** for integration tests.

### Adding GitHub Secrets (for full integration tests)

1. GitHub repo → Settings → Secrets → Actions
2. Add: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, `AWS_REGION`
3. Reference in workflow: `${{ secrets.AWS_ACCESS_KEY_ID }}`

---

## Project Structure

```
image-upload-server/
├── src/
│   ├── server.js          # Express app, multer, S3 upload logic
│   └── server.test.js     # Jest unit tests
├── nginx/
│   └── nginx.conf         # NGINX load balancer config
├── .github/
│   └── workflows/
│       └── ci.yml         # GitHub Actions pipeline
├── Dockerfile             # Container definition
├── docker-compose.yml     # 2 app instances + NGINX
├── package.json
├── .env.example
└── README.md
```

---

## Stopping the Server

```bash
docker-compose down
```

To also remove volumes:
```bash
docker-compose down -v
```
