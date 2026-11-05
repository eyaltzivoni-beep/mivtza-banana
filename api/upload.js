// Issues short-lived tokens so the browser can upload a proof photo/video straight to Vercel Blob.
import { handleUpload } from '@vercel/blob/client';
import { auth, limit } from '../lib/core.js';

export default async function handler(req, res) {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    const result = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const p = JSON.parse(clientPayload || '{}');
        await auth(p);
        await limit(req, 'upload', 20, 3600);
        if (!/^proofs\/[a-z0-9]{12,40}\/[A-Za-z0-9._-]{1,80}$/.test(pathname)) throw new Error('bad path');
        return {
          allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'],
          maximumSizeInBytes: 25 * 1024 * 1024,
          addRandomSuffix: true
        };
      }
    });
    res.status(200).json(result);
  } catch (e) {
    res.status(400).json({ error: e.status ? e.message : 'ההעלאה נכשלה. נסו שוב.' });
  }
}
