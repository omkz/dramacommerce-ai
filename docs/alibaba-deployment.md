# Alibaba Cloud ECS Deployment

## 1. Prepare ECS

Use an ECS instance with Docker installed. Open inbound port `80` or `3000`, or place the app behind a reverse proxy with TLS.

## 2. Clone and configure

```bash
git clone https://github.com/omkz/dramacommerce-ai.git
cd dramacommerce-ai
cp .env.example .env
nano .env
```

Fill in:

```env
DASHSCOPE_API_KEY=...
QWEN_BASE_URL=https://YOUR_WORKSPACE_ID.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus
DASHSCOPE_VIDEO_BASE_URL=https://YOUR_WORKSPACE_ID.ap-southeast-1.maas.aliyuncs.com
WAN_VIDEO_MODEL=wan2.1-t2v-turbo
```

## 3. Build and run

```bash
docker build -t dramacommerce-ai .
docker run -d --name dramacommerce-ai --env-file .env -p 3000:3000 dramacommerce-ai
```

Open:

```text
http://YOUR_ECS_PUBLIC_IP:3000
```

## 4. Production checks

- Store `.env` as server-side secrets and do not commit it.
- Mount persistent volumes for `data/` and `uploads/` if using local storage.
- Put the app behind HTTPS before using it with real merchant data.
- Configure log collection for Qwen, Wan, upload, and storage errors.
- Back up `data/app.db` until project storage is moved to a managed database.

## 5. Hackathon proof

For Devpost, include the ECS URL or screen recording, this repository link, this deployment doc, and screenshots of the app calling Qwen and creating a Wan video task.

## 6. Storage roadmap

`data/` and `uploads/` are local to the ECS container filesystem by default. This is acceptable for the first deploy when backed by persistent volumes. For production scale, move images and generated videos to Alibaba OSS and project data to a managed database.
