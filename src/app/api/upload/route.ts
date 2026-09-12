import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getCurrentUser } from '@/lib/auth';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';

async function handlePOST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'ADMIN' && user.role !== 'TECHNICIAN')) {
      return NextResponse.json({ success: false, error: 'Authenticated Admin or Technician access required' }, { status: 403 });
    }
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 });
    }

    // Validate image MIME type
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowedTypes.has(file.type)) {
      return NextResponse.json({ success: false, error: 'File must be an image' }, { status: 400 });
    }
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: 'Image must be between 1 byte and 10 MB' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Generate unique filename
    const ext = path.extname(file.name).toLowerCase();
    const safeExtension = ({ '.jpeg': '.jpg', '.jpg': '.jpg', '.png': '.png', '.webp': '.webp' } as Record<string, string>)[ext];
    if (!safeExtension) return NextResponse.json({ success: false, error: 'Unsupported image extension' }, { status: 400 });
    const filename = `proof_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${safeExtension}`;

    // Ensure public/uploads exists
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadsDir, { recursive: true });

    const filePath = path.join(uploadsDir, filename);
    await writeFile(filePath, buffer);

    const publicUrl = `/uploads/${filename}`;

    return NextResponse.json({
      success: true,
      url: publicUrl,
      filename,
      size: file.size,
    });
  } catch (err: any) {
    logCaughtRequestError(request, '/api/upload', err);
    return NextResponse.json({ success: false, error: getApiErrorMessage(err, 'File upload failed') }, { status: 500 });
  }
}

export const POST = withRequestLogging('/api/upload', handlePOST);
