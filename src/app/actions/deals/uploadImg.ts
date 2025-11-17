'use server';

import { bucket } from '@/firebase/firebase';

export async function uploadImg(formData: FormData) {
  try {
    const file = formData.get('file') as File;
    if (!file) throw new Error('No file provided');

    const buffer = await file.arrayBuffer();
    const filename = `submissions/${Date.now()}-${file.name}`;
    
    const fileUpload = bucket.file(filename);
    await fileUpload.save(Buffer.from(buffer), {
      contentType: file.type,
    });

    const [url] = await fileUpload.getSignedUrl({
      action: 'read',
      expires: '03-01-2500', // Far future expiration
    });
    
    return url;
  } catch (error) {
    console.error('Upload failed:', error);
    return null;
  }
}
