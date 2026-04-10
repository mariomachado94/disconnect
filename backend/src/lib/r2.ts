import { S3Client } from '@aws-sdk/client-s3';

export const r2 = new S3Client({
  region: process.env.TIGRIS_REGION ?? 'auto',
  endpoint: process.env.TIGRIS_ENDPOINT_URL,
  credentials: {
    accessKeyId: process.env.TIGRIS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.TIGRIS_SECRET_ACCESS_KEY!,
  },
});

export const R2_BUCKET = process.env.TIGRIS_BUCKET_NAME!;
